import { existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  nowIso,
  openDb,
  resolveDbPath,
  type ContactRow,
  type Db,
  type GroupRow,
  type ItemRow,
  type LinkPatternRow,
  type LinkPatternType,
  type SettingRow,
  type WorkerStateRow,
} from '@wadl/shared';

// AD-2/AD-4: the dashboard reads pipeline state and writes only the
// operator-config tables (contacts, link_patterns, settings). It never
// issues DDL and never creates the DB file — the worker owns schema and
// creation. Path resolution is shared with the worker (resolveDbPath) so
// the two sides can't silently diverge on which env var they honor — they
// did, once: this fallback used to check only WADL_DB_PATH, missing
// WADL_DATA_DIR entirely, so on a deploy that sets only WADL_DATA_DIR (e.g.
// Railway's volume mount) the dashboard was reading a different, empty
// path than the one the worker actually wrote to.
const DB_PATH = resolveDbPath(join(process.cwd(), '..', 'data'));

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

function withReadDb<T>(fallback: T, run: (db: Db) => T): T {
  const db = openDashboardDb();
  if (!db) return fallback;
  try {
    return run(db);
  } finally {
    db.close();
  }
}

/** FR-13/FR-14: worker-owned connection status + re-pair QR, read-only here (AD-4). */
export function readWorkerState(): WorkerStateRow | null {
  return withReadDb(null, (db) => {
    const exists = db
      .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'worker_state'")
      .get();
    if (!exists) return null;
    return (db.prepare('SELECT * FROM worker_state WHERE id = 1').get() as WorkerStateRow) ?? null;
  });
}

export function readSettings(): SettingRow[] | null {
  return withReadDb(null, (db) => db.prepare('SELECT key, value, updated_at FROM settings ORDER BY key').all() as SettingRow[]);
}

/** FR-19/AD-17: bulk-update policy values; worker reads them live on its next relevant operation (no restart). */
export function saveSettings(values: Record<string, string>): void {
  withWriteDb((db) => {
    const now = nowIso();
    const stmt = db.prepare('UPDATE settings SET value = ?, updated_at = ? WHERE key = ?');
    db.transaction(() => {
      for (const [key, value] of Object.entries(values)) stmt.run(value, now, key);
    })();
  });
}

export function listContacts(): ContactRow[] {
  return withReadDb([], (db) => db.prepare('SELECT * FROM contacts ORDER BY jid').all() as ContactRow[]);
}

export function listLinkPatterns(): LinkPatternRow[] {
  return withReadDb([], (db) => db.prepare('SELECT * FROM link_patterns ORDER BY pattern').all() as LinkPatternRow[]);
}

/** FR-19/AD-18: group whitelist — separate table from `contacts` (PRD OQ-15). */
export function listGroups(): GroupRow[] {
  return withReadDb([], (db) => db.prepare('SELECT * FROM groups ORDER BY group_jid').all() as GroupRow[]);
}

/** FR-13/AD-1: every Event with enough item context (contact, link, filename, scan result) to audit an outcome without a join in the caller. */
export interface EventWithContext {
  event_id: string;
  item_id: string | null;
  event_type: string;
  detail: string | null;
  created_at: string;
  sender_jid: string | null;
  source_url: string | null;
  filename: string | null;
  scan_result: string | null;
  status: string | null;
}

export function listEvents(limit = 200): EventWithContext[] {
  return withReadDb([], (db) =>
    db
      .prepare(
        `SELECT e.event_id, e.item_id, e.event_type, e.detail, e.created_at,
                i.sender_jid, i.source_url, i.filename, i.scan_result, i.status
         FROM events e
         LEFT JOIN items i ON i.item_id = e.item_id
         ORDER BY e.created_at DESC
         LIMIT ?`,
      )
      .all(limit) as EventWithContext[],
  );
}

/** FR-13: quarantined items listed distinctly from delivered/stored ones. */
export function listQuarantined(): ItemRow[] {
  return withReadDb([], (db) =>
    db.prepare("SELECT * FROM items WHERE status = 'quarantined' ORDER BY updated_at DESC").all() as ItemRow[],
  );
}

/** Home stat cards: today's terminal-status counts (UTC calendar day, matching `nowIso`). */
export interface TodayStatusCounts {
  stored: number;
  quarantined: number;
  ignored: number;
}

export function getTodayStatusCounts(): TodayStatusCounts {
  return withReadDb({ stored: 0, quarantined: 0, ignored: 0 }, (db) => {
    const today = nowIso().slice(0, 10);
    const rows = db
      .prepare(
        `SELECT status, COUNT(*) as count FROM items
         WHERE updated_at LIKE ? AND status IN ('stored', 'quarantined', 'ignored')
         GROUP BY status`,
      )
      .all(`${today}%`) as { status: 'stored' | 'quarantined' | 'ignored'; count: number }[];

    const counts: TodayStatusCounts = { stored: 0, quarantined: 0, ignored: 0 };
    for (const row of rows) counts[row.status] = row.count;
    return counts;
  });
}

// FR-12/FR-19/AD-2: contacts and groups share one PK-rename-and-upsert shape
// (pk, label, active) — the only difference is which table/column holds the
// PK. `link_patterns` is NOT folded in here: its third column is `type`, not
// `label`, a genuinely different shape.
type PkLabelActiveTable = 'contacts' | 'groups';
const PK_COLUMN: Record<PkLabelActiveTable, string> = { contacts: 'jid', groups: 'group_jid' };
const ENTITY_NOUN: Record<PkLabelActiveTable, string> = { contacts: 'contact', groups: 'group' };

function savePkLabelActiveEntry(
  table: PkLabelActiveTable,
  originalPk: string | null,
  pk: string,
  label: string | null,
  active: 0 | 1,
): void {
  const pkColumn = PK_COLUMN[table];
  withWriteDb((db) => {
    const now = nowIso();
    db.transaction(() => {
      let createdAt = now;
      if (originalPk && originalPk !== pk) {
        const target = db.prepare(`SELECT ${pkColumn} FROM ${table} WHERE ${pkColumn} = ?`).get(pk) as
          | Record<string, string>
          | undefined;
        if (target) throw new Error(`a ${ENTITY_NOUN[table]} with ${pkColumn} "${pk}" already exists`);
        const original = db.prepare(`SELECT created_at FROM ${table} WHERE ${pkColumn} = ?`).get(originalPk) as
          | { created_at: string }
          | undefined;
        if (original) createdAt = original.created_at;
        db.prepare(`DELETE FROM ${table} WHERE ${pkColumn} = ?`).run(originalPk);
      }
      db.prepare(
        `INSERT INTO ${table} (${pkColumn}, label, active, created_at, updated_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(${pkColumn}) DO UPDATE SET label = excluded.label, active = excluded.active, updated_at = excluded.updated_at`,
      ).run(pk, label, active, createdAt, now);
    })();
  });
}

function setPkLabelActiveEntryActive(table: PkLabelActiveTable, pk: string, active: 0 | 1): void {
  const pkColumn = PK_COLUMN[table];
  withWriteDb((db) => {
    db.prepare(`UPDATE ${table} SET active = ?, updated_at = ? WHERE ${pkColumn} = ?`).run(active, nowIso(), pk);
  });
}

function deletePkLabelActiveEntry(table: PkLabelActiveTable, pk: string): void {
  const pkColumn = PK_COLUMN[table];
  withWriteDb((db) => {
    db.prepare(`DELETE FROM ${table} WHERE ${pkColumn} = ?`).run(pk);
  });
}

/** FR-12/AD-2: add a contact, or rename+edit one by replacing its jid (the PK) inside one transaction. */
export function saveContact(originalJid: string | null, jid: string, label: string | null, active: 0 | 1): void {
  savePkLabelActiveEntry('contacts', originalJid, jid, label, active);
}

export function setContactActive(jid: string, active: 0 | 1): void {
  setPkLabelActiveEntryActive('contacts', jid, active);
}

export function deleteContact(jid: string): void {
  deletePkLabelActiveEntry('contacts', jid);
}

/** FR-19/AD-18: add a group, or rename+edit one by replacing its group_jid (the PK) inside one transaction. */
export function saveGroup(originalGroupJid: string | null, groupJid: string, label: string | null, active: 0 | 1): void {
  savePkLabelActiveEntry('groups', originalGroupJid, groupJid, label, active);
}

export function setGroupActive(groupJid: string, active: 0 | 1): void {
  setPkLabelActiveEntryActive('groups', groupJid, active);
}

export function deleteGroup(groupJid: string): void {
  deletePkLabelActiveEntry('groups', groupJid);
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
      let createdAt = now;
      if (originalPattern && originalPattern !== pattern) {
        const target = db.prepare('SELECT pattern FROM link_patterns WHERE pattern = ?').get(pattern) as
          | { pattern: string }
          | undefined;
        if (target) throw new Error(`a link pattern "${pattern}" already exists`);
        const original = db.prepare('SELECT created_at FROM link_patterns WHERE pattern = ?').get(originalPattern) as
          | { created_at: string }
          | undefined;
        if (original) createdAt = original.created_at;
        db.prepare('DELETE FROM link_patterns WHERE pattern = ?').run(originalPattern);
      }
      db.prepare(
        `INSERT INTO link_patterns (pattern, type, active, created_at, updated_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(pattern) DO UPDATE SET type = excluded.type, active = excluded.active, updated_at = excluded.updated_at`,
      ).run(pattern, type, active, createdAt, now);
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
