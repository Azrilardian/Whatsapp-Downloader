import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
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
import { startWhatsAppSession } from './session.ts';

// .env (AD-9 secrets) is loaded inside paths.ts, before WADL_DATA_DIR/
// WADL_DB_PATH are read — see the comment there for why it can't happen here.

for (const dir of [STAGING_DIR, FINAL_DIR, QUARANTINE_DIR, EXTRACT_DIR, BAILEYS_AUTH_DIR]) {
  mkdirSync(dir, { recursive: true });
}
// An overridden WADL_DB_PATH may point at a nested path whose parent doesn't
// exist yet (it isn't necessarily under one of the roots created above).
mkdirSync(dirname(DB_PATH), { recursive: true });

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

// --once verifies scaffold/migrations without opening a WhatsApp socket
// (used by CI/local checks — task 1's verification path).
if (process.argv.includes('--once')) {
  db.close();
  process.exit(0);
}

// Story 1.2: pair/reconnect the dedicated secondary number. Pipeline filters
// (epics 2-4) and the full reconnection policy (Story 1.3) attach in later
// tasks.
await startWhatsAppSession(db);
setInterval(() => {}, 1 << 30); // keep the always-on process alive
