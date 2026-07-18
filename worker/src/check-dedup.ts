import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb, runMigrations } from '@wadl/shared';
import { MIGRATIONS_DIR } from './paths.ts';
import { createReceivedItem } from './items.ts';

// Story 3.1 self-check: FR-4/FR-2/AD-10 pre-download dedup — a normalized-URL
// hash match short-circuits to `duplicate` with no fetch; a distinct URL
// still proceeds to `received`.
// Run: npx tsx src/check-dedup.ts

const root = mkdtempSync(join(tmpdir(), 'wadl-dedup-'));
const db = openDb(join(root, 'app.db'));
runMigrations(db, MIGRATIONS_DIR);

const sender = 'sender@s.whatsapp.net';

// first sighting of a URL -> received.
const first = createReceivedItem(db, sender, 'https://files.example.com/a/b.pdf');
assert.equal(first.status, 'received');

// exact resend -> duplicate, same url_hash.
const resend = createReceivedItem(db, sender, 'https://files.example.com/a/b.pdf');
assert.equal(resend.status, 'duplicate');
assert.equal(resend.url_hash, first.url_hash);
assert.notEqual(resend.item_id, first.item_id);

// case, default port, trailing slash, fragment differ -> normalizes to the same hash -> duplicate.
const variant = createReceivedItem(
  db,
  sender,
  'https://FILES.example.com:443/a/b.pdf/#section',
);
assert.equal(variant.status, 'duplicate');
assert.equal(variant.url_hash, first.url_hash);

// a genuinely distinct URL -> received, distinct hash.
const other = createReceivedItem(db, sender, 'https://files.example.com/a/c.pdf');
assert.equal(other.status, 'received');
assert.notEqual(other.url_hash, first.url_hash);

// three items total in the table; no fetch/download side effects to check
// here since createReceivedItem never fetches (AD-10 short-circuit is
// pre-download, i.e. this function is the whole check).
const rows = db.prepare('SELECT status FROM items').all() as { status: string }[];
assert.equal(rows.length, 4);
assert.deepEqual(
  rows.map((r) => r.status).sort(),
  ['duplicate', 'duplicate', 'received', 'received'],
);

db.close();
console.log('check-dedup: ok');
