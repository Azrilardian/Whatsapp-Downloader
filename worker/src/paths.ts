import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

export const DATA_ROOT = process.env.WADL_DATA_DIR ?? join(repoRoot, 'data');

// AD-7: distinct roots — a file's directory must match its DB status.
export const STAGING_DIR = join(DATA_ROOT, 'staging');
export const FINAL_DIR = join(DATA_ROOT, 'final');
export const QUARANTINE_DIR = join(DATA_ROOT, 'quarantine');
export const EXTRACT_DIR = join(DATA_ROOT, 'extract');

// AD-9: Baileys auth lives in its own worker-owned store, not the shared DB.
export const BAILEYS_AUTH_DIR = join(DATA_ROOT, 'baileys-auth');

export const DB_PATH = process.env.WADL_DB_PATH ?? join(DATA_ROOT, 'app.db');
export const MIGRATIONS_DIR = join(repoRoot, 'shared', 'migrations');
