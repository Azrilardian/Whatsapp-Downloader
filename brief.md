---
title: WhatsApp Downloader — Project Brief (Pilot / Blueprint)
status: draft
created: 2026-07-17
updated: 2026-07-17
---

# WhatsApp Downloader — Project Brief (Pilot / Blueprint)

## 1. Objective

- **Product**: Automatically detect downloadable file links sent by specific WhatsApp contacts, then safely fetch, scan, and store the files — with delivery/notification via Telegram and a dashboard for control and visibility.
- **Primary goal**: Ship a working downloader (see §3). The build itself is the deliverable.
- **Secondary benefit (not a measured deliverable)**: This is also a first run of the trimmed AI-dev workflow (BMAD → task-master → Agent SDK) ahead of the larger AI-tools dashboard. We'll note in passing which tools felt necessary vs. overkill, but success is *not* gated on formally proving that — there is no timebox forcing that calibration, so treat it as an observation, not an outcome.

## 2. Problem & Context

> `[ASSUMPTION]` — no problem statement was in the original brief; this is inferred and should be corrected if wrong.

Trusted contacts share download links (builds, assets, documents) in WhatsApp. Today those get handled manually — tap each link, download, worry about whether the file is safe, move it somewhere permanent. It's tedious and the safety check is usually skipped. This automates the trusted-source path: only whitelisted senders, only whitelisted link shapes, always scanned before it's treated as real.

The stakes are low (internal pilot, single operator), which is why v1 stays deliberately small and local.

## 3. Success Criteria

The pilot is successful when, end-to-end on real messages:

1. A whitelisted contact sends a whitelisted link → the file lands in the final folder **only after** passing the ClamAV scan.
2. A non-whitelisted sender or non-whitelisted link is **silently ignored** (no download, no noise).
3. A malicious/failed-scan file is **quarantined, logged, and notified** — never moved or extracted.
4. Every event is recorded in SQLite and visible in the dashboard (status, contact, link, filename, scan result, timestamp).
5. Telegram delivers the file (≤50MB) or the correct "ready, too large" / quarantine message.
6. Contact and link-pattern edits made in the dashboard take effect **without restarting the worker**.
7. Connection drops recover per the §8 strategy; a `loggedOut` state surfaces a fresh QR in the dashboard and a Telegram alert.

## 4. Scope

**In scope (v1):**

- **Trigger**: Unofficial library Baileys (Node/TypeScript), paired via QR code. Use a secondary/dedicated WhatsApp number — not the primary — due to ban risk outside our control.
- **Chat scope**: Whitelist of specific contacts only (JID list), not all incoming chats. **Dynamic** — managed via the dashboard (SQLite `contacts` table: JID, label, active status).
- **Link scope**: Whitelist of specific link patterns (domain/file extension), not arbitrary URLs. **Dynamic** — managed via the dashboard (SQLite `link_patterns` table: pattern, type, active status).
- The worker queries both tables live on every incoming message (not cached at startup), so dashboard changes take effect immediately without restarting the worker.

**Non-goals (explicitly out of v1):**

- **URLs in message text only.** Native WhatsApp attachments (documents/media sent as files) and URLs embedded in image/document/video **captions** are out of scope — `extractUrl()` reads message text only, and that boundary is deliberate for v1.
- No multi-user / multi-operator support — single operator, single secondary number.
- No cloud hosting or remote access — runs locally; the dashboard is not exposed publicly.
- No files >50MB delivered over Telegram (dashboard is the fallback; no self-hosted Local Bot API Server in v1).

## 5. Requirements / Pipeline

1. Connect via Baileys, session stored locally (`.gitignore`d, never committed to git).
2. Listen for incoming messages — only proceed if the sender is in the contact whitelist.
3. Extract URL from the message **text** (captions/attachments out of scope — see §4).
4. Filter: does the URL match a whitelisted pattern (domain/extension)? If not, ignore (no further processing).
5. **Dedup**: if this URL was already downloaded successfully (check the event log / a content hash), skip re-downloading and note it — don't fetch the same file twice.
6. Validate: HEAD request to confirm a genuinely downloadable content-type + check file size against the max limit before fetching.
7. Download to a staging folder (not final yet).
8. Security scan: local ClamAV (mandatory). Optional second layer: hash lookup against VirusTotal API (not a full file upload).
9. If scan passes: move to the local final folder (source of truth); if `.zip`, extract **after** passing the scan, not before — with extraction guards (see §6).
10. If scan fails: quarantine + log, do not extract/move.
11. Record every event (status, source contact, link, filename, scan result, timestamp) to SQLite.
12. **Notification + delivery via Telegram Bot** (mandatory):
    - File ≤ 50MB: send directly via `sendDocument`.
    - File > 50MB: don't attempt to send — send a text message: "file ready, too large to send directly, check the dashboard."
    - Extracted `.zip` results (multiple files): send a summary list of filenames, don't send each extracted file individually.
    - Scan failure: send a quarantine notification too — don't fail silently.

## 6. Security Notes

- **ClamAV is mandatory; VirusTotal is hash-lookup only** (no full-file upload — avoids leaking contents and staying within free-tier limits).
- **Extraction is the dangerous step.** A zip bomb passes an AV scan and detonates on extract, so `.zip` handling must cap **total uncompressed size**, cap **file count**, and reject **path traversal / zip-slip** (entries resolving outside the target folder). Extract to an isolated folder, never over existing files.
- **Staging → scan → final** ordering means nothing untrusted ever touches the source-of-truth folder before it's cleared.

## 7. Tech Stack

- **Listener**: Node.js + Baileys — a separate, always-on worker process, NOT a Next.js API route.
- **UI/Dashboard**: Next.js + Tailwind + shadcn — reads the same SQLite database; shows connection status, download log, quarantine list.
- **Data**: SQLite, shared between worker and UI.
- **Security**: ClamAV (local) + optional VirusTotal hash lookup.
- **Notification/delivery**: Telegram Bot API (BotFather token). Called directly from the worker as an HTTP POST — no persistent connection like Baileys. Standard limit 50MB per file (`sendDocument`); above that needs a self-hosted Local Bot API Server (Docker) — not adopted in v1 unless the need is clear.
- **Secrets**: Telegram token and VirusTotal API key live in a gitignored `.env` (never committed), alongside the Baileys session.

## 8. Architecture Note

The Baileys worker and the Next.js UI are two separate processes:

- Worker: holds the WhatsApp session, runs pipeline steps 1–12.
- Next.js: serves the dashboard, only reads SQLite, does not hold the WhatsApp session.

Communication happens only through the shared SQLite file — no direct API calls between them for v1.

## 9. Reconnect & Re-pairing Strategy

Baileys exposes `DisconnectReason` in the `connection.update` event; each code needs different handling:

- `loggedOut` (401): STOP, do not auto-reconnect. Trigger a new QR code, rendered as an image in the dashboard (via the `qrcode` library, not a terminal print). Also send a Telegram alert.
- `badSession` (500): clear the local auth state, restart pairing from scratch.
- `restartRequired` (515): normal — happens right after the first QR scan. Reconnect once; not an error.
- Others (connectionClosed/connectionLost/timedOut/connectionReplaced/multideviceMismatch/forbidden/unavailableService): auto-reconnect with backoff + a retry cap (don't retry instantly — it can look like an automated abuse pattern and raise ban risk).
- **Auth state**: DO NOT use `useMultiFileAuthState` in production (Baileys' own docs say it's IO-heavy and meant only as a reference implementation). Use a proper auth-state store (backed by SQLite / an encrypted file).
- **Risk that can't be handled in code**: if the secondary number gets **banned** (not just logged out), Baileys can't always cleanly distinguish that from a normal logout — a permanent state, not something you can "re-pair" out of.

## 10. Open Items (not blocking BMAD hand-off, but decide before build)

- Concrete lists: which contacts, which domains/extensions to whitelist — entered via the dashboard once running, not hardcoded, so not a blocker.
- Which secondary WhatsApp number will be used for Baileys.
- Telegram Bot setup: create the bot via BotFather, get the token, capture your personal `chat_id` (send one message to the bot, have the dashboard capture it from the update).
- Confirm/replace the `[ASSUMPTION]` problem statement in §2 with the real use case.
