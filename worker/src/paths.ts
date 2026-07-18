import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

// Load .env here, before WADL_DATA_DIR/WADL_DB_PATH are read below — static
// imports are hoisted and this module's top-level code runs before any
// statement in an importing file, so loading .env in the importer (e.g.
// index.ts) after `import ... from './paths.ts'` would be too late. Resolved
// against repoRoot, not cwd — `npm run --workspace worker ...` runs with
// cwd=worker/, where a relative './env' would silently miss the real file.
try {
  process.loadEnvFile(join(repoRoot, '.env'));
} catch {
  // no .env yet — nothing to load
}

export const DATA_ROOT = process.env.WADL_DATA_DIR ?? join(repoRoot, 'data');

// AD-7: distinct roots — a file's directory must match its DB status.
export const STAGING_DIR = join(DATA_ROOT, 'staging');
export const FINAL_DIR = join(DATA_ROOT, 'final');
export const QUARANTINE_DIR = join(DATA_ROOT, 'quarantine');
export const EXTRACT_DIR = join(DATA_ROOT, 'extract');

// AD-9: Baileys auth lives in its own worker-owned store, not the shared DB.
export const BAILEYS_AUTH_DIR = join(DATA_ROOT, 'baileys-auth');

// AD-16: scheduled backups of the SQLite file + final/ store live outside
// the roots above so a backup run is never mistaken for pipeline state.
export const BACKUPS_DIR = process.env.WADL_BACKUPS_DIR ?? join(DATA_ROOT, 'backups');

export const DB_PATH = process.env.WADL_DB_PATH ?? join(DATA_ROOT, 'app.db');
export const MIGRATIONS_DIR = join(repoRoot, 'shared', 'migrations');
