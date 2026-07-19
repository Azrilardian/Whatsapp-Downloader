import type { ConnectionStatus, Db, WorkerStateRow } from '@wadl/shared';
import { nowIso } from '@wadl/shared';

// FR-13/FR-14/AD-1: single-row table, worker is the sole writer (AD-4).
export function upsertWorkerState(db: Db, status: ConnectionStatus, qrDataUrl: string | null): void {
  db.prepare(
    `INSERT INTO worker_state (id, connection_status, qr_data_url, updated_at) VALUES (1, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET connection_status = excluded.connection_status, qr_data_url = excluded.qr_data_url, updated_at = excluded.updated_at`,
  ).run(status, qrDataUrl, nowIso());
}

export function readWorkerState(db: Db): WorkerStateRow | null {
  return (db.prepare('SELECT * FROM worker_state WHERE id = 1').get() as WorkerStateRow | undefined) ?? null;
}
