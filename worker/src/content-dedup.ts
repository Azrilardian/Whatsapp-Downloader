import { randomUUID } from 'node:crypto';
import type { Db, ItemRow } from '@wadl/shared';
import { nowIso } from '@wadl/shared';

export type ContentDedupResult = { status: 'duplicate'; matchedItemId: string } | { status: 'recorded' };

/**
 * FR-4 (post-download key)/AD-10: catches identical bytes reachable via
 * different URLs — the counterpart to items.ts's pre-download url_hash
 * check. Runs after task 11 stages and hashes the file; a match against any
 * other item's content_sha256 short-circuits this item to `duplicate`
 * (caller discards the staged copy). A miss records the hash so later
 * downloads can dedup against this item.
 */
export function checkContentDedup(db: Db, item: ItemRow, sha256: string, sizeBytes: number): ContentDedupResult {
  const now = nowIso();

  return db.transaction((): ContentDedupResult => {
    const match = db
      .prepare('SELECT item_id FROM items WHERE content_sha256 = ? AND item_id != ? LIMIT 1')
      .get(sha256, item.item_id) as { item_id: string } | undefined;

    if (match) {
      db.prepare('UPDATE items SET status = ?, updated_at = ? WHERE item_id = ?').run('duplicate', now, item.item_id);
      db.prepare(
        'INSERT INTO events (event_id, item_id, event_type, detail, created_at) VALUES (?, ?, ?, ?, ?)',
      ).run(randomUUID(), item.item_id, 'item_duplicate', `content matches ${match.item_id}`, now);
      return { status: 'duplicate', matchedItemId: match.item_id };
    }

    db.prepare('UPDATE items SET content_sha256 = ?, size_bytes = ?, updated_at = ? WHERE item_id = ?').run(
      sha256,
      sizeBytes,
      now,
      item.item_id,
    );
    db.prepare(
      'INSERT INTO events (event_id, item_id, event_type, detail, created_at) VALUES (?, ?, ?, ?, ?)',
    ).run(randomUUID(), item.item_id, 'content_hash_recorded', sha256, now);
    return { status: 'recorded' };
  })();
}
