import Database from 'better-sqlite3';

export type Db = Database.Database;

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
