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
import { evaluateLinkGate, isMessageSenderWhitelisted } from './gates.ts';
import { createReceivedItem } from './items.ts';
import { makeTelegramClient } from './telegram.ts';
import { upsertWorkerState } from './worker-state.ts';

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

// FR-14/addendum §E: a session-invalidated state must reach the operator over
// Telegram, not just the event log — but a missing/misconfigured secret must
// never crash the always-on worker.
async function alertRePairRequired(reason: string): Promise<void> {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!botToken || !chatId) {
    console.error('re-pair required but TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID not set — alert not sent');
    return;
  }
  const result = await makeTelegramClient(botToken).sendMessage(
    chatId,
    `WhatsApp session requires re-pairing (${reason}). Scan the new QR in the dashboard.`,
  );
  if (!result.ok) console.error('re-pair alert failed:', result.detail);
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
  upsertWorkerState(db, 'connecting', null);

  const auth = useSqliteAuthState(AUTH_DB_PATH);
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth: auth.state,
    browser: Browsers.appropriate('Chrome'),
    printQRInTerminal: false, // Story 1.2 AC: QR via `qrcode`, not a terminal print
  });

  sock.ev.on('creds.update', auth.saveCreds);

  // FR-1/FR-19/AD-2/AD-18: sender gate — evaluated live on every incoming
  // message so a whitelist edit takes effect on the next message, no
  // restart (AD-5).
  sock.ev.on('messages.upsert', ({ messages, type }) => {
    if (type !== 'notify') return; // skip history-sync replays, not live traffic
    for (const msg of messages) {
      if (msg.key.fromMe) continue;
      if (!msg.key.remoteJid) continue;
      const remoteJid = jidNormalizedUser(msg.key.remoteJid);
      const participant = msg.key.participant ? jidNormalizedUser(msg.key.participant) : null;
      const senderJid = participant ?? remoteJid;

      if (!isMessageSenderWhitelisted(db, { remoteJid, participant })) {
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

  // Guards the QR data-URL render below: it resolves asynchronously, and
  // without this it can still write 'connecting' after open/close already
  // committed the terminal state.
  let qrStillCurrent = true;

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
      // FR-14: the dashboard renders the QR as an image, not a terminal print —
      // a data URL is the one representation both a <img> tag and the file need.
      QRCode.toDataURL(qr)
        .then((dataUrl) => {
          if (!qrStillCurrent) return;
          upsertWorkerState(db, 'connecting', dataUrl);
        })
        .catch((err: unknown) => {
          console.error('failed to render pairing QR data URL:', err);
        });
    }

    if (connection === 'open') {
      qrStillCurrent = false;
      console.log('WhatsApp session connected');
      recordEvent(db, 'connection_open', 'session established');
      upsertWorkerState(db, 'open', null);
    }

    if (connection === 'close') {
      qrStillCurrent = false;
      const statusCode = (lastDisconnect?.error as Boom | undefined)?.output?.statusCode;
      recordEvent(db, 'connection_close', `status=${statusCode ?? 'unknown'}`);
      auth.close();

      const decision = classifyDisconnect(statusCode, reconnectAttempt);

      switch (decision.action) {
        case 'stop':
          // addendum §E: loggedOut does not auto-reconnect to the old
          // session, but a fresh QR must still reach the dashboard — clear
          // auth state and restart pairing from scratch, same as a bad
          // session, plus the Telegram alert FR-14 requires.
          console.log('session logged out — auto-reconnect stopped, re-pairing from scratch');
          recordEvent(db, 're_pair_required', 'logged out');
          upsertWorkerState(db, 'logged_out', null);
          void alertRePairRequired('logged out').catch((err: unknown) => {
            console.error('re-pair alert failed:', err);
          });
          clearAuthStore();
          void startWhatsAppSession(db, 0).catch((err) => {
            console.error('WhatsApp restart after logout failed:', err);
          });
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
          // Exhausting the backoff cap is usually just a missed QR scan, not
          // an invalid session (that's 'stop'/'clear_and_restart' above) — it
          // must never be a silent dead-end requiring a manual redeploy to
          // recover (FR-14/FR-15 fail-safe intent). Alert the operator and
          // retry fresh after a cooldown, giving a new QR and a new attempt
          // window, indefinitely.
          console.log(`reconnect cap (${MAX_RECONNECT_ATTEMPTS}) reached — cooling down, retrying with a fresh QR`);
          recordEvent(db, 'reconnect_cap_reached', `after ${reconnectAttempt} attempts`);
          upsertWorkerState(db, 'close', null);
          void alertRePairRequired('reconnect attempts exhausted — retrying shortly with a new QR').catch(
            (err: unknown) => {
              console.error('re-pair alert failed:', err);
            },
          );
          setTimeout(() => {
            void startWhatsAppSession(db, 0).catch((err) => {
              console.error('WhatsApp restart after giving up failed:', err);
            });
          }, MAX_DELAY_MS);
          break;

        case 'backoff':
          console.log(
            `connection closed, reconnecting in ${decision.delayMs}ms (attempt ${reconnectAttempt + 1}/${MAX_RECONNECT_ATTEMPTS})...`,
          );
          upsertWorkerState(db, 'close', null);
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
