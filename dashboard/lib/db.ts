import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { openDb, type Db, type SettingRow } from '@wadl/shared';

// AD-2/AD-4: the dashboard reads pipeline state and (later) writes only the
// operator-config tables. It never issues DDL and never creates the DB file —
// the worker owns schema and creation.
const DB_PATH =
  process.env.WADL_DB_PATH ?? join(process.cwd(), '..', 'data', 'app.db');

export function openDashboardDb(): Db | null {
  if (!existsSync(DB_PATH)) return null;
  return openDb(DB_PATH, { fileMustExist: true, readonly: true });
}

export function readSettings(): SettingRow[] | null {
  const db = openDashboardDb();
  if (!db) return null;
  try {
    return db.prepare('SELECT key, value, updated_at FROM settings ORDER BY key').all() as SettingRow[];
  } finally {
    db.close();
  }
}
