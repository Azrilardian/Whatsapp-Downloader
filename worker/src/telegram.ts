import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { Db, ItemRow } from '@wadl/shared';
import { nowIso } from '@wadl/shared';

export interface TelegramSendResult {
  ok: boolean;
  detail?: string;
}

export interface TelegramClient {
  sendMessage(chatId: string, text: string): Promise<TelegramSendResult>;
  sendDocument(chatId: string, filePath: string, filename: string): Promise<TelegramSendResult>;
}

const TELEGRAM_API = 'https://api.telegram.org';

/** FR-9/AD-11: plain HTTPS fetch, no client library, no persistent connection. */
export function makeTelegramClient(botToken: string): TelegramClient {
  async function post(method: string, body: string | FormData, contentType?: string): Promise<TelegramSendResult> {
    try {
      const res = await fetch(`${TELEGRAM_API}/bot${botToken}/${method}`, {
        method: 'POST',
        body,
        headers: contentType ? { 'content-type': contentType } : undefined,
      });
      if (!res.ok) return { ok: false, detail: `HTTP ${res.status}` };
      return { ok: true };
    } catch (err) {
      return { ok: false, detail: String(err) };
    }
  }

  return {
    sendMessage(chatId, text) {
      return post('sendMessage', JSON.stringify({ chat_id: chatId, text }), 'application/json');
    },
    async sendDocument(chatId, filePath, filename) {
      const buf = await readFile(filePath);
      const form = new FormData();
      form.set('chat_id', chatId);
      form.set('document', new Blob([buf]), filename);
      return post('sendDocument', form);
    },
  };
}

// Telegram Bot API's own hard upload limit for sendDocument — a platform
// constant, not an operator-tunable policy (unlike the settings-table caps).
const TELEGRAM_MAX_FILE_BYTES = 50 * 1024 * 1024;

export type DeliveryInput =
  | { kind: 'file'; path: string; filename: string; sizeBytes: number }
  | { kind: 'archive'; filenames: string[] };

export type DeliveryResult = { delivered: true } | { delivered: false; reason: string };

function logEvent(db: Db, item: ItemRow, eventType: string, detail: string | null, now: string): void {
  db.prepare('INSERT INTO events (event_id, item_id, event_type, detail, created_at) VALUES (?, ?, ?, ?, ?)').run(
    randomUUID(),
    item.item_id,
    eventType,
    detail,
    now,
  );
}

/**
 * FR-9/FR-10/AD-11: delivery is not a status (only an Event) — a send
 * failure is recorded and surfaced here, never retried, never reversing the
 * item's already-terminal pipeline status.
 */
async function sendAndLog(
  db: Db,
  item: ItemRow,
  send: () => Promise<TelegramSendResult>,
  successDetail: string,
  now: string,
): Promise<DeliveryResult> {
  const result = await send();
  if (result.ok) {
    logEvent(db, item, 'item_delivered', successDetail, now);
    return { delivered: true };
  }
  logEvent(db, item, 'delivery_failed', result.detail ?? 'unknown error', now);
  return { delivered: false, reason: result.detail ?? 'unknown error' };
}

/** FR-9/AD-11: notifies the Operator over Telegram on a successful terminal outcome (stored). */
export function deliverStored(
  db: Db,
  item: ItemRow,
  input: DeliveryInput,
  client: TelegramClient,
  chatId: string,
): Promise<DeliveryResult> {
  const now = nowIso();

  if (input.kind === 'archive') {
    const summary = `Archive extracted (${input.filenames.length} file(s)):\n${input.filenames.join('\n')}`;
    return sendAndLog(db, item, () => client.sendMessage(chatId, summary), `archive: ${input.filenames.length} files`, now);
  }
  if (input.sizeBytes > TELEGRAM_MAX_FILE_BYTES) {
    return sendAndLog(
      db,
      item,
      () => client.sendMessage(chatId, 'file ready, too large to send directly, check the dashboard'),
      input.filename,
      now,
    );
  }
  return sendAndLog(db, item, () => client.sendDocument(chatId, input.path, input.filename), input.filename, now);
}

/** FR-10/AD-11: notifies the Operator over Telegram on a quarantine or other pipeline failure — never fails silently. */
export function notifyFailure(
  db: Db,
  item: ItemRow,
  reason: string,
  client: TelegramClient,
  chatId: string,
): Promise<DeliveryResult> {
  const now = nowIso();
  const text = `Quarantined/failed: ${item.source_url}\nReason: ${reason}`;
  return sendAndLog(db, item, () => client.sendMessage(chatId, text), `failure notice: ${reason}`, now);
}
