import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb, runMigrations, nowIso } from '@wadl/shared';
import { MIGRATIONS_DIR } from './paths.ts';
import { evaluateLinkGate } from './gates.ts';
import { createReceivedItem } from './items.ts';

// Story 2.2 self-check: FR-2/AD-12 link extraction & pattern gate.
// Run: npx tsx src/check-link-gate.ts

const root = mkdtempSync(join(tmpdir(), 'wadl-link-gate-'));
const db = openDb(join(root, 'app.db'));
runMigrations(db, MIGRATIONS_DIR);

const now = nowIso();
function addPattern(pattern: string, type: 'domain' | 'extension', active: 0 | 1 = 1): void {
  db.prepare(
    'INSERT INTO link_patterns (pattern, type, active, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
  ).run(pattern, type, active, now, now);
}

addPattern('files.example.com', 'domain');
addPattern('cdn.example.com/downloads', 'domain');
addPattern('zip', 'extension');
addPattern('inactive.example.com', 'domain', 0);

// exact-domain match, no path restriction.
assert.deepEqual(evaluateLinkGate(db, 'grab it: https://files.example.com/a/b.pdf'), [
  'https://files.example.com/a/b.pdf',
]);

// domain + path-prefix: matches inside the prefix, not outside it.
assert.deepEqual(evaluateLinkGate(db, 'https://cdn.example.com/downloads/x.bin'), [
  'https://cdn.example.com/downloads/x.bin',
]);
assert.deepEqual(evaluateLinkGate(db, 'https://cdn.example.com/other/x.bin'), []);

// no wildcard TLD / no substring: a subdomain or a similar-looking host does not match.
assert.deepEqual(evaluateLinkGate(db, 'https://evil-files.example.com/a.pdf'), []);
assert.deepEqual(evaluateLinkGate(db, 'https://sub.files.example.com/a.pdf'), []);

// extension allowlist, independent of domain.
assert.deepEqual(evaluateLinkGate(db, 'https://anywhere.test/archive.zip'), [
  'https://anywhere.test/archive.zip',
]);
assert.deepEqual(evaluateLinkGate(db, 'https://anywhere.test/archive.rar'), []);

// an inactive pattern behaves as if it doesn't exist.
assert.deepEqual(evaluateLinkGate(db, 'https://inactive.example.com/a.pdf'), []);

// two matches in one message each advance independently.
assert.deepEqual(
  evaluateLinkGate(db, 'https://files.example.com/a.pdf and also https://anywhere.test/b.zip'),
  ['https://files.example.com/a.pdf', 'https://anywhere.test/b.zip'],
);

// no URL / no match -> nothing advances.
assert.deepEqual(evaluateLinkGate(db, 'just chatting, no link here'), []);
assert.deepEqual(evaluateLinkGate(db, 'ftp://files.example.com/a.pdf'), []);

// each matched URL becomes its own independent items row (FR-2).
const matched = evaluateLinkGate(
  db,
  'https://files.example.com/a.pdf and https://anywhere.test/b.zip',
);
const items = matched.map((url) => createReceivedItem(db, 'sender@s.whatsapp.net', url));
assert.equal(items.length, 2);
assert.notEqual(items[0]?.item_id, items[1]?.item_id);
for (const item of items) {
  assert.equal(item.status, 'received');
  assert.equal(item.sender_jid, 'sender@s.whatsapp.net');
}
const rows = db.prepare('SELECT status FROM items').all() as { status: string }[];
assert.equal(rows.length, 2);
assert.equal(rows.every((r) => r.status === 'received'), true);

db.close();
console.log('check-link-gate: ok');
