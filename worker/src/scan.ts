import { randomUUID } from 'node:crypto';
import type { Db, ItemRow } from '@wadl/shared';
import { nowIso } from '@wadl/shared';
import type { ScannerClient, VtClient } from './scanner.ts';

function getSetting(db: Db, key: string, fallback: string): string {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
  return row?.value ?? fallback;
}

function resolvePositiveInt(raw: string, fallback: number): number {
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

// ClamAV's getVersion() reports the signature DB build date as the trailing
// segment, e.g. "ClamAV 1.0.0/27000/Wed Jan 3 08:35:12 2024" — freshclam
// bumps it on every successful signature update.
function signatureAgeHours(version: string, now: Date): number | null {
  const parts = version.split('/');
  const dateStr = parts[parts.length - 1]?.trim();
  if (!dateStr) return null;
  const built = new Date(dateStr);
  if (Number.isNaN(built.getTime())) return null;
  return (now.getTime() - built.getTime()) / (1000 * 60 * 60);
}

export type ScanResult = { outcome: 'clean' } | { outcome: 'quarantined'; reason: string } | { outcome: 'held'; reason: string };

function quarantine(db: Db, item: ItemRow, reason: string, now: string): ScanResult {
  db.prepare('UPDATE items SET status = ?, scan_result = ?, updated_at = ? WHERE item_id = ?').run(
    'quarantined',
    reason,
    now,
    item.item_id,
  );
  db.prepare('INSERT INTO events (event_id, item_id, event_type, detail, created_at) VALUES (?, ?, ?, ?, ?)').run(
    randomUUID(),
    item.item_id,
    'item_quarantined',
    reason,
    now,
  );
  return { outcome: 'quarantined', reason };
}

function markClean(db: Db, item: ItemRow, scanResult: string, now: string): ScanResult {
  db.prepare('UPDATE items SET scan_result = ?, updated_at = ? WHERE item_id = ?').run(scanResult, now, item.item_id);
  return { outcome: 'clean' };
}

/**
 * FR-6/AD-6/AD-17: ClamAV is mandatory and must be live + signature-current;
 * anything short of that (down, unresponsive, stale signatures, content it
 * can't read) fails closed to quarantine — "couldn't scan" never becomes
 * "clean". VirusTotal is an optional second signal layered on top of a
 * ClamAV-clean verdict, gated by two independently configurable settings so
 * strict-vs-lenient behavior is a config change, not a code change. A failed
 * file is never moved to final/ or extracted (caller enforces — quarantine
 * here is terminal).
 *
 * ponytail: ClamAV returning isInfected=false for content it structurally
 * cannot read (e.g. an encrypted archive) is a known residual gap called out
 * in the PRD's adversarial-security review — a liveness/freshness check
 * can't close it; tracked there as an accepted risk, not solved here.
 */
export async function scanFile(db: Db, item: ItemRow, filePath: string, scanner: ScannerClient, vt?: VtClient): Promise<ScanResult> {
  const now = nowIso();
  const maxAgeHours = resolvePositiveInt(getSetting(db, 'scanner_sig_max_age_hours', '48'), 48);

  let version: string;
  try {
    version = await scanner.getVersion();
  } catch (err) {
    return quarantine(db, item, `scanner unavailable: ${String(err)}`, now);
  }

  const ageHours = signatureAgeHours(version, new Date(now));
  if (ageHours === null || ageHours > maxAgeHours) {
    return quarantine(db, item, `signature age unknown or stale (${version})`, now);
  }

  let result: { isInfected: boolean; viruses: string[] };
  try {
    result = await scanner.isInfected(filePath);
  } catch (err) {
    return quarantine(db, item, `scan failed / unscannable content: ${String(err)}`, now);
  }

  if (result.isInfected) {
    return quarantine(db, item, `clamav: ${result.viruses.join(', ') || 'infected'}`, now);
  }

  if (!vt || !item.content_sha256) {
    return markClean(db, item, 'clean', now);
  }

  const vtFlagPolicy = getSetting(db, 'vt_flag_policy', 'hard-fail');
  const vtOutagePolicy = getSetting(db, 'vt_outage_policy', 'hold');

  let lookup;
  try {
    lookup = await vt.lookupHash(item.content_sha256);
  } catch {
    lookup = { status: 'outage' } as const;
  }

  if (lookup.status === 'outage') {
    if (vtOutagePolicy === 'hold') {
      db.prepare('INSERT INTO events (event_id, item_id, event_type, detail, created_at) VALUES (?, ?, ?, ?, ?)').run(
        randomUUID(),
        item.item_id,
        'scan_held_vt_outage',
        null,
        now,
      );
      return { outcome: 'held', reason: 'virustotal unreachable, held per vt_outage_policy=hold' };
    }
    // degrade: proceed on ClamAV's verdict alone.
    return markClean(db, item, 'clean:vt_degraded', now);
  }

  if (lookup.status === 'flagged') {
    if (vtFlagPolicy === 'hard-fail') {
      return quarantine(db, item, 'virustotal flagged this hash', now);
    }
    db.prepare('INSERT INTO events (event_id, item_id, event_type, detail, created_at) VALUES (?, ?, ?, ?, ?)').run(
      randomUUID(),
      item.item_id,
      'vt_flagged_warn',
      null,
      now,
    );
    return markClean(db, item, 'clean:vt_flagged_warn', now);
  }

  return markClean(db, item, 'clean', now);
}
