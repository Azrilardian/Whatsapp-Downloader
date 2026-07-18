import { createHash, randomUUID } from 'node:crypto';
import type { Db, ItemRow } from '@wadl/shared';
import { nowIso } from '@wadl/shared';

// FR-4/AD-10 pre-download key: normalize before hashing so a resend that
// differs only in case, default port, trailing slash, or fragment still
// dedups to the same key.
function normalizeUrl(rawUrl: string): string {
  const url = new URL(rawUrl);
  url.hostname = url.hostname.toLowerCase();
  if ((url.protocol === 'http:' && url.port === '80') || (url.protocol === 'https:' && url.port === '443')) {
    url.port = '';
  }
  if (url.pathname.length > 1 && url.pathname.endsWith('/')) {
    url.pathname = url.pathname.slice(0, -1);
  }
  url.hash = '';
  return url.toString();
}

function urlHash(url: string): string {
  return createHash('sha256').update(normalizeUrl(url)).digest('hex');
}

/**
 * FR-2/FR-4: each URL that passes the link gate advances independently — one
 * `items` row per matched URL. AD-10: before trusting a new fetch, check the
 * pre-download key (normalized-URL hash) against every prior item; a hit
 * short-circuits straight to `duplicate` with no fetch. A miss seeds
 * `received` (AD-5) for later pipeline stages (fetch, scan — epic 3) to pick
 * up from `items` status, not from anything held only in memory.
 */
export function createReceivedItem(db: Db, senderJid: string, sourceUrl: string): ItemRow {
  const now = nowIso();
  const hash = urlHash(sourceUrl);
  const isDuplicate = db.prepare('SELECT 1 FROM items WHERE url_hash = ? LIMIT 1').get(hash) !== undefined;

  const item: ItemRow = {
    item_id: randomUUID(),
    status: isDuplicate ? 'duplicate' : 'received',
    sender_jid: senderJid,
    source_url: sourceUrl,
    url_hash: hash,
    content_sha256: null,
    filename: null,
    size_bytes: null,
    scan_result: null,
    created_at: now,
    updated_at: now,
  };

  // Atomic: an items row must never commit without its audit event, or vice
  // versa — a failure partway through would otherwise leave one without the
  // other.
  db.transaction(() => {
    db.prepare(
      `INSERT INTO items (item_id, status, sender_jid, source_url, url_hash, content_sha256, filename, size_bytes, scan_result, created_at, updated_at)
       VALUES (@item_id, @status, @sender_jid, @source_url, @url_hash, @content_sha256, @filename, @size_bytes, @scan_result, @created_at, @updated_at)`,
    ).run(item);

    db.prepare(
      'INSERT INTO events (event_id, item_id, event_type, detail, created_at) VALUES (?, ?, ?, ?, ?)',
    ).run(randomUUID(), item.item_id, isDuplicate ? 'item_duplicate' : 'item_received', sourceUrl, now);
  })();

  return item;
}
