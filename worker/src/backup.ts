import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Db } from '@wadl/shared';
import { nowIso } from '@wadl/shared';

// AD-16/NFR-5: the SQLite file and the final/ store are backed up on a
// schedule, and the events log has a defined retention — both cadence and
// window are read live from `settings` (AD-17), not hardcoded.

const LAST_BACKUP_MARKER = '.last-backup';
const MAINTENANCE_CHECK_INTERVAL_MS = 60 * 60 * 1000; // check hourly; the marker gates actual cadence

const DEFAULT_CADENCE_MS = 24 * 60 * 60 * 1000; // daily

const CADENCE_MS: Record<string, number> = {
  hourly: 60 * 60 * 1000,
  daily: DEFAULT_CADENCE_MS,
  weekly: 7 * 24 * 60 * 60 * 1000,
};

export function resolveCadenceMs(cadence: string): number {
  return CADENCE_MS[cadence] ?? DEFAULT_CADENCE_MS;
}

export function isBackupDue(lastBackupAt: Date | null, cadenceMs: number, now: Date): boolean {
  if (!lastBackupAt) return true;
  return now.getTime() - lastBackupAt.getTime() >= cadenceMs;
}

function getSetting(db: Db, key: string, fallback: string): string {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
  return row?.value ?? fallback;
}

function readLastBackupAt(backupsRoot: string): Date | null {
  const markerPath = join(backupsRoot, LAST_BACKUP_MARKER);
  if (!existsSync(markerPath)) return null;
  return statSync(markerPath).mtime;
}

export interface BackupRoots {
  final: string;
  backups: string;
}

export interface BackupResult {
  dir: string;
}

/** One backup cycle: a hot copy of the SQLite file plus a copy of final/, into a timestamped dir under backups/. */
export async function runBackup(db: Db, roots: BackupRoots): Promise<BackupResult> {
  mkdirSync(roots.backups, { recursive: true });
  const dir = join(roots.backups, nowIso().replace(/[:.]/g, '-'));
  mkdirSync(dir, { recursive: true });

  // A hot backup via SQLite's own backup API is safe to run against a live,
  // WAL-mode connection — unlike a raw file copy, it can't capture a
  // mid-checkpoint tear.
  await db.backup(join(dir, 'app.db'));

  if (existsSync(roots.final)) {
    cpSync(roots.final, join(dir, 'final'), { recursive: true });
  }

  writeFileSync(join(roots.backups, LAST_BACKUP_MARKER), nowIso());
  return { dir };
}

/** Deletes events older than the retention window. Returns the number of rows removed. */
export function pruneEventsRetention(db: Db, retentionDays: number): number {
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000).toISOString();
  const result = db.prepare('DELETE FROM events WHERE created_at < ?').run(cutoff);
  return result.changes;
}

function pruneOldBackupDirs(backupsRoot: string, keep = 30): void {
  if (!existsSync(backupsRoot)) return;
  const dirs = readdirSync(backupsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  for (const name of dirs.slice(0, Math.max(0, dirs.length - keep))) {
    rmSync(join(backupsRoot, name), { recursive: true, force: true });
  }
}

async function runMaintenanceCycle(db: Db, roots: BackupRoots): Promise<void> {
  const retentionDays = Number.parseInt(getSetting(db, 'events_retention_days', '90'), 10);
  const pruned = pruneEventsRetention(db, retentionDays);
  if (pruned > 0) console.log(`events retention: pruned ${pruned} row(s) older than ${retentionDays}d`);

  const cadenceMs = resolveCadenceMs(getSetting(db, 'backup_cadence', 'daily'));
  if (isBackupDue(readLastBackupAt(roots.backups), cadenceMs, new Date())) {
    const { dir } = await runBackup(db, roots);
    pruneOldBackupDirs(roots.backups);
    console.log(`backup complete -> ${dir}`);
  }
}

/**
 * AD-16: schedules the recurring backup + retention maintenance for the life
 * of the process. Runs one cycle immediately (safe resume after a pm2
 * restart never skips a day) and then on an hourly poll — the marker file
 * gates when a backup is actually due, so the poll interval is just a
 * resolution, not the cadence itself.
 */
export function scheduleMaintenance(db: Db, roots: BackupRoots): void {
  void runMaintenanceCycle(db, roots).catch((err: unknown) => {
    console.error('backup/retention maintenance failed:', err);
  });
  setInterval(() => {
    void runMaintenanceCycle(db, roots).catch((err: unknown) => {
      console.error('backup/retention maintenance failed:', err);
    });
  }, MAINTENANCE_CHECK_INTERVAL_MS);
}
