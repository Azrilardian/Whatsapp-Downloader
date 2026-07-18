import { createHash, randomUUID } from 'node:crypto';
import type { Db, ItemRow } from '@wadl/shared';
import { nowIso } from '@wadl/shared';

function urlHash(url: string): string {
  return createHash('sha256').update(url).digest('hex');
}

/**
 * FR-2: each URL that passes the link gate advances independently — one
 * `items` row per matched URL, seeded at the earliest non-terminal status
 * (AD-5) so later pipeline stages (dedup, fetch, scan — epics 3) pick it up
 * from `items` status, not from anything held only in memory.
 */
export function createReceivedItem(db: Db, senderJid: string, sourceUrl: string): ItemRow {
  const now = nowIso();
  const item: ItemRow = {
    item_id: randomUUID(),
    status: 'received',
    sender_jid: senderJid,
    source_url: sourceUrl,
    url_hash: urlHash(sourceUrl),
    content_sha256: null,
    filename: null,
    size_bytes: null,
    scan_result: null,
    created_at: now,
    updated_at: now,
  };

  db.prepare(
    `INSERT INTO items (item_id, status, sender_jid, source_url, url_hash, content_sha256, filename, size_bytes, scan_result, created_at, updated_at)
     VALUES (@item_id, @status, @sender_jid, @source_url, @url_hash, @content_sha256, @filename, @size_bytes, @scan_result, @created_at, @updated_at)`,
  ).run(item);

  db.prepare(
    'INSERT INTO events (event_id, item_id, event_type, detail, created_at) VALUES (?, ?, ?, ?, ?)',
  ).run(randomUUID(), item.item_id, 'item_received', sourceUrl, now);

  return item;
}
