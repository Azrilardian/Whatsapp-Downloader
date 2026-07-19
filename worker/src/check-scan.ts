import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb, runMigrations, nowIso } from '@wadl/shared';
import { MIGRATIONS_DIR } from './paths.ts';
import { createReceivedItem } from './items.ts';
import { scanFile } from './scan.ts';
import type { ScannerClient, VtClient } from './scanner.ts';

// Task 13 self-check (FR-6/AD-6/AD-17): ClamAV must be live+current; scanner-
// down/stale/unscannable -> quarantined; VT flag/outage policies branch as
// configured; a ClamAV fail is never left "clean".
// Run: npx tsx src/check-scan.ts

const root = mkdtempSync(join(tmpdir(), 'wadl-scan-'));
const db = openDb(join(root, 'app.db'));
runMigrations(db, MIGRATIONS_DIR);

const sender = 'sender@s.whatsapp.net';
let n = 0;
function freshItem(sha256?: string) {
  n += 1;
  const item = createReceivedItem(db, sender, `https://files.example.com/f${n}.pdf`);
  if (sha256) {
    db.prepare('UPDATE items SET content_sha256 = ? WHERE item_id = ?').run(sha256, item.item_id);
    return { ...item, content_sha256: sha256 };
  }
  return item;
}

function statusOf(itemId: string): { status: string; scan_result: string | null } {
  return db.prepare('SELECT status, scan_result FROM items WHERE item_id = ?').get(itemId) as any;
}

const CURRENT_VERSION = `ClamAV 1.0.0/27000/${new Date().toUTCString()}`;
const STALE_VERSION = 'ClamAV 1.0.0/20000/Mon Jan 1 00:00:00 2001';

const cleanScanner: ScannerClient = {
  getVersion: async () => CURRENT_VERSION,
  isInfected: async () => ({ isInfected: false, viruses: [] }),
};

// case 1: scanner unreachable -> quarantined, never "clean".
{
  const item = freshItem();
  const downScanner: ScannerClient = {
    getVersion: async () => {
      throw new Error('ECONNREFUSED');
    },
    isInfected: async () => ({ isInfected: false, viruses: [] }),
  };
  const result = await scanFile(db, item, '/tmp/f.bin', downScanner);
  assert.equal(result.outcome, 'quarantined');
  assert.equal(statusOf(item.item_id).status, 'quarantined');
}

// case 2: stale signature -> quarantined.
{
  const item = freshItem();
  const staleScanner: ScannerClient = { getVersion: async () => STALE_VERSION, isInfected: async () => ({ isInfected: false, viruses: [] }) };
  const result = await scanFile(db, item, '/tmp/f.bin', staleScanner);
  assert.equal(result.outcome, 'quarantined');
}

// case 3: unscannable content (isInfected throws) -> quarantined, not "clean".
{
  const item = freshItem();
  const unscannable: ScannerClient = {
    getVersion: async () => CURRENT_VERSION,
    isInfected: async () => {
      throw new Error('encrypted archive');
    },
  };
  const result = await scanFile(db, item, '/tmp/f.bin', unscannable);
  assert.equal(result.outcome, 'quarantined');
}

// case 4: ClamAV detects malware -> quarantined.
{
  const item = freshItem();
  const infected: ScannerClient = { getVersion: async () => CURRENT_VERSION, isInfected: async () => ({ isInfected: true, viruses: ['Eicar-Test-Signature'] }) };
  const result = await scanFile(db, item, '/tmp/f.bin', infected);
  assert.equal(result.outcome, 'quarantined');
  assert.ok(result.outcome === 'quarantined' && result.reason.includes('Eicar-Test-Signature'));
}

// case 5: ClamAV clean, no VT configured -> clean, scan_result recorded.
{
  const item = freshItem();
  const result = await scanFile(db, item, '/tmp/f.bin', cleanScanner);
  assert.deepEqual(result, { outcome: 'clean' });
  assert.equal(statusOf(item.item_id).scan_result, 'clean');
}

// case 6: ClamAV clean, VT flags it, vt_flag_policy=hard-fail (default) -> quarantined.
{
  const item = freshItem('f'.repeat(64));
  const vtFlagged: VtClient = { lookupHash: async () => ({ status: 'flagged' }) };
  const result = await scanFile(db, item, '/tmp/f.bin', cleanScanner, vtFlagged);
  assert.equal(result.outcome, 'quarantined');
}

// case 7: ClamAV clean, VT flags it, vt_flag_policy=warn -> proceeds, logged.
{
  db.prepare('UPDATE settings SET value = ? WHERE key = ?').run('warn', 'vt_flag_policy');
  const item = freshItem('e'.repeat(64));
  const vtFlagged: VtClient = { lookupHash: async () => ({ status: 'flagged' }) };
  const result = await scanFile(db, item, '/tmp/f.bin', cleanScanner, vtFlagged);
  assert.deepEqual(result, { outcome: 'clean' });
  assert.equal(statusOf(item.item_id).scan_result, 'clean:vt_flagged_warn');
  const event = db.prepare("SELECT 1 FROM events WHERE item_id = ? AND event_type = 'vt_flagged_warn'").get(item.item_id);
  assert.ok(event, 'vt_flagged_warn event must be logged');
  db.prepare('UPDATE settings SET value = ? WHERE key = ?').run('hard-fail', 'vt_flag_policy');
}

// case 8: ClamAV clean, VT unreachable, vt_outage_policy=hold (default) -> held.
{
  const item = freshItem('d'.repeat(64));
  const vtDown: VtClient = { lookupHash: async () => ({ status: 'outage' }) };
  const result = await scanFile(db, item, '/tmp/f.bin', cleanScanner, vtDown);
  assert.equal(result.outcome, 'held');
  assert.equal(statusOf(item.item_id).status, 'received', 'held leaves status non-terminal, unchanged');
}

// case 9: ClamAV clean, VT unreachable, vt_outage_policy=degrade -> proceeds on ClamAV alone.
{
  db.prepare('UPDATE settings SET value = ? WHERE key = ?').run('degrade', 'vt_outage_policy');
  const item = freshItem('c'.repeat(64));
  const vtDown: VtClient = { lookupHash: async () => ({ status: 'outage' }) };
  const result = await scanFile(db, item, '/tmp/f.bin', cleanScanner, vtDown);
  assert.deepEqual(result, { outcome: 'clean' });
  assert.equal(statusOf(item.item_id).scan_result, 'clean:vt_degraded');
  db.prepare('UPDATE settings SET value = ? WHERE key = ?').run('hold', 'vt_outage_policy');
}

// case 10: ClamAV clean, VT can't confirm either way (unknown) -> held, same as outage, never "clean".
{
  const item = freshItem('b'.repeat(64));
  const vtUnknown: VtClient = { lookupHash: async () => ({ status: 'unknown' }) };
  const result = await scanFile(db, item, '/tmp/f.bin', cleanScanner, vtUnknown);
  assert.equal(result.outcome, 'held');
  assert.equal(statusOf(item.item_id).status, 'received', 'held leaves status non-terminal, unchanged');
}

db.close();
console.log('check-scan: ok');
