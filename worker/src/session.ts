import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import QRCode from 'qrcode';
import makeWASocket, {
  Browsers,
  DisconnectReason,
  fetchLatestBaileysVersion,
  jidNormalizedUser,
  type WAMessage,
  type WASocket,
} from 'baileys';
import type { Boom } from '@hapi/boom';
import type { Db } from '@wadl/shared';
import { nowIso } from '@wadl/shared';
import { useSqliteAuthState } from './auth-store.ts';
import { BAILEYS_AUTH_DIR } from './paths.ts';
import { evaluateLinkGate, isSenderWhitelisted } from './gates.ts';
import { createReceivedItem } from './items.ts';

const AUTH_DB_PATH = join(BAILEYS_AUTH_DIR, 'auth.db');
export const QR_IMAGE_PATH = join(BAILEYS_AUTH_DIR, 'pairing-qr.png');

// FR-15/AD-9: transient disconnects back off and retry, capped so a dead
// network never becomes a tight reconnect loop.
const MAX_RECONNECT_ATTEMPTS = 5;
const BASE_DELAY_MS = 1_000;
const MAX_DELAY_MS = 30_000;

function recordEvent(db: Db, eventType: string, detail: string): void {
  db.prepare(
    'INSERT INTO events (event_id, item_id, event_type, detail, created_at) VALUES (?, ?, ?, ?, ?)',
  ).run(randomUUID(), null, eventType, detail, nowIso());
}

// URL-in-message-text only (SPEC constraint) — captions/attachments aren't parsed.
function extractMessageText(msg: WAMessage): string | null {
  return msg.message?.conversation ?? msg.message?.extendedTextMessage?.text ?? null;
}

function clearAuthStore(): void {
  for (const suffix of ['', '-wal', '-shm']) {
    rmSync(AUTH_DB_PATH + suffix, { force: true });
  }
}

export type ReconnectDecision =
  | { action: 'stop' }
  | { action: 'clear_and_restart' }
  | { action: 'restart' }
  | { action: 'backoff'; delayMs: number }
  | { action: 'give_up' };

// FR-15/AD-9 policy, pure so it's independently checkable — see check-reconnect-policy.ts.
export function classifyDisconnect(
  statusCode: number | undefined,
  reconnectAttempt: number,
): ReconnectDecision {
  if (statusCode === DisconnectReason.loggedOut) return { action: 'stop' };
  if (statusCode === DisconnectReason.badSession) return { action: 'clear_and_restart' };
  if (statusCode === DisconnectReason.restartRequired) return { action: 'restart' };
  if (reconnectAttempt >= MAX_RECONNECT_ATTEMPTS) return { action: 'give_up' };
  return { action: 'backoff', delayMs: Math.min(BASE_DELAY_MS * 2 ** reconnectAttempt, MAX_DELAY_MS) };
}

/**
 * Story 1.3: classify each disconnect and react per FR-15/AD-9 —
 * transient -> backoff + retry cap; restartRequired -> reconnect once;
 * badSession -> wipe auth store + restart pairing; loggedOut -> stop
 * auto-reconnect and flag for re-pair.
 */
export async function startWhatsAppSession(db: Db, reconnectAttempt = 0): Promise<WASocket> {
  mkdirSync(BAILEYS_AUTH_DIR, { recursive: true });

  const auth = useSqliteAuthState(AUTH_DB_PATH);
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth: auth.state,
    browser: Browsers.appropriate('Chrome'),
    printQRInTerminal: false, // Story 1.2 AC: QR via `qrcode`, not a terminal print
  });

  sock.ev.on('creds.update', auth.saveCreds);

  // FR-1/AD-2: sender gate — evaluated live on every incoming message so a
  // whitelist edit takes effect on the next message, no restart (AD-5).
  sock.ev.on('messages.upsert', ({ messages, type }) => {
    if (type !== 'notify') return; // skip history-sync replays, not live traffic
    for (const msg of messages) {
      if (msg.key.fromMe) continue;
      const rawJid = msg.key.participant ?? msg.key.remoteJid;
      if (!rawJid) continue;
      const senderJid = jidNormalizedUser(rawJid);

      if (!isSenderWhitelisted(db, senderJid)) {
        // Silently ignored: no download, no notification, no items row —
        // deliberately not logged per-message to avoid flooding the event log.
        continue;
      }

      recordEvent(db, 'sender_gate_passed', senderJid);

      const text = extractMessageText(msg);
      const matchedUrls = text ? evaluateLinkGate(db, text) : [];
      for (const url of matchedUrls) {
        createReceivedItem(db, senderJid, url);
      }
    }
  });

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      QRCode.toFile(QR_IMAGE_PATH, qr)
        .then(() => {
          console.log(`scannable QR written to ${QR_IMAGE_PATH}`);
          recordEvent(db, 'qr_generated', QR_IMAGE_PATH);
        })
        .catch((err: unknown) => {
          console.error('failed to render pairing QR image:', err);
        });
    }

    if (connection === 'open') {
      console.log('WhatsApp session connected');
      recordEvent(db, 'connection_open', 'session established');
    }

    if (connection === 'close') {
      const statusCode = (lastDisconnect?.error as Boom | undefined)?.output?.statusCode;
      recordEvent(db, 'connection_close', `status=${statusCode ?? 'unknown'}`);
      auth.close();

      const decision = classifyDisconnect(statusCode, reconnectAttempt);

      switch (decision.action) {
        case 'stop':
          console.log('session logged out — auto-reconnect stopped, re-pair required');
          recordEvent(db, 're_pair_required', 'logged out');
          break;

        case 'clear_and_restart':
          console.log('bad session — clearing auth store and restarting pairing');
          recordEvent(db, 're_pair_required', 'bad session, auth store cleared');
          clearAuthStore();
          void startWhatsAppSession(db, 0).catch((err) => {
            console.error('WhatsApp restart after bad session failed:', err);
          });
          break;

        case 'restart':
          console.log('restart required — reconnecting once');
          void startWhatsAppSession(db, 0).catch((err) => {
            console.error('WhatsApp reconnect after restartRequired failed:', err);
          });
          break;

        case 'give_up':
          console.log(`reconnect cap (${MAX_RECONNECT_ATTEMPTS}) reached — giving up`);
          recordEvent(db, 'reconnect_cap_reached', `after ${reconnectAttempt} attempts`);
          break;

        case 'backoff':
          console.log(
            `connection closed, reconnecting in ${decision.delayMs}ms (attempt ${reconnectAttempt + 1}/${MAX_RECONNECT_ATTEMPTS})...`,
          );
          setTimeout(() => {
            void startWhatsAppSession(db, reconnectAttempt + 1).catch((err) => {
              console.error('WhatsApp reconnection failed:', err);
            });
          }, decision.delayMs);
          break;
      }
    }
  });

  return sock;
}
