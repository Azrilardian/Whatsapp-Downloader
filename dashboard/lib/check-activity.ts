import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { openDb, runMigrations } from '@wadl/shared';

// Task 20 self-check (FR-13/AD-1): every event is returned with its item's
// context (sender/link/filename/scan result/status); quarantined items are
// listed distinctly from stored/delivered ones.
// WADL_DB_PATH is set before importing db.ts so its module-level DB_PATH
// constant resolves to this temp file instead of the real data/app.db.
// Run: npx tsx lib/check-activity.ts

const root = mkdtempSync(join(tmpdir(), 'wadl-activity-'));
const dbPath = join(root, 'app.db');
process.env.WADL_DB_PATH = dbPath;

try {
  let setupDb: ReturnType<typeof openDb> | undefined;
  let storedItem: string;
  let quarantinedItem: string;

  try {
    setupDb = openDb(dbPath);
    runMigrations(setupDb, join(process.cwd(), '..', 'shared', 'migrations'));

    const now = () => new Date().toISOString();
    const db = setupDb;

    function insertItem(status: string, filename: string | null, scanResult: string | null) {
      const itemId = randomUUID();
      db.prepare(
        `INSERT INTO items (item_id, status, sender_jid, source_url, url_hash, filename, scan_result, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(itemId, status, 'sender@s.whatsapp.net', 'https://files.example.com/f.pdf', 'hash', filename, scanResult, now(), now());
      return itemId;
    }

    function insertEvent(itemId: string | null, eventType: string, detail: string | null) {
      db.prepare('INSERT INTO events (event_id, item_id, event_type, detail, created_at) VALUES (?, ?, ?, ?, ?)').run(
        randomUUID(),
        itemId,
        eventType,
        detail,
        now(),
      );
    }

    storedItem = insertItem('stored', 'f.pdf', 'clean');
    insertEvent(storedItem, 'item_stored', '/data/final/f.pdf');

    quarantinedItem = insertItem('quarantined', null, 'clamav: Eicar-Test-Signature');
    insertEvent(quarantinedItem, 'item_quarantined', 'clamav: Eicar-Test-Signature');

    insertEvent(null, 'worker_started', null); // system-level event, no item
  } finally {
    setupDb?.close();
  }

  const { listEvents, listQuarantined } = await import('./db.ts');

  const events = listEvents();
  assert.equal(events.length, 3);

  const storedEvent = events.find((e) => e.event_type === 'item_stored');
  assert.ok(storedEvent, 'item_stored event present');
  assert.equal(storedEvent!.sender_jid, 'sender@s.whatsapp.net', 'event carries its item context via the join');
  assert.equal(storedEvent!.filename, 'f.pdf');
  assert.equal(storedEvent!.scan_result, 'clean');
  assert.equal(storedEvent!.status, 'stored');

  const systemEvent = events.find((e) => e.event_type === 'worker_started');
  assert.ok(systemEvent, 'system-level (item-less) event present');
  assert.equal(systemEvent!.item_id, null);
  assert.equal(systemEvent!.sender_jid, null, 'no item to join against for a system-level event');

  const quarantined = listQuarantined();
  assert.equal(quarantined.length, 1);
  assert.equal(quarantined[0]!.item_id, quarantinedItem);
  assert.equal(
    quarantined.some((i) => i.item_id === storedItem),
    false,
    'a stored item never appears in the quarantine list',
  );

  console.log('check-activity: ok');
} finally {
  rmSync(root, { recursive: true, force: true });
}
