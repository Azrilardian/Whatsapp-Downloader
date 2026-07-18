import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb, runMigrations, nowIso } from '@wadl/shared';
import { MIGRATIONS_DIR } from './paths.ts';
import { isSenderWhitelisted, evaluateLinkGate } from './gates.ts';

// Story 2.3 self-check: FR-11/AD-2 live whitelist evaluation. Both gates read
// their tables fresh per call (see gates.ts) — this exercises add/activate
// and deactivate for BOTH tables within one run, proving no in-memory cache
// survives across "messages" (each call below stands in for one message).
// Run: npx tsx src/check-live-whitelist.ts

const root = mkdtempSync(join(tmpdir(), 'wadl-live-whitelist-'));
const db = openDb(join(root, 'app.db'));
runMigrations(db, MIGRATIONS_DIR);

const now = () => nowIso();
const sender = 'live@s.whatsapp.net';

// message 1: sender not in contacts at all -> gated out.
assert.equal(isSenderWhitelisted(db, sender), false, 'unknown sender is not whitelisted');

// message 2 (after an "add + activate" with no worker restart): now passes.
db.prepare(
  'INSERT INTO contacts (jid, active, created_at, updated_at) VALUES (?, ?, ?, ?)',
).run(sender, 1, now(), now());
assert.equal(isSenderWhitelisted(db, sender), true, 'live add+activate is honored on next message');

// message 3 (after live deactivate): blocked again, same run, no restart.
db.prepare('UPDATE contacts SET active = 0, updated_at = ? WHERE jid = ?').run(now(), sender);
assert.equal(isSenderWhitelisted(db, sender), false, 'live deactivate is honored on next message');

// message 4 (re-activate): passes again.
db.prepare('UPDATE contacts SET active = 1, updated_at = ? WHERE jid = ?').run(now(), sender);
assert.equal(isSenderWhitelisted(db, sender), true, 'live re-activate is honored on next message');

// link_patterns: no pattern yet -> no match.
assert.deepEqual(evaluateLinkGate(db, 'https://new.example.com/a.pdf'), []);

// live add+activate a pattern mid-run -> matches on the very next message.
db.prepare(
  'INSERT INTO link_patterns (pattern, type, active, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
).run('new.example.com', 'domain', 1, now(), now());
assert.deepEqual(evaluateLinkGate(db, 'https://new.example.com/a.pdf'), [
  'https://new.example.com/a.pdf',
]);

// live deactivate the pattern -> stops matching on the next message.
db.prepare('UPDATE link_patterns SET active = 0, updated_at = ? WHERE pattern = ?').run(
  now(),
  'new.example.com',
);
assert.deepEqual(evaluateLinkGate(db, 'https://new.example.com/a.pdf'), []);

db.close();
console.log('check-live-whitelist: ok');
