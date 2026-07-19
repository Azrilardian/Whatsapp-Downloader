import { randomUUID } from 'node:crypto';
import { chmod, mkdir, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { fileTypeFromFile } from 'file-type';
import type { Db, ItemRow } from '@wadl/shared';
import { nowIso } from '@wadl/shared';
import { FINAL_DIR, QUARANTINE_DIR } from './paths.ts';

const MAX_FILENAME_LENGTH = 200;

/** FR-18: no path separators, no control characters, no overlong names. */
export function sanitizeFilename(raw: string): string {
  // eslint-disable-next-line no-control-regex
  const stripped = raw.replace(/[/\\]/g, '_').replace(/[\x00-\x1f\x7f]/g, '').trim();
  const safe = stripped.length > 0 ? stripped : 'file';
  return safe.length > MAX_FILENAME_LENGTH ? safe.slice(0, MAX_FILENAME_LENGTH) : safe;
}

function deriveFilename(item: ItemRow): string {
  if (item.filename) return item.filename;
  const ext = urlExtension(item.source_url);
  return ext ? `${item.item_id}.${ext}` : item.item_id;
}

function urlExtension(sourceUrl: string): string | null {
  try {
    const pathname = new URL(sourceUrl).pathname;
    const base = pathname.split('/').pop() ?? '';
    const dot = base.lastIndexOf('.');
    return dot > 0 ? base.slice(dot + 1).toLowerCase() : null;
  } catch {
    return null;
  }
}

export type FileResult = { outcome: 'stored'; path: string } | { outcome: 'quarantined'; reason: string };

/**
 * FR-8/FR-17/FR-18/AD-7: clean files move to `final/` by atomic rename
 * (dir matches status), non-executable; anything else — a rename failure or
 * a real-bytes/declared-extension mismatch — goes to `quarantine/` instead,
 * both logged. Classification is by the file's real bytes (`file-type`
 * magic-byte sniffing), never the declared Content-Type or URL extension.
 * The rename happens before the status commit, matching AD-7's fixed order
 * (a crash in the gap is repaired by startup reconciliation).
 *
 * ponytail: file-type returns no match for many legitimate formats (plain
 * text, unrecognized binaries) — those pass through unverified rather than
 * being quarantined on absence of a signature; only a *positive* mismatch
 * between the URL's extension and the detected real type is treated as
 * integrity failure.
 */
export async function fileItem(
  db: Db,
  item: ItemRow,
  sourcePath: string,
  finalDir: string = FINAL_DIR,
  quarantineDir: string = QUARANTINE_DIR,
): Promise<FileResult> {
  const now = nowIso();
  const filename = sanitizeFilename(deriveFilename(item));
  const declaredExt = urlExtension(item.source_url);

  let mismatchReason: string | null = null;
  try {
    const detected = await fileTypeFromFile(sourcePath);
    if (declaredExt && detected && detected.ext.toLowerCase() !== declaredExt) {
      mismatchReason = `declared type ".${declaredExt}" does not match real bytes (detected "${detected.ext}", ${detected.mime})`;
    }
  } catch (err) {
    mismatchReason = `unable to classify real bytes: ${String(err)}`;
  }

  if (mismatchReason) {
    return quarantineFile(db, item, sourcePath, quarantineDir, filename, mismatchReason, now);
  }

  try {
    const destDir = join(finalDir, item.item_id);
    await mkdir(destDir, { recursive: true });
    const destPath = join(destDir, filename);
    await rename(sourcePath, destPath);
    await chmod(destPath, 0o644); // non-executable

    db.prepare('UPDATE items SET status = ?, filename = ?, updated_at = ? WHERE item_id = ?').run(
      'stored',
      filename,
      now,
      item.item_id,
    );
    db.prepare('INSERT INTO events (event_id, item_id, event_type, detail, created_at) VALUES (?, ?, ?, ?, ?)').run(
      randomUUID(),
      item.item_id,
      'item_stored',
      destPath,
      now,
    );
    return { outcome: 'stored', path: destPath };
  } catch (err) {
    return quarantineFile(db, item, sourcePath, quarantineDir, filename, `filing failed: ${String(err)}`, now);
  }
}

async function quarantineFile(
  db: Db,
  item: ItemRow,
  sourcePath: string,
  quarantineDir: string,
  filename: string,
  reason: string,
  now: string,
): Promise<FileResult> {
  try {
    const destDir = join(quarantineDir, item.item_id);
    await mkdir(destDir, { recursive: true });
    const destPath = join(destDir, filename);
    await rename(sourcePath, destPath);
    await chmod(destPath, 0o644);
  } catch {
    // source file may already be gone/moved; quarantine the DB record regardless (fail-closed).
  }

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
