import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Db } from './db.ts';

// AD-4: the worker is the only caller of this runner; the dashboard treats the
// schema as a read-only contract. Versioning uses PRAGMA user_version, and each
// migration file is applied inside a transaction.

const MIGRATION_FILE = /^(\d+)_.+\.sql$/;

export interface MigrationResult {
  from: number;
  to: number;
  applied: string[];
}

export function runMigrations(db: Db, migrationsDir: string): MigrationResult {
  const files = readdirSync(migrationsDir)
    .filter((f) => MIGRATION_FILE.test(f))
    .sort((a, b) => versionOf(a) - versionOf(b));

  const from = db.pragma('user_version', { simple: true }) as number;
  const applied: string[] = [];
  let current = from;

  for (const file of files) {
    const version = versionOf(file);
    if (version <= current) continue;
    const sql = readFileSync(join(migrationsDir, file), 'utf8');
    db.transaction(() => {
      db.exec(sql);
      db.pragma(`user_version = ${version}`);
    })();
    current = version;
    applied.push(file);
  }

  return { from, to: current, applied };
}

function versionOf(file: string): number {
  const match = MIGRATION_FILE.exec(file);
  if (!match?.[1]) throw new Error(`not a migration file: ${file}`);
  return Number.parseInt(match[1], 10);
}
