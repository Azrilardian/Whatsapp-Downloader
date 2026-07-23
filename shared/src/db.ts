import { join } from 'node:path';
import Database from 'better-sqlite3';

export type Db = Database.Database;

/**
 * AD-1/AD-14: worker and dashboard must resolve the exact same SQLite file —
 * it's the only seam. `WADL_DB_PATH` wins outright; otherwise
 * `WADL_DATA_DIR/app.db`; otherwise `defaultDataDir/app.db` (each side's own
 * repo-relative fallback for local dev, since the two processes don't share
 * a cwd). One implementation so the two sides can't silently diverge on
 * which env var they honor.
 */
export function resolveDbPath(defaultDataDir: string): string {
  return process.env.WADL_DB_PATH ?? join(process.env.WADL_DATA_DIR ?? defaultDataDir, 'app.db');
}

export interface OpenDbOptions {
  /** Open read-only (no pragma writes attempted beyond busy_timeout). */
  readonly?: boolean;
  /** Fail instead of creating the file — the worker owns creation (AD-4). */
  fileMustExist?: boolean;
}

/**
 * AD-3: every connection — worker and dashboard alike — opens with WAL journal
 * mode and a busy_timeout, because SQLite's write lock is per-file, not
 * per-table. All write paths must tolerate SQLITE_BUSY within this timeout.
 */
export function openDb(path: string, options: OpenDbOptions = {}): Db {
  const db = new Database(path, {
    readonly: options.readonly ?? false,
    fileMustExist: options.fileMustExist ?? false,
  });
  db.pragma('busy_timeout = 5000');
  if (!options.readonly) {
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    db.pragma('synchronous = NORMAL');
  }
  return db;
}

export function nowIso(): string {
  return new Date().toISOString();
}
