import assert from 'node:assert/strict';
import { join } from 'node:path';
import { resolveDbPath } from '@wadl/shared';

// Bugfix self-check: worker and dashboard must resolve the identical DB path
// from the same env-var precedence — this broke once when the dashboard's
// own copy of this logic didn't check WADL_DATA_DIR.
// Run: npx tsx src/check-resolve-db-path.ts

const originalDbPath = process.env.WADL_DB_PATH;
const originalDataDir = process.env.WADL_DATA_DIR;

try {
  delete process.env.WADL_DB_PATH;
  delete process.env.WADL_DATA_DIR;
  assert.equal(resolveDbPath('/default/data'), join('/default/data', 'app.db'), 'falls back to defaultDataDir/app.db');

  process.env.WADL_DATA_DIR = '/data';
  assert.equal(resolveDbPath('/default/data'), join('/data', 'app.db'), 'WADL_DATA_DIR overrides the default');

  process.env.WADL_DB_PATH = '/custom/wadl.db';
  assert.equal(resolveDbPath('/default/data'), '/custom/wadl.db', 'WADL_DB_PATH wins outright over WADL_DATA_DIR');
} finally {
  if (originalDbPath === undefined) delete process.env.WADL_DB_PATH;
  else process.env.WADL_DB_PATH = originalDbPath;
  if (originalDataDir === undefined) delete process.env.WADL_DATA_DIR;
  else process.env.WADL_DATA_DIR = originalDataDir;
}

console.log('check-resolve-db-path: ok');
