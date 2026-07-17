import { mkdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { openDb, runMigrations, nowIso } from '@wadl/shared';
import {
  STAGING_DIR,
  FINAL_DIR,
  QUARANTINE_DIR,
  EXTRACT_DIR,
  BAILEYS_AUTH_DIR,
  DB_PATH,
  MIGRATIONS_DIR,
} from './paths.ts';

// Secrets come from the gitignored .env (AD-9); absence is fine at scaffold
// stage — nothing here needs a secret yet.
try {
  process.loadEnvFile('.env');
} catch {
  // no .env yet — nothing to load
}

for (const dir of [STAGING_DIR, FINAL_DIR, QUARANTINE_DIR, EXTRACT_DIR, BAILEYS_AUTH_DIR]) {
  mkdirSync(dir, { recursive: true });
}

// AD-4: the worker owns the schema and runs versioned migrations at startup.
const db = openDb(DB_PATH);
const { from, to, applied } = runMigrations(db, MIGRATIONS_DIR);
if (applied.length > 0) {
  console.log(`migrated schema v${from} -> v${to} (${applied.join(', ')})`);
} else {
  console.log(`schema up to date (v${to})`);
}

db.prepare(
  'INSERT INTO events (event_id, item_id, event_type, detail, created_at) VALUES (?, ?, ?, ?, ?)',
).run(randomUUID(), null, 'worker_started', `schema v${to}`, nowIso());

console.log(`worker ready — db=${DB_PATH} (WAL, busy_timeout)`);

// The Baileys session (task 2), pipeline filters (epics 2-4), and supervisor
// integration (task 5) attach here in later tasks.
if (process.argv.includes('--once')) {
  db.close();
  process.exit(0);
}
setInterval(() => {}, 1 << 30); // keep the always-on process alive
