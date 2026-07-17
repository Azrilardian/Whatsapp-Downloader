---
title: WhatsApp Downloader — PRD Addendum (Mechanism & Technical Context)
status: final
created: 2026-07-17
updated: 2026-07-17
---

# WhatsApp Downloader — PRD Addendum

*This addendum holds the implementation-level decisions extracted from the approved brief. The PRD (`prd.md`) states capabilities as FRs; this document preserves the "how" for the architecture step. Nothing here overrides an FR — it informs the design that satisfies it.*

## A. Technology Stack

- **WhatsApp listener** — Node.js + **Baileys** (unofficial library, TS), paired via QR. Runs as a separate, always-on **worker** process — NOT a Next.js API route. Uses a **dedicated secondary number**, never the primary, due to ban risk outside our control.
- **Dashboard/UI** — Next.js + Tailwind + shadcn. Reads the same SQLite DB. Serves control (whitelists) and visibility (status, log, quarantine, QR).
- **Data** — SQLite, shared between worker and UI. Tables: `contacts` (JID, label, active), `link_patterns` (pattern, type, active), plus an events table for the Event log.
- **Scanning** — **ClamAV** local (mandatory). Optional second layer: **VirusTotal** API **hash lookup only** (not a full-file upload — avoids leaking contents and stays within free-tier limits).
- **Delivery** — **Telegram Bot API** (BotFather token), called directly from the worker as an HTTP POST — no persistent connection like Baileys. `sendDocument` standard limit 50MB; above that requires a self-hosted Local Bot API Server (Docker) — not adopted in v1 unless the need is clear.
- **Secrets** — Telegram token and VirusTotal API key in a gitignored `.env`; Baileys session stored locally, gitignored, never committed.

## B. Two-Process Architecture

The Baileys **worker** and the Next.js **UI** are separate processes communicating only through the shared SQLite file — no direct API calls between them in v1.

- **Worker**: holds the WhatsApp session; runs the full pipeline (ingest → gate → validate → dedup → stage → scan → extract → file/quarantine → log → deliver).
- **Next.js**: serves the dashboard; only reads SQLite; does not hold the WhatsApp session.

Because both whitelists are queried **live on every incoming message** (not cached at startup), dashboard edits take effect without restarting the worker (supports FR-11).

## C. Pipeline Mechanism (maps to §4 FRs)

1. Connect via Baileys; session stored locally (gitignored). → FR-14/FR-15 context
2. Listen; proceed only if sender ∈ active `contacts`. → FR-1
3. Extract URL(s) from message **text**. → FR-2
4. Match URL against active `link_patterns` (domain/extension); else ignore. → FR-2
5. Dedup check (URL and/or content hash) — skip if already acquired. → FR-4
6. HEAD request: confirm downloadable content-type + size ≤ max. → FR-3
7. Download to **staging** folder. → FR-5
8. Scan: ClamAV mandatory; optional VT hash lookup. → FR-6
9. Pass → if archive, extract to an **isolated** location under guards, then **re-scan** the extracted contents; move only scanned-clean results to the **final** folder (source of truth). Non-archives move straight to final on pass. → FR-6, FR-7
10. Fail → **quarantine** + log, no extract/move. → FR-8
11. Record every Event to SQLite. → FR-13
12. Telegram notify/deliver per size + outcome rules. → FR-9, FR-10

## D. Archive Extraction Guards (FR-7 detail)

Extraction is the dangerous step — an archive bomb passes an AV scan and detonates on extract. Required guards:

- Cap **total uncompressed size**, **cumulative file count**, and **nesting depth** — applied **recursively** and across formats (zip, gzip, tar, bzip2, xz, 7z, nested combinations), not just a single zip layer.
- Reject **symlink/hardlink entries** and any entry resolving outside the target dir, via a **canonical-path (realpath) check** — a substring `..` check is insufficient.
- Extract to an **isolated** folder; never overwrite existing files.

Concrete cap values are Open Question #3 in the PRD.

## D2. Network Safety (FR-16 detail)

The fetcher is the SSRF surface — the URL is attacker-influenced. Required:

- Re-apply **both gates** (sender already cleared; link-pattern) to **every redirect hop**, not just the submitted URL. A whitelisted domain that 302s elsewhere must be re-checked or refused.
- Block connections resolving to private/loopback/link-local/metadata ranges (`127.0.0.0/8`, `10/8`, `172.16/12`, `192.168/16`, `169.254/16`, `::1`, etc.) — enforce at connect time against the *resolved IP*, so DNS-rebinding can't slip through a name check.
- Bound redirect hops (Open Question #5).
- Enforce the size limit as a **streaming cap during the GET** (FR-3) — never trust HEAD/`Content-Length`; abort mid-stream when exceeded and discard the partial file.

## D3. Fail-Closed Rules (FR-6, FR-17 detail)

The safe default at every step is "do not deliver":

- ClamAV must be **live and signature-current**; if the daemon is down/unresponsive or signatures exceed the freshness threshold, treat as scan-failed → quarantine. Never map "couldn't scan" to "clean."
- Incomplete download / disk-full / size-cap-hit → discard partial, record failure, do not advance.
- VirusTotal unreachable/rate-limited → hold or degrade to local-scan-only per configured policy (Open Question #7).
- Event-write and Telegram-send failures are logged and surfaced, never silently dropped. Handle worker↔UI SQLite contention (WAL mode / busy-timeout) so an Event write is not lost.
- Classify by real bytes (magic/type sniffing), sanitize filenames, write files non-executable and outside any auto-run path (FR-18).

## E. Connection Recovery (FR-14 / FR-15 detail)

Baileys exposes `DisconnectReason` in the `connection.update` event; handling per code:

- **`loggedOut` (401)** — STOP; do not auto-reconnect. Render a fresh QR image in the dashboard (via the `qrcode` library, not a terminal print) + Telegram alert. → FR-14
- **`badSession` (500)** — clear local auth state; restart pairing from scratch.
- **`restartRequired` (515)** — normal, right after first QR scan; reconnect once; not an error.
- **Others** (connectionClosed / connectionLost / timedOut / connectionReplaced / multideviceMismatch / forbidden / unavailableService) — auto-reconnect with **backoff + retry cap**. Never tight-retry — it looks like an automated abuse pattern and raises ban risk. → FR-15
- **Auth state** — DO NOT use `useMultiFileAuthState` in production (Baileys' own docs: IO-heavy, reference-only). Use a proper auth-state store (SQLite / encrypted file).

## F. Operational Risk (not code-solvable)

If the secondary number is **banned** (not just logged out), Baileys can't always distinguish that from a normal logout. A ban is permanent — no "re-pair" recovers it. This is an operational procedure question (PRD Open Question #6), not an FR.

## G. Pre-Build Operational Setup (from brief §10)

- Choose the secondary WhatsApp number for Baileys.
- Telegram: create bot via BotFather, capture token, capture the Operator's personal `chat_id` (send one message to the bot; have the dashboard read it from the update).
- Seed initial whitelists via the dashboard once running (not hardcoded).
