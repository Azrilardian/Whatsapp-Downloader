import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb, runMigrations } from '@wadl/shared';

// Task 19 self-check (FR-12/AD-2): add/edit(rename-by-PK)/activate/
// deactivate/delete persist correctly for both contacts and link_patterns.
// WADL_DB_PATH is set before importing db.ts so its module-level DB_PATH
// constant resolves to this temp file instead of the real data/app.db.
// Run: npx tsx lib/check-whitelists.ts

const root = mkdtempSync(join(tmpdir(), 'wadl-whitelists-'));
const dbPath = join(root, 'app.db');
process.env.WADL_DB_PATH = dbPath;

const setupDb = openDb(dbPath);
runMigrations(setupDb, join(process.cwd(), '..', 'shared', 'migrations'));
setupDb.close();

const {
  listContacts,
  listLinkPatterns,
  saveContact,
  setContactActive,
  deleteContact,
  saveLinkPattern,
  setLinkPatternActive,
  deleteLinkPattern,
} = await import('./db.ts');

try {
  function contact(jid: string) {
    return listContacts().find((c) => c.jid === jid);
  }

  // add
  saveContact(null, 'a@s.whatsapp.net', 'Alice', 1);
  assert.equal(contact('a@s.whatsapp.net')?.label, 'Alice');
  assert.equal(contact('a@s.whatsapp.net')?.active, 1);

  // edit label (same PK)
  saveContact('a@s.whatsapp.net', 'a@s.whatsapp.net', 'Alice Renamed', 1);
  assert.equal(contact('a@s.whatsapp.net')?.label, 'Alice Renamed');

  // rename the jid itself (PK change) -> old row gone, new row carries the edited fields
  const createdAtBeforeRename = contact('a@s.whatsapp.net')?.created_at;
  saveContact('a@s.whatsapp.net', 'a-new@s.whatsapp.net', 'Alice Renamed', 1);
  assert.equal(contact('a@s.whatsapp.net'), undefined, 'renaming the jid removes the old PK row');
  assert.equal(contact('a-new@s.whatsapp.net')?.label, 'Alice Renamed');
  assert.equal(contact('a-new@s.whatsapp.net')?.created_at, createdAtBeforeRename, 'rename preserves created_at');

  // renaming onto an existing jid must not silently merge the two rows
  saveContact(null, 'b@s.whatsapp.net', 'Bob', 1);
  assert.throws(() => saveContact('a-new@s.whatsapp.net', 'b@s.whatsapp.net', 'Alice', 1));
  assert.equal(contact('a-new@s.whatsapp.net')?.label, 'Alice Renamed', 'failed rename leaves the original row untouched');
  assert.equal(contact('b@s.whatsapp.net')?.label, 'Bob', 'failed rename never overwrites the target row');
  deleteContact('b@s.whatsapp.net');

  // deactivate / activate
  setContactActive('a-new@s.whatsapp.net', 0);
  assert.equal(contact('a-new@s.whatsapp.net')?.active, 0);
  setContactActive('a-new@s.whatsapp.net', 1);
  assert.equal(contact('a-new@s.whatsapp.net')?.active, 1);

  // delete
  deleteContact('a-new@s.whatsapp.net');
  assert.equal(contact('a-new@s.whatsapp.net'), undefined);

  function pattern(p: string) {
    return listLinkPatterns().find((row) => row.pattern === p);
  }

  saveLinkPattern(null, 'build.example.com', 'domain', 1);
  assert.equal(pattern('build.example.com')?.type, 'domain');
  assert.equal(pattern('build.example.com')?.active, 1);

  const patternCreatedAtBeforeRename = pattern('build.example.com')?.created_at;
  saveLinkPattern('build.example.com', '.zip', 'extension', 0);
  assert.equal(pattern('build.example.com'), undefined, 'renaming the pattern removes the old PK row');
  assert.equal(pattern('.zip')?.type, 'extension');
  assert.equal(pattern('.zip')?.active, 0);
  assert.equal(pattern('.zip')?.created_at, patternCreatedAtBeforeRename, 'rename preserves created_at');

  saveLinkPattern(null, '.tar.gz', 'extension', 1);
  assert.throws(() => saveLinkPattern('.zip', '.tar.gz', 'extension', 1));
  assert.equal(pattern('.zip')?.active, 0, 'failed rename leaves the original row untouched');
  assert.equal(pattern('.tar.gz')?.active, 1, 'failed rename never overwrites the target row');
  deleteLinkPattern('.tar.gz');

  setLinkPatternActive('.zip', 1);
  assert.equal(pattern('.zip')?.active, 1);

  deleteLinkPattern('.zip');
  assert.equal(pattern('.zip'), undefined);

  console.log('check-whitelists: ok');
} finally {
  rmSync(root, { recursive: true, force: true });
}
