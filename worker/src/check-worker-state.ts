import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb, runMigrations } from '@wadl/shared';
import { MIGRATIONS_DIR } from './paths.ts';
import { readWorkerState, upsertWorkerState } from './worker-state.ts';

// Task 21 self-check (FR-13/FR-14/AD-1): migration 002 seeds a single
// 'connecting' row; upsertWorkerState updates it in place (never inserts a
// second row); a QR data URL is retained while pairing and cleared once open.
// Run: npx tsx src/check-worker-state.ts

const root = mkdtempSync(join(tmpdir(), 'wadl-worker-state-'));
const db = openDb(join(root, 'app.db'));
runMigrations(db, MIGRATIONS_DIR);

try {
  const seeded = readWorkerState(db);
  assert.ok(seeded);
  assert.equal(seeded!.connection_status, 'connecting');
  assert.equal(seeded!.qr_data_url, null);

  upsertWorkerState(db, 'connecting', 'data:image/png;base64,AAA');
  const withQr = readWorkerState(db);
  assert.equal(withQr!.connection_status, 'connecting');
  assert.equal(withQr!.qr_data_url, 'data:image/png;base64,AAA');

  upsertWorkerState(db, 'open', null);
  const opened = readWorkerState(db);
  assert.equal(opened!.connection_status, 'open');
  assert.equal(opened!.qr_data_url, null, 'QR is cleared once the session opens');

  const rowCount = (db.prepare('SELECT COUNT(*) AS n FROM worker_state').get() as { n: number }).n;
  assert.equal(rowCount, 1, 'worker_state stays a single row across updates');

  upsertWorkerState(db, 'logged_out', null);
  assert.equal(readWorkerState(db)!.connection_status, 'logged_out');

  console.log('check-worker-state: ok');
} finally {
  db.close();
  rmSync(root, { recursive: true, force: true });
}
