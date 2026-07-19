import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { openDb, runMigrations, nowIso } from '@wadl/shared';
import { MIGRATIONS_DIR } from './paths.ts';
import { downloadToStaging } from './download.ts';
import type { GuardedFetchDeps } from './guarded-fetch.ts';

// Task 11 self-check (FR-3/AD-6/AD-17): unacceptable Content-Type rejected
// pre-body, size is a streaming cap that aborts+discards mid-transfer on
// exceed, and a valid file lands only in staging/.
// Run: npx tsx src/check-download.ts

const root = mkdtempSync(join(tmpdir(), 'wadl-download-'));
const stagingDir = join(root, 'staging');

const db = openDb(join(root, 'app.db'));
runMigrations(db, MIGRATIONS_DIR);

const now = () => nowIso();
db.prepare(
  'INSERT INTO link_patterns (pattern, type, active, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
).run('good.example.com', 'domain', 1, now(), now());

function fakeResponse(statusCode: number, headers: Record<string, string>, body?: Buffer): any {
  const stream = body ? Readable.from([body]) : new Readable({ read() {} });
  Object.assign(stream, { statusCode, headers });
  return stream;
}

function makeItem(overrides: Partial<{ item_id: string; source_url: string }> = {}) {
  return {
    item_id: overrides.item_id ?? 'item-1',
    status: 'received' as const,
    sender_jid: 'sender@example.com',
    source_url: overrides.source_url ?? 'https://good.example.com/a.pdf',
    url_hash: 'hash',
    content_sha256: null,
    filename: null,
    size_bytes: null,
    scan_result: null,
    created_at: now(),
    updated_at: now(),
  };
}

// case 1: guardedFetch itself fails (e.g. pattern mismatch) -> propagated as-is.
{
  const deps: GuardedFetchDeps = {
    lookup: async () => ({ address: '93.184.216.34' }),
    request: async () => fakeResponse(200, {}),
  };
  const item = makeItem({ item_id: 'item-mismatch', source_url: 'https://unmatched.example.com/a.pdf' });
  const result = await downloadToStaging(db, item, stagingDir, deps);
  assert.equal(result.ok, false);
  assert.equal(!result.ok && result.reason, 'pattern_mismatch');
}

// case 2: unacceptable Content-Type -> rejected before body is read, nothing staged.
{
  const body = Buffer.from('<html>not a file</html>');
  const deps: GuardedFetchDeps = {
    lookup: async () => ({ address: '93.184.216.34' }),
    request: async () => fakeResponse(200, { 'content-type': 'text/html; charset=utf-8' }, body),
  };
  const item = makeItem({ item_id: 'item-html' });
  const result = await downloadToStaging(db, item, stagingDir, deps);
  assert.equal(result.ok, false);
  assert.equal(!result.ok && result.reason, 'unacceptable_type');
  assert.equal(existsSync(join(stagingDir, 'item-html')), false);
}

// case 3: clean small file -> staged, sha256 + size recorded, real bytes on disk.
{
  const body = Buffer.from('hello world');
  const deps: GuardedFetchDeps = {
    lookup: async () => ({ address: '93.184.216.34' }),
    request: async () => fakeResponse(200, { 'content-type': 'application/octet-stream' }, body),
  };
  const item = makeItem({ item_id: 'item-clean' });
  const result = await downloadToStaging(db, item, stagingDir, deps);
  assert.equal(result.ok, true);
  assert.ok(result.ok && result.path === join(stagingDir, 'item-clean'));
  assert.equal(result.ok && result.sizeBytes, body.length);
  assert.equal(result.ok && result.sha256, createHash('sha256').update(body).digest('hex'));
  assert.equal(result.ok && readFileSync(result.path).equals(body), true);
}

// case 4: body exceeds max_download_bytes -> aborted mid-transfer, partial discarded.
{
  db.prepare('UPDATE settings SET value = ? WHERE key = ?').run('10', 'max_download_bytes');
  const body = Buffer.from('this body is definitely longer than ten bytes');
  const deps: GuardedFetchDeps = {
    lookup: async () => ({ address: '93.184.216.34' }),
    request: async () => fakeResponse(200, { 'content-type': 'application/octet-stream' }, body),
  };
  const item = makeItem({ item_id: 'item-toolarge' });
  const result = await downloadToStaging(db, item, stagingDir, deps);
  assert.equal(result.ok, false);
  assert.equal(!result.ok && result.reason, 'too_large');
  assert.equal(existsSync(join(stagingDir, 'item-toolarge')), false);
  db.prepare('UPDATE settings SET value = ? WHERE key = ?').run('209715200', 'max_download_bytes');
}

db.close();
console.log('check-download: ok');
