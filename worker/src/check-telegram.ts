import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb, runMigrations } from '@wadl/shared';
import { MIGRATIONS_DIR } from './paths.ts';
import { createReceivedItem } from './items.ts';
import { deliverStored } from './telegram.ts';
import type { TelegramClient } from './telegram.ts';

// Task 17 self-check (FR-9/AD-11): a clean file <=50MB is sent as a
// document; >50MB sends the too-large text instead; an extracted archive is
// announced as a filename summary, not one message per file; a send failure
// is logged as an event, never touching item status.
// Run: npx tsx src/check-telegram.ts

const root = mkdtempSync(join(tmpdir(), 'wadl-telegram-'));
const db = openDb(join(root, 'app.db'));
runMigrations(db, MIGRATIONS_DIR);

try {
  const sender = 'sender@s.whatsapp.net';
  let n = 0;
  function freshItem() {
    n += 1;
    return createReceivedItem(db, sender, `https://files.example.com/f${n}.pdf`);
  }

  function eventsFor(itemId: string): { event_type: string; detail: string | null }[] {
    return db.prepare('SELECT event_type, detail FROM events WHERE item_id = ?').all(itemId) as any;
  }

  // case 1: small file -> sent as a document.
  {
    const item = freshItem();
    const path = join(root, `${item.item_id}.pdf`);
    writeFileSync(path, 'small file');
    const calls: string[] = [];
    const client: TelegramClient = {
      sendMessage: async () => {
        calls.push('sendMessage');
        return { ok: true };
      },
      sendDocument: async () => {
        calls.push('sendDocument');
        return { ok: true };
      },
    };
    const result = await deliverStored(db, item, { kind: 'file', path, filename: 'f.pdf', sizeBytes: 11 }, client, 'chat-1');
    assert.deepEqual(result, { delivered: true });
    assert.deepEqual(calls, ['sendDocument']);
    assert.equal(eventsFor(item.item_id).some((e) => e.event_type === 'item_delivered'), true);
  }

  // case 2: file over 50MB -> too-large text message, sendDocument never called.
  {
    const item = freshItem();
    const calls: string[] = [];
    const client: TelegramClient = {
      sendMessage: async (_chatId, text) => {
        calls.push(text);
        return { ok: true };
      },
      sendDocument: async () => {
        calls.push('sendDocument');
        return { ok: true };
      },
    };
    const result = await deliverStored(
      db,
      item,
      { kind: 'file', path: '/nonexistent', filename: 'huge.bin', sizeBytes: 60 * 1024 * 1024 },
      client,
      'chat-1',
    );
    assert.deepEqual(result, { delivered: true });
    assert.deepEqual(calls, ['file ready, too large to send directly, check the dashboard']);
  }

  // case 3: extracted archive -> one summary message listing filenames, not per-file sends.
  {
    const item = freshItem();
    const sentTexts: string[] = [];
    let sendDocumentCalls = 0;
    const client: TelegramClient = {
      sendMessage: async (_chatId, text) => {
        sentTexts.push(text);
        return { ok: true };
      },
      sendDocument: async () => {
        sendDocumentCalls += 1;
        return { ok: true };
      },
    };
    const result = await deliverStored(db, item, { kind: 'archive', filenames: ['a.txt', 'b.txt', 'c.txt'] }, client, 'chat-1');
    assert.deepEqual(result, { delivered: true });
    assert.equal(sentTexts.length, 1, 'one summary message, not one per extracted file');
    assert.equal(sendDocumentCalls, 0);
    assert.ok(sentTexts[0]!.includes('a.txt') && sentTexts[0]!.includes('b.txt') && sentTexts[0]!.includes('c.txt'));
  }

  // case 4: Telegram send fails -> logged as an event, item status untouched (delivery is not a status, AD-11).
  {
    const item = freshItem();
    const statusBefore = (db.prepare('SELECT status FROM items WHERE item_id = ?').get(item.item_id) as { status: string }).status;
    const client: TelegramClient = {
      sendMessage: async () => ({ ok: false, detail: 'HTTP 500' }),
      sendDocument: async () => ({ ok: false, detail: 'HTTP 500' }),
    };
    const result = await deliverStored(db, item, { kind: 'archive', filenames: ['x.txt'] }, client, 'chat-1');
    assert.deepEqual(result, { delivered: false, reason: 'HTTP 500' });
    assert.equal(eventsFor(item.item_id).some((e) => e.event_type === 'delivery_failed'), true);
    const statusAfter = (db.prepare('SELECT status FROM items WHERE item_id = ?').get(item.item_id) as { status: string }).status;
    assert.equal(statusAfter, statusBefore, 'a delivery failure never touches item status');
  }

  // case 5: archive with a huge filename list -> summary truncated to Telegram's 4096-char limit.
  {
    const item = freshItem();
    const sentTexts: string[] = [];
    const client: TelegramClient = {
      sendMessage: async (_chatId, text) => {
        sentTexts.push(text);
        return { ok: true };
      },
      sendDocument: async () => ({ ok: true }),
    };
    const filenames = Array.from({ length: 500 }, (_, i) => `file-${i}-with-a-somewhat-long-name.txt`);
    const result = await deliverStored(db, item, { kind: 'archive', filenames }, client, 'chat-1');
    assert.deepEqual(result, { delivered: true });
    assert.ok(sentTexts[0]!.length <= 4096, 'summary never exceeds telegram message limit');
    assert.ok(sentTexts[0]!.includes('truncated'));
  }

  // case 6: a rejecting client call (e.g. readFile failure) is still logged as delivery_failed.
  {
    const item = freshItem();
    const client: TelegramClient = {
      sendMessage: async () => {
        throw new Error('ENOENT');
      },
      sendDocument: async () => {
        throw new Error('ENOENT');
      },
    };
    const result = await deliverStored(db, item, { kind: 'archive', filenames: ['x.txt'] }, client, 'chat-1');
    assert.equal(result.delivered, false);
    assert.equal(eventsFor(item.item_id).some((e) => e.event_type === 'delivery_failed'), true);
  }

  console.log('check-telegram: ok');
} finally {
  db.close();
  rmSync(root, { recursive: true, force: true });
}
