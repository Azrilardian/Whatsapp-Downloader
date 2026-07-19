import assert from 'node:assert/strict';
import { createWriteStream, existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import yazl from 'yazl';
import { openDb, runMigrations } from '@wadl/shared';
import { MIGRATIONS_DIR } from './paths.ts';
import { createReceivedItem } from './items.ts';
import { extractArchive, safeDestPath } from './extract.ts';
import type { ScannerClient } from './scanner.ts';

// Task 14 self-check (FR-7/AD-7/AD-17): recursive caps abort+quarantine on
// exceed; symlink/zip-slip entries rejected via canonical path; extracted
// contents re-scanned before any move.
// Run: npx tsx src/check-extract.ts

// --- safeDestPath: pure zip-slip/absolute-path guard, unit-tested directly
// (yazl itself refuses to author a "../" entry, so this can't round-trip
// through a real zip file). ---
{
  const dest = safeDestPath('/tmp/extract-root', 'a/b.txt');
  assert.equal(dest, join('/tmp/extract-root', 'a', 'b.txt'));
}
assert.throws(() => safeDestPath('/tmp/extract-root', '../../etc/passwd'));
assert.throws(() => safeDestPath('/tmp/extract-root', '/etc/passwd'));

function buildZip(root: string, name: string, entries: { path: string; content: string; mode?: number }[]): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    const zipfile = new yazl.ZipFile();
    for (const entry of entries) {
      zipfile.addBuffer(Buffer.from(entry.content), entry.path, entry.mode ? { mode: entry.mode } : undefined);
    }
    const dest = join(root, name);
    zipfile.outputStream.pipe(createWriteStream(dest)).on('close', () => resolvePromise(dest)).on('error', reject);
    zipfile.end();
  });
}

const root = mkdtempSync(join(tmpdir(), 'wadl-extract-'));
const extractRoot = join(root, 'extract');
const db = openDb(join(root, 'app.db'));
runMigrations(db, MIGRATIONS_DIR);

const sender = 'sender@s.whatsapp.net';
let n = 0;
function freshItem() {
  n += 1;
  return createReceivedItem(db, sender, `https://files.example.com/f${n}.zip`);
}

const CURRENT_VERSION = `ClamAV 1.0.0/27000/${new Date().toUTCString()}`;
const cleanScanner: ScannerClient = {
  getVersion: async () => CURRENT_VERSION,
  isInfected: async () => ({ isInfected: false, viruses: [] }),
};

// case 1: clean small zip -> extracts, re-scans clean, files present on disk.
{
  const item = freshItem();
  const zipPath = await buildZip(root, 'clean.zip', [
    { path: 'readme.txt', content: 'hello world' },
    { path: 'dir/nested.txt', content: 'nested content' },
  ]);
  const result = await extractArchive(db, item, zipPath, cleanScanner, extractRoot);
  assert.equal(result.ok, true);
  assert.ok(result.ok && existsSync(join(result.extractRoot, 'readme.txt')));
  assert.ok(result.ok && readFileSync(join(result.extractRoot, 'dir', 'nested.txt'), 'utf8') === 'nested content');
  assert.equal(result.ok && result.fileCount, 2);
}

// case 2: symlink entry -> unsafe_entry, item quarantined, nothing left on disk.
{
  const item = freshItem();
  const zipPath = await buildZip(root, 'symlink.zip', [{ path: 'evil-link', content: '/etc/passwd', mode: 0o120777 }]);
  const result = await extractArchive(db, item, zipPath, cleanScanner, extractRoot);
  assert.equal(result.ok, false);
  assert.equal(!result.ok && result.reason, 'unsafe_entry');
  const row = db.prepare('SELECT status FROM items WHERE item_id = ?').get(item.item_id) as { status: string };
  assert.equal(row.status, 'quarantined');
  assert.equal(existsSync(join(extractRoot, item.item_id)), false);
}

// case 3: file count cap exceeded -> cap_exceeded, quarantined, discarded.
{
  db.prepare('UPDATE settings SET value = ? WHERE key = ?').run('2', 'max_file_count');
  const item = freshItem();
  const zipPath = await buildZip(root, 'toomany.zip', [
    { path: 'a.txt', content: 'a' },
    { path: 'b.txt', content: 'b' },
    { path: 'c.txt', content: 'c' },
  ]);
  const result = await extractArchive(db, item, zipPath, cleanScanner, extractRoot);
  assert.equal(result.ok, false);
  assert.equal(!result.ok && result.reason, 'cap_exceeded');
  assert.equal(existsSync(join(extractRoot, item.item_id)), false);
  db.prepare('UPDATE settings SET value = ? WHERE key = ?').run('1000', 'max_file_count');
}

// case 4: uncompressed size cap exceeded -> cap_exceeded, discarded mid-extraction.
{
  db.prepare('UPDATE settings SET value = ? WHERE key = ?').run('5', 'max_uncompressed_bytes');
  const item = freshItem();
  const zipPath = await buildZip(root, 'toobig.zip', [{ path: 'big.txt', content: 'this is definitely over five bytes' }]);
  const result = await extractArchive(db, item, zipPath, cleanScanner, extractRoot);
  assert.equal(result.ok, false);
  assert.equal(!result.ok && result.reason, 'cap_exceeded');
  db.prepare('UPDATE settings SET value = ? WHERE key = ?').run('524288000', 'max_uncompressed_bytes');
}

// case 5: nested zip within nesting-depth cap -> extracted recursively, both levels present.
{
  const item = freshItem();
  const innerPath = await buildZip(root, 'inner.zip', [{ path: 'inner-file.txt', content: 'inner' }]);
  const innerBytes = readFileSync(innerPath);
  const outerPath = join(root, 'outer.zip');
  await new Promise<void>((resolvePromise, reject) => {
    const zipfile = new yazl.ZipFile();
    zipfile.addBuffer(innerBytes, 'inner.zip');
    zipfile.outputStream.pipe(createWriteStream(outerPath)).on('close', () => resolvePromise()).on('error', reject);
    zipfile.end();
  });
  const result = await extractArchive(db, item, outerPath, cleanScanner, extractRoot);
  assert.equal(result.ok, true);
  assert.ok(result.ok && existsSync(join(result.extractRoot, 'inner.zip')));
  assert.ok(result.ok && existsSync(join(result.extractRoot, 'inner.zip.d', 'inner-file.txt')));
}

// case 6: nested zip beyond max_nesting_depth -> cap_exceeded.
{
  db.prepare('UPDATE settings SET value = ? WHERE key = ?').run('0', 'max_nesting_depth');
  const item = freshItem();
  const innerPath = await buildZip(root, 'inner2.zip', [{ path: 'x.txt', content: 'x' }]);
  const innerBytes = readFileSync(innerPath);
  const outerPath = join(root, 'outer2.zip');
  await new Promise<void>((resolvePromise, reject) => {
    const zipfile = new yazl.ZipFile();
    zipfile.addBuffer(innerBytes, 'inner2.zip');
    zipfile.outputStream.pipe(createWriteStream(outerPath)).on('close', () => resolvePromise()).on('error', reject);
    zipfile.end();
  });
  const result = await extractArchive(db, item, outerPath, cleanScanner, extractRoot);
  assert.equal(result.ok, false);
  assert.equal(!result.ok && result.reason, 'cap_exceeded');
  db.prepare('UPDATE settings SET value = ? WHERE key = ?').run('3', 'max_nesting_depth');
}

// case 7: re-scan finds malware in an extracted file -> rescan_failed, discarded.
{
  const item = freshItem();
  const zipPath = await buildZip(root, 'malware.zip', [{ path: 'payload.exe', content: 'evil' }]);
  const infectedScanner: ScannerClient = {
    getVersion: async () => CURRENT_VERSION,
    isInfected: async () => ({ isInfected: true, viruses: ['Eicar-Test-Signature'] }),
  };
  const result = await extractArchive(db, item, zipPath, infectedScanner, extractRoot);
  assert.equal(result.ok, false);
  assert.equal(!result.ok && result.reason, 'rescan_failed');
  assert.equal(existsSync(join(extractRoot, item.item_id)), false);
}

db.close();
console.log('check-extract: ok');
