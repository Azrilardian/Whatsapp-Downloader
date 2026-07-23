import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb, runMigrations, nowIso } from '@wadl/shared';
import { MIGRATIONS_DIR } from './paths.ts';
import { isMessageSenderWhitelisted } from './gates.ts';

// Task 23 self-check: FR-19/AD-18 group gate, OR-composed with the contact gate.
// Run: npx tsx src/check-group-gate.ts

const root = mkdtempSync(join(tmpdir(), 'wadl-group-gate-'));
const db = openDb(join(root, 'app.db'));
runMigrations(db, MIGRATIONS_DIR);

const now = nowIso();
db.prepare('INSERT INTO contacts (jid, label, active, created_at, updated_at) VALUES (?, ?, 1, ?, ?)').run(
  'whitelisted@s.whatsapp.net',
  'Whitelisted Contact',
  now,
  now,
);
db.prepare('INSERT INTO groups (group_jid, label, active, created_at, updated_at) VALUES (?, ?, 1, ?, ?)').run(
  'active-group@g.us',
  'Active Group',
  now,
  now,
);
db.prepare('INSERT INTO groups (group_jid, label, active, created_at, updated_at) VALUES (?, ?, 0, ?, ?)').run(
  'inactive-group@g.us',
  'Inactive Group',
  now,
  now,
);

// Group message, participant NOT individually whitelisted, group IS whitelisted -> passes (OR-semantics).
assert.equal(
  isMessageSenderWhitelisted(db, { remoteJid: 'active-group@g.us', participant: 'stranger@s.whatsapp.net' }),
  true,
  'whitelisted group admits any participant',
);

// Group message, group NOT whitelisted, participant IS individually whitelisted -> still passes.
assert.equal(
  isMessageSenderWhitelisted(db, {
    remoteJid: 'random-group@g.us',
    participant: 'whitelisted@s.whatsapp.net',
  }),
  true,
  'whitelisted participant passes from any group',
);

// Group message, neither the group nor the participant is whitelisted -> fails.
assert.equal(
  isMessageSenderWhitelisted(db, { remoteJid: 'random-group@g.us', participant: 'stranger@s.whatsapp.net' }),
  false,
  'unwhitelisted group + unwhitelisted participant is rejected',
);

// Group message, group entry exists but is INACTIVE, participant not whitelisted -> fails
// (an inactive group is treated exactly like no entry at all, same as FR-1's contact rule).
assert.equal(
  isMessageSenderWhitelisted(db, { remoteJid: 'inactive-group@g.us', participant: 'stranger@s.whatsapp.net' }),
  false,
  'inactive group entry is not whitelisted',
);

// 1:1 message (no participant): resolved via the Contact whitelist only, group table never consulted.
assert.equal(
  isMessageSenderWhitelisted(db, { remoteJid: 'whitelisted@s.whatsapp.net', participant: null }),
  true,
  '1:1 message passes via the contact whitelist',
);
assert.equal(
  isMessageSenderWhitelisted(db, { remoteJid: 'active-group@g.us', participant: null }),
  false,
  '1:1 message from a JID that happens to match a whitelisted group JID is NOT admitted — group route requires a participant',
);

// AD-5/FR-11: live re-evaluation — deactivating the group takes effect immediately.
db.prepare('UPDATE groups SET active = 0 WHERE group_jid = ?').run('active-group@g.us');
assert.equal(
  isMessageSenderWhitelisted(db, { remoteJid: 'active-group@g.us', participant: 'stranger@s.whatsapp.net' }),
  false,
  'deactivating the group takes effect live',
);

db.close();
console.log('check-group-gate: ok');
