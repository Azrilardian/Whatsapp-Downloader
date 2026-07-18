import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb, runMigrations, nowIso } from '@wadl/shared';
import { MIGRATIONS_DIR } from './paths.ts';
import { isSenderWhitelisted } from './gates.ts';

// Story 2.1 self-check: FR-1/AD-2 sender gate.
// Run: npx tsx src/check-gates.ts

const root = mkdtempSync(join(tmpdir(), 'wadl-gates-'));
const db = openDb(join(root, 'app.db'));
runMigrations(db, MIGRATIONS_DIR);

const now = nowIso();
db.prepare('INSERT INTO contacts (jid, label, active, created_at, updated_at) VALUES (?, ?, 1, ?, ?)').run(
  'active@s.whatsapp.net',
  'Active Contact',
  now,
  now,
);
db.prepare('INSERT INTO contacts (jid, label, active, created_at, updated_at) VALUES (?, ?, 0, ?, ?)').run(
  'inactive@s.whatsapp.net',
  'Deactivated Contact',
  now,
  now,
);

assert.equal(isSenderWhitelisted(db, 'active@s.whatsapp.net'), true, 'active entry is whitelisted');
assert.equal(isSenderWhitelisted(db, 'inactive@s.whatsapp.net'), false, 'inactive entry is not whitelisted');
assert.equal(isSenderWhitelisted(db, 'stranger@s.whatsapp.net'), false, 'no entry at all is not whitelisted');

// AD-5/FR-11: live re-evaluation — deactivating takes effect immediately,
// no restart, since the gate reads the table on every call.
db.prepare('UPDATE contacts SET active = 0 WHERE jid = ?').run('active@s.whatsapp.net');
assert.equal(isSenderWhitelisted(db, 'active@s.whatsapp.net'), false, 'deactivation takes effect live');

db.close();
console.log('check-gates: ok');
