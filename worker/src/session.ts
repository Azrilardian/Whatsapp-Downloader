import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import QRCode from 'qrcode';
import makeWASocket, {
  Browsers,
  DisconnectReason,
  fetchLatestBaileysVersion,
  type WASocket,
} from 'baileys';
import type { Boom } from '@hapi/boom';
import type { Db } from '@wadl/shared';
import { nowIso } from '@wadl/shared';
import { useSqliteAuthState } from './auth-store.ts';
import { BAILEYS_AUTH_DIR } from './paths.ts';

const AUTH_DB_PATH = join(BAILEYS_AUTH_DIR, 'auth.db');
export const QR_IMAGE_PATH = join(BAILEYS_AUTH_DIR, 'pairing-qr.png');

function recordEvent(db: Db, eventType: string, detail: string): void {
  db.prepare(
    'INSERT INTO events (event_id, item_id, event_type, detail, created_at) VALUES (?, ?, ?, ?, ?)',
  ).run(randomUUID(), null, eventType, detail, nowIso());
}

/**
 * Story 1.2: pair the dedicated secondary number by scanning a QR (FR-14,
 * partial) using a worker-owned auth store (AD-9). Story 1.3's full
 * reconnection policy (backoff/cap, restartRequired, badSession, loggedOut)
 * is layered in a later task; this starts the session and reconnects once
 * on a transient close so first pairing is resilient to a dropped socket.
 */
export async function startWhatsAppSession(
  db: Db,
  reconnectsRemaining = 1,
): Promise<WASocket> {
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

      if (statusCode === DisconnectReason.loggedOut) {
        console.log('session logged out — re-pair required (surfaced fully in Story 1.3/Epic 5)');
        auth.close();
        return;
      }

      // Transient/unspecified close: reconnect once so first pairing survives
      // a dropped socket. The full backoff+cap policy lands in Story 1.3.
      console.log('connection closed, reconnecting once...');
      auth.close();
      if (reconnectsRemaining > 0) {
        void startWhatsAppSession(db, reconnectsRemaining - 1).catch((err) => {
          console.error('WhatsApp reconnection failed:', err);
        });
      }
    }
  });

  return sock;
}
