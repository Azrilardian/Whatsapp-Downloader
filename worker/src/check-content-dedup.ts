import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb, runMigrations } from '@wadl/shared';
import { MIGRATIONS_DIR } from './paths.ts';
import { createReceivedItem } from './items.ts';
import { checkContentDedup } from './content-dedup.ts';

// Task 12 self-check (FR-4 post-key/AD-10): identical bytes from different
// URLs short-circuit to `duplicate`; a fresh hash is recorded on the item.
// Run: npx tsx src/check-content-dedup.ts

const root = mkdtempSync(join(tmpdir(), 'wadl-content-dedup-'));
const db = openDb(join(root, 'app.db'));
runMigrations(db, MIGRATIONS_DIR);

const sender = 'sender@s.whatsapp.net';
const hashA = 'a'.repeat(64);
const hashB = 'b'.repeat(64);

// first file downloaded under URL A -> hash recorded, status untouched here.
const itemA = createReceivedItem(db, sender, 'https://files.example.com/a.pdf');
const resultA = checkContentDedup(db, itemA, hashA, 1024);
assert.deepEqual(resultA, { status: 'recorded' });
const rowA = db.prepare('SELECT content_sha256, size_bytes, status FROM items WHERE item_id = ?').get(itemA.item_id) as {
  content_sha256: string;
  size_bytes: number;
  status: string;
};
assert.equal(rowA.content_sha256, hashA);
assert.equal(rowA.size_bytes, 1024);
assert.equal(rowA.status, 'received', 'dedup does not itself advance status on a miss');

// second file, distinct URL B, but identical bytes (same hash) -> duplicate.
const itemB = createReceivedItem(db, sender, 'https://mirror.example.com/a.pdf');
const resultB = checkContentDedup(db, itemB, hashA, 1024);
assert.equal(resultB.status, 'duplicate');
assert.equal(resultB.status === 'duplicate' && resultB.matchedItemId, itemA.item_id);
const rowB = db.prepare('SELECT status, content_sha256 FROM items WHERE item_id = ?').get(itemB.item_id) as {
  status: string;
  content_sha256: string | null;
};
assert.equal(rowB.status, 'duplicate');
assert.equal(rowB.content_sha256, null, 'duplicate item does not claim the content hash');

// third file, genuinely distinct bytes -> recorded, not a duplicate.
const itemC = createReceivedItem(db, sender, 'https://files.example.com/c.pdf');
const resultC = checkContentDedup(db, itemC, hashB, 2048);
assert.deepEqual(resultC, { status: 'recorded' });

const events = db.prepare("SELECT event_type FROM events WHERE event_type IN ('item_duplicate', 'content_hash_recorded')").all() as {
  event_type: string;
}[];
assert.equal(events.filter((e) => e.event_type === 'content_hash_recorded').length, 2);
assert.equal(events.filter((e) => e.event_type === 'item_duplicate').length, 1);

db.close();
console.log('check-content-dedup: ok');
