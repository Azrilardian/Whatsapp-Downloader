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
  saveContact('a@s.whatsapp.net', 'a-new@s.whatsapp.net', 'Alice Renamed', 1);
  assert.equal(contact('a@s.whatsapp.net'), undefined, 'renaming the jid removes the old PK row');
  assert.equal(contact('a-new@s.whatsapp.net')?.label, 'Alice Renamed');

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

  saveLinkPattern('build.example.com', '.zip', 'extension', 0);
  assert.equal(pattern('build.example.com'), undefined, 'renaming the pattern removes the old PK row');
  assert.equal(pattern('.zip')?.type, 'extension');
  assert.equal(pattern('.zip')?.active, 0);

  setLinkPatternActive('.zip', 1);
  assert.equal(pattern('.zip')?.active, 1);

  deleteLinkPattern('.zip');
  assert.equal(pattern('.zip'), undefined);

  console.log('check-whitelists: ok');
} finally {
  rmSync(root, { recursive: true, force: true });
}
