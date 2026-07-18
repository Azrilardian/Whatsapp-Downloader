import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { openDb, runMigrations, nowIso } from '@wadl/shared';
import { MIGRATIONS_DIR } from './paths.ts';
import { isBackupDue, pruneEventsRetention, resolveCadenceMs, resolveRetentionDays, runBackup } from './backup.ts';

// Story 1.5 self-check: AD-16/NFR-5 backup cadence + events retention.
// Run: npx tsx src/check-backup.ts

assert.equal(resolveCadenceMs('hourly'), 60 * 60 * 1000);
assert.equal(resolveCadenceMs('daily'), 24 * 60 * 60 * 1000);
assert.equal(resolveCadenceMs('weekly'), 7 * 24 * 60 * 60 * 1000);
assert.equal(resolveCadenceMs('nonsense'), 24 * 60 * 60 * 1000, 'unknown cadence falls back to daily');

const now = new Date('2026-07-18T12:00:00.000Z');
assert.equal(isBackupDue(null, resolveCadenceMs('daily'), now), true, 'never backed up is always due');
assert.equal(
  isBackupDue(new Date('2026-07-18T00:00:00.000Z'), resolveCadenceMs('daily'), now),
  false,
  '12h ago is not due on a 24h cadence',
);
assert.equal(
  isBackupDue(new Date('2026-07-17T00:00:00.000Z'), resolveCadenceMs('daily'), now),
  true,
  '36h ago is due on a 24h cadence',
);

assert.equal(resolveRetentionDays('90'), 90);
assert.equal(resolveRetentionDays('0'), 0);
assert.equal(resolveRetentionDays('-1'), 90, 'negative retention would delete everything — falls back to default');
assert.equal(resolveRetentionDays('not-a-number'), 90, 'non-numeric setting falls back to default');
assert.equal(resolveRetentionDays(''), 90, 'empty setting falls back to default');

const root = mkdtempSync(join(tmpdir(), 'wadl-backup-'));
const finalDir = join(root, 'final');
const backupsDir = join(root, 'backups');
mkdirSync(finalDir, { recursive: true });
writeFileSync(join(finalDir, 'report.pdf'), 'stored-bytes');

const db = openDb(join(root, 'app.db'));
runMigrations(db, MIGRATIONS_DIR);

// events retention: one recent row, one stale row past a 1-day window.
const recentId = randomUUID();
const staleId = randomUUID();
db.prepare('INSERT INTO events (event_id, item_id, event_type, detail, created_at) VALUES (?, NULL, ?, NULL, ?)').run(
  recentId,
  'recent',
  nowIso(),
);
db.prepare('INSERT INTO events (event_id, item_id, event_type, detail, created_at) VALUES (?, NULL, ?, NULL, ?)').run(
  staleId,
  'stale',
  new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
);

const pruned = pruneEventsRetention(db, 1);
assert.equal(pruned, 1, 'exactly the stale row should be pruned');
const remaining = db.prepare('SELECT event_id FROM events').all() as { event_id: string }[];
assert.equal(remaining.length, 1);
assert.equal(remaining[0]?.event_id, recentId);

// backup: hot-copies the db and copies final/ into a timestamped dir.
const { dir } = await runBackup(db, { final: finalDir, backups: backupsDir });
assert.equal(existsSync(join(dir, 'app.db')), true, 'db backup file must exist');
assert.equal(existsSync(join(dir, 'final', 'report.pdf')), true, 'final/ contents must be copied');
assert.equal(existsSync(join(backupsDir, '.last-backup')), true, 'last-backup marker must be written');

const backedUpDb = openDb(join(dir, 'app.db'), { readonly: true });
const backedUpEvents = backedUpDb.prepare('SELECT event_id FROM events').all() as { event_id: string }[];
assert.equal(backedUpEvents.length, 1, 'backup must reflect post-prune state');
backedUpDb.close();

assert.equal(readdirSync(backupsDir).filter((n) => n !== '.last-backup').length, 1);

db.close();
console.log('check-backup: ok');
