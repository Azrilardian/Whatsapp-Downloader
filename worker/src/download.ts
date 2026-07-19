import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { Db, ItemRow } from '@wadl/shared';
import { guardedFetch, type GuardedFetchDeps } from './guarded-fetch.ts';
import { STAGING_DIR } from './paths.ts';

// FR-3: Content-Type is advisory, but these shapes are never the downloadable
// content a matched link points at — they're what a broken link, login wall,
// or redirect-to-an-error-page returns. Rejected before the body is read.
const NON_DOWNLOADABLE_CONTENT_TYPES = new Set(['text/html', 'text/plain']);

function getSetting(db: Db, key: string, fallback: string): string {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
  return row?.value ?? fallback;
}

function resolveMaxDownloadBytes(raw: string): number {
  const parsed = raw.trim() === '' ? Number.NaN : Number(raw);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 209_715_200;
}

class SizeCapExceededError extends Error {}

export type DownloadResult =
  | { ok: true; path: string; sizeBytes: number; sha256: string }
  | {
      ok: false;
      reason: 'blocked_ip' | 'pattern_mismatch' | 'too_many_redirects' | 'fetch_error' | 'unacceptable_type' | 'too_large';
      detail: string;
    };

/**
 * AD-6/AD-17: FR-3's other half of guardedFetch — rejects an unacceptable
 * Content-Type before touching the body, then streams the body under a live
 * `max_download_bytes` cap that aborts and discards mid-transfer on overrun
 * (HEAD/Content-Length are advisory only, never trusted). The file only ever
 * lands in `staging/` here; promotion to `final/` happens after a scan.
 */
export async function downloadToStaging(
  db: Db,
  item: ItemRow,
  stagingDir: string = STAGING_DIR,
  deps?: GuardedFetchDeps,
): Promise<DownloadResult> {
  const fetchResult = await guardedFetch(db, item.source_url, deps);
  if (!fetchResult.ok) {
    return { ok: false, reason: fetchResult.reason, detail: fetchResult.detail };
  }

  const { response } = fetchResult;
  const contentType = (response.headers['content-type'] ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
  if (NON_DOWNLOADABLE_CONTENT_TYPES.has(contentType)) {
    response.resume(); // drain, discard body of the rejected response
    return { ok: false, reason: 'unacceptable_type', detail: contentType || '(none)' };
  }

  const maxBytes = resolveMaxDownloadBytes(getSetting(db, 'max_download_bytes', '209715200'));
  await mkdir(stagingDir, { recursive: true });
  const destPath = join(stagingDir, item.item_id);

  const hash = createHash('sha256');
  let total = 0;
  const capCheck = new Transform({
    transform(chunk: Buffer, _enc, callback) {
      total += chunk.length;
      if (total > maxBytes) {
        callback(new SizeCapExceededError(`exceeded ${maxBytes} bytes`));
        return;
      }
      hash.update(chunk);
      callback(null, chunk);
    },
  });

  try {
    // stream/promises pipeline destroys every stream (including the live
    // response socket) as soon as one leg errors, so a cap overrun aborts
    // the in-flight transfer rather than reading it to completion first.
    await pipeline(response, capCheck, createWriteStream(destPath));
  } catch (err) {
    await rm(destPath, { force: true });
    if (err instanceof SizeCapExceededError) {
      return { ok: false, reason: 'too_large', detail: err.message };
    }
    return { ok: false, reason: 'fetch_error', detail: String(err) };
  }

  return { ok: true, path: destPath, sizeBytes: total, sha256: hash.digest('hex') };
}
