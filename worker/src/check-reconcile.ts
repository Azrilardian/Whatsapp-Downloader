import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { openDb, runMigrations, nowIso } from '@wadl/shared';
import { MIGRATIONS_DIR } from './paths.ts';
import { reconcileOnStartup } from './reconcile.ts';

// Story 1.4 self-check: AD-7/AD-15 fail-closed startup reconciliation.
// Run: npx tsx src/check-reconcile.ts

const root = mkdtempSync(join(tmpdir(), 'wadl-reconcile-'));
const roots = {
  staging: join(root, 'staging'),
  final: join(root, 'final'),
  quarantine: join(root, 'quarantine'),
  extract: join(root, 'extract'),
};
for (const dir of Object.values(roots)) mkdirSync(dir, { recursive: true });

const db = openDb(join(root, 'app.db'));
runMigrations(db, MIGRATIONS_DIR);

function insertItem(status: string): string {
  const id = randomUUID();
  const now = nowIso();
  db.prepare(
    `INSERT INTO items (item_id, status, sender_jid, source_url, url_hash, created_at, updated_at)
     VALUES (?, ?, 'sender@s.whatsapp.net', 'https://example.com/f', ?, ?, ?)`,
  ).run(id, status, id, now, now);
  return id;
}

// (a) pre-download stages have no artifact — safe to re-queue as-is.
const received = insertItem('received');
const validating = insertItem('validating');

// (b) an in-progress download can't be trusted — partial bytes are discarded.
const downloading = insertItem('downloading');
writeFileSync(join(roots.staging, `${downloading}.part`), 'partial');

// (c) a fully-downloaded file awaiting scan is intact — retry the scan in place.
const scanningIntact = insertItem('scanning');
writeFileSync(join(roots.staging, scanningIntact), 'complete-bytes');

// (d) invariant violated: status says scanning but no artifact exists.
const scanningMissing = insertItem('scanning');

// (d2) status says scanning, but only a partial `.part` marker is there —
// must not be mistaken for the intact artifact (findArtifact vs. findPartialArtifact).
const scanningOnlyPartial = insertItem('scanning');
writeFileSync(join(roots.staging, `${scanningOnlyPartial}.part`), 'still-downloading');

// (e) mid-extraction can't be trusted partially applied — fail closed.
const extracting = insertItem('extracting');
mkdirSync(join(roots.extract, extracting), { recursive: true });
writeFileSync(join(roots.extract, extracting, 'entry.bin'), 'x');

// (f) crash after the AD-7 move into final/ but before the status commit —
// the move already happened, so complete the bookkeeping, don't redo it.
const movedToFinal = insertItem('scanning');
writeFileSync(join(roots.final, movedToFinal), 'clean-bytes');

// (g) same gap, but the move landed in quarantine/.
const movedToQuarantine = insertItem('downloading');
writeFileSync(join(roots.quarantine, movedToQuarantine), 'bad-bytes');

// (h) already terminal and correctly placed — must not be touched.
const alreadyStored = insertItem('stored');
writeFileSync(join(roots.final, alreadyStored), 'untouched');

const { queue, resolved } = reconcileOnStartup(db, roots);

function statusOf(id: string): string {
  return (db.prepare('SELECT status FROM items WHERE item_id = ?').get(id) as { status: string }).status;
}

assert.equal(resolved, 9, 'should resolve every non-terminal row seeded above');

assert.equal(statusOf(received), 'received');
assert.equal(statusOf(validating), 'received');

assert.equal(statusOf(downloading), 'received');
assert.equal(existsSync(join(roots.staging, `${downloading}.part`)), false, 'partial download must be discarded');

assert.equal(statusOf(scanningIntact), 'scanning');
assert.equal(existsSync(join(roots.staging, scanningIntact)), true, 'intact staged file must survive reconciliation');

assert.equal(statusOf(scanningMissing), 'received');

assert.equal(statusOf(scanningOnlyPartial), 'received');
assert.equal(
  existsSync(join(roots.staging, `${scanningOnlyPartial}.part`)),
  false,
  'a lone .part file must never be treated as the intact scan artifact',
);

assert.equal(statusOf(extracting), 'quarantined');
assert.equal(existsSync(join(roots.extract, extracting)), false, 'untrusted extraction output must be dropped');

assert.equal(statusOf(movedToFinal), 'stored');
assert.equal(statusOf(movedToQuarantine), 'quarantined');

assert.equal(statusOf(alreadyStored), 'stored');

const queueIds = new Set(queue.map((item) => item.item_id));
assert.equal(queue.length, 6, 'queue must hold exactly the still-non-terminal items');
for (const id of [received, validating, downloading, scanningIntact, scanningMissing, scanningOnlyPartial]) {
  assert.equal(queueIds.has(id), true, `${id} should be back in the rebuilt queue`);
}
for (const id of [extracting, movedToFinal, movedToQuarantine, alreadyStored]) {
  assert.equal(queueIds.has(id), false, `${id} is terminal and must not be in the queue`);
}

db.close();
console.log('check-reconcile: ok');
