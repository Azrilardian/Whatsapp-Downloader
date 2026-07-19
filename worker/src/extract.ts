import { randomUUID } from 'node:crypto';
import { createWriteStream, existsSync } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import yauzl from 'yauzl';
import type { Db, ItemRow } from '@wadl/shared';
import { nowIso } from '@wadl/shared';
import { scanFile } from './scan.ts';
import type { ScannerClient, VtClient } from './scanner.ts';
import { EXTRACT_DIR } from './paths.ts';

function getSetting(db: Db, key: string, fallback: string): string {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
  return row?.value ?? fallback;
}

// max_nesting_depth=0 ("no nested zips allowed") is a legitimate setting, so
// its min bound is 0; byte/file caps are nonsensical at 0 and use 1.
function resolveBoundedInt(raw: string, fallback: number, min: number): number {
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) && parsed >= min ? parsed : fallback;
}

class CapExceededError extends Error {}
class UnsafeEntryError extends Error {}

interface Caps {
  maxBytes: number;
  maxFiles: number;
  maxDepth: number;
}
interface Counters {
  bytes: number;
  files: number;
}

const S_IFMT = 0xf000;
const S_IFLNK = 0xa000;

function isSymlinkEntry(entry: yauzl.Entry): boolean {
  const mode = (entry.externalFileAttributes >>> 16) & 0xffff;
  return (mode & S_IFMT) === S_IFLNK;
}

/** AD-7: rejects absolute paths, embedded NULs, and any resolved path outside destDir (zip-slip). Exported for direct unit testing. */
export function safeDestPath(destDir: string, entryName: string): string {
  if (entryName.startsWith('/') || entryName.includes('\0')) {
    throw new UnsafeEntryError(`unsafe entry name: ${entryName}`);
  }
  const root = resolve(destDir);
  const dest = resolve(join(root, entryName));
  if (dest !== root && !dest.startsWith(root + sep)) {
    throw new UnsafeEntryError(`entry escapes extraction root: ${entryName}`);
  }
  return dest;
}

function openZip(path: string): Promise<yauzl.ZipFile> {
  return new Promise((resolvePromise, reject) => {
    yauzl.open(path, { lazyEntries: true }, (err, zipfile) => {
      if (err || !zipfile) {
        reject(err ?? new Error('failed to open zip'));
        return;
      }
      resolvePromise(zipfile);
    });
  });
}

function openReadStream(zipfile: yauzl.ZipFile, entry: yauzl.Entry): Promise<NodeJS.ReadableStream> {
  return new Promise((resolvePromise, reject) => {
    zipfile.openReadStream(entry, (err, stream) => {
      if (err || !stream) {
        reject(err ?? new Error('no read stream'));
        return;
      }
      resolvePromise(stream);
    });
  });
}

// Recursively extracts one zip into destDir, accumulating shared byte/file
// counters across nesting levels so bomb caps can't be defeated by nesting
// (a zip inside a zip inside a zip...). A nested `.zip` member is itself
// extracted, one level deeper, once its own bytes are on disk. Caps are
// enforced against real streamed bytes, never the (attacker-controlled)
// central-directory metadata.
async function extractZipInto(
  zipPath: string,
  destDir: string,
  depth: number,
  caps: Caps,
  counters: Counters,
  extractedFiles: string[],
): Promise<void> {
  if (depth > caps.maxDepth) {
    throw new CapExceededError(`exceeded max nesting depth ${caps.maxDepth}`);
  }
  const zipfile = await openZip(zipPath);
  await mkdir(destDir, { recursive: true });

  await new Promise<void>((resolvePromise, reject) => {
    let chain = Promise.resolve();
    let settled = false;
    const fail = (err: unknown) => {
      if (settled) return;
      settled = true;
      zipfile.close();
      reject(err);
    };

    zipfile.on('entry', (entry: yauzl.Entry) => {
      chain = chain.then(async () => {
        if (settled) return;
        if (/\/$/.test(entry.fileName)) {
          zipfile.readEntry();
          return;
        }
        if (isSymlinkEntry(entry)) {
          throw new UnsafeEntryError(`symlink entry rejected: ${entry.fileName}`);
        }

        const destPath = safeDestPath(destDir, entry.fileName);
        if (existsSync(destPath)) {
          throw new UnsafeEntryError(`entry would overwrite existing file: ${entry.fileName}`);
        }

        counters.files += 1;
        if (counters.files > caps.maxFiles) {
          throw new CapExceededError(`exceeded max file count ${caps.maxFiles}`);
        }

        await mkdir(dirname(destPath), { recursive: true });
        const readStream = await openReadStream(zipfile, entry);
        const capCheck = new Transform({
          transform(chunk: Buffer, _enc, callback) {
            counters.bytes += chunk.length;
            if (counters.bytes > caps.maxBytes) {
              callback(new CapExceededError(`exceeded max uncompressed bytes ${caps.maxBytes}`));
              return;
            }
            callback(null, chunk);
          },
        });
        await pipeline(readStream, capCheck, createWriteStream(destPath));
        extractedFiles.push(destPath);

        if (destPath.toLowerCase().endsWith('.zip')) {
          await extractZipInto(destPath, `${destPath}.d`, depth + 1, caps, counters, extractedFiles);
        }

        zipfile.readEntry();
      }).catch(fail);
    });
    zipfile.on('end', () => {
      if (!settled) {
        settled = true;
        resolvePromise();
      }
    });
    zipfile.on('error', fail);
    zipfile.readEntry();
  });
}

export type ExtractResult =
  | { ok: true; extractRoot: string; fileCount: number; totalBytes: number }
  | { ok: false; reason: 'cap_exceeded' | 'unsafe_entry' | 'extract_error' | 'rescan_failed'; detail: string };

function quarantineItem(db: Db, item: ItemRow, reason: string, now: string): void {
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
}

/**
 * FR-7/AD-7/AD-17: extracts a scanned-clean zip into an isolated `extract/`
 * root (never into or beside `final/`) under recursive caps — nested zips
 * count against the same shared byte/file counters, bounded by
 * `max_nesting_depth` — rejecting symlink entries and any entry whose
 * resolved path escapes the extraction root (zip-slip), and never
 * overwriting an existing path. Every extracted file is re-scanned (task
 * 13's `scanFile`) before this returns ok; a blown cap, unsafe entry, or a
 * re-scan that isn't clean discards the partial extraction. A held re-scan
 * (e.g. VirusTotal outage) is treated the same as a failure here — the
 * source archive is untouched, so extraction can simply be retried later.
 *
 * ponytail: scoped to .zip only, matching this repo's own architecture
 * convention (CLAUDE.md: "`.zip` extraction only happens after a passing
 * scan"). gzip/tar/bzip2/xz/7z each need their own dependency and entry
 * model — add if/when a real link pattern needs one.
 */
export async function extractArchive(
  db: Db,
  item: ItemRow,
  archivePath: string,
  scanner: ScannerClient,
  extractRoot: string = EXTRACT_DIR,
  vt?: VtClient,
): Promise<ExtractResult> {
  const now = nowIso();
  const caps: Caps = {
    maxBytes: resolveBoundedInt(getSetting(db, 'max_uncompressed_bytes', '524288000'), 524288000, 1),
    maxFiles: resolveBoundedInt(getSetting(db, 'max_file_count', '1000'), 1000, 1),
    maxDepth: resolveBoundedInt(getSetting(db, 'max_nesting_depth', '3'), 3, 0),
  };

  const destDir = join(extractRoot, item.item_id);
  const counters: Counters = { bytes: 0, files: 0 };
  const extractedFiles: string[] = [];

  try {
    await extractZipInto(archivePath, destDir, 0, caps, counters, extractedFiles);
  } catch (err) {
    await rm(destDir, { recursive: true, force: true });
    if (err instanceof CapExceededError) {
      quarantineItem(db, item, err.message, now);
      return { ok: false, reason: 'cap_exceeded', detail: err.message };
    }
    if (err instanceof UnsafeEntryError) {
      quarantineItem(db, item, err.message, now);
      return { ok: false, reason: 'unsafe_entry', detail: err.message };
    }
    const detail = String(err);
    quarantineItem(db, item, `extraction failed: ${detail}`, now);
    return { ok: false, reason: 'extract_error', detail };
  }

  for (const filePath of extractedFiles) {
    const result = await scanFile(db, item, filePath, scanner, vt);
    if (result.outcome !== 'clean') {
      await rm(destDir, { recursive: true, force: true });
      return { ok: false, reason: 'rescan_failed', detail: `outcome=${result.outcome}` };
    }
  }

  return { ok: true, extractRoot: destDir, fileCount: counters.files, totalBytes: counters.bytes };
}
