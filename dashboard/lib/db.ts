import { existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  nowIso,
  openDb,
  type ContactRow,
  type Db,
  type LinkPatternRow,
  type LinkPatternType,
  type SettingRow,
} from '@wadl/shared';

// AD-2/AD-4: the dashboard reads pipeline state and writes only the
// operator-config tables (contacts, link_patterns, settings). It never
// issues DDL and never creates the DB file — the worker owns schema and
// creation.
const DB_PATH =
  process.env.WADL_DB_PATH ?? join(process.cwd(), '..', 'data', 'app.db');

export function openDashboardDb(): Db | null {
  if (!existsSync(DB_PATH)) return null;
  return openDb(DB_PATH, { fileMustExist: true, readonly: true });
}

function openDashboardWriteDb(): Db | null {
  if (!existsSync(DB_PATH)) return null;
  return openDb(DB_PATH, { fileMustExist: true });
}

function withWriteDb<T>(run: (db: Db) => T): T {
  const db = openDashboardWriteDb();
  if (!db) throw new Error('database not found — start the worker once to create it');
  try {
    return run(db);
  } finally {
    db.close();
  }
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

export function listContacts(): ContactRow[] {
  const db = openDashboardDb();
  if (!db) return [];
  try {
    return db.prepare('SELECT * FROM contacts ORDER BY jid').all() as ContactRow[];
  } finally {
    db.close();
  }
}

export function listLinkPatterns(): LinkPatternRow[] {
  const db = openDashboardDb();
  if (!db) return [];
  try {
    return db.prepare('SELECT * FROM link_patterns ORDER BY pattern').all() as LinkPatternRow[];
  } finally {
    db.close();
  }
}

/** FR-12/AD-2: add a contact, or rename+edit one by replacing its jid (the PK) inside one transaction. */
export function saveContact(originalJid: string | null, jid: string, label: string | null, active: 0 | 1): void {
  withWriteDb((db) => {
    const now = nowIso();
    db.transaction(() => {
      if (originalJid && originalJid !== jid) {
        db.prepare('DELETE FROM contacts WHERE jid = ?').run(originalJid);
      }
      db.prepare(
        `INSERT INTO contacts (jid, label, active, created_at, updated_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(jid) DO UPDATE SET label = excluded.label, active = excluded.active, updated_at = excluded.updated_at`,
      ).run(jid, label, active, now, now);
    })();
  });
}

export function setContactActive(jid: string, active: 0 | 1): void {
  withWriteDb((db) => {
    db.prepare('UPDATE contacts SET active = ?, updated_at = ? WHERE jid = ?').run(active, nowIso(), jid);
  });
}

export function deleteContact(jid: string): void {
  withWriteDb((db) => {
    db.prepare('DELETE FROM contacts WHERE jid = ?').run(jid);
  });
}

/** FR-12/AD-2: add a link pattern, or rename+edit one by replacing its pattern text (the PK) inside one transaction. */
export function saveLinkPattern(
  originalPattern: string | null,
  pattern: string,
  type: LinkPatternType,
  active: 0 | 1,
): void {
  withWriteDb((db) => {
    const now = nowIso();
    db.transaction(() => {
      if (originalPattern && originalPattern !== pattern) {
        db.prepare('DELETE FROM link_patterns WHERE pattern = ?').run(originalPattern);
      }
      db.prepare(
        `INSERT INTO link_patterns (pattern, type, active, created_at, updated_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(pattern) DO UPDATE SET type = excluded.type, active = excluded.active, updated_at = excluded.updated_at`,
      ).run(pattern, type, active, now, now);
    })();
  });
}

export function setLinkPatternActive(pattern: string, active: 0 | 1): void {
  withWriteDb((db) => {
    db.prepare('UPDATE link_patterns SET active = ?, updated_at = ? WHERE pattern = ?').run(active, nowIso(), pattern);
  });
}

export function deleteLinkPattern(pattern: string): void {
  withWriteDb((db) => {
    db.prepare('DELETE FROM link_patterns WHERE pattern = ?').run(pattern);
  });
}
