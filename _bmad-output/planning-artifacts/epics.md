---
stepsCompleted: ["step-01-validate-prerequisites", "step-02-design-epics", "step-03-create-stories", "step-04-final-validation"]
inputDocuments:
  - _bmad-output/specs/spec-whatsapp-downloader/SPEC.md
  - _bmad-output/planning-artifacts/prds/prd-mini-project-2026-07-17/prd.md
  - _bmad-output/planning-artifacts/prds/prd-mini-project-2026-07-17/addendum.md
  - _bmad-output/planning-artifacts/architecture/architecture-mini-project-2026-07-17/ARCHITECTURE-SPINE.md
---

# WhatsApp Downloader - Epic Breakdown

## Overview

This document provides the complete epic and story breakdown for the WhatsApp Downloader, decomposing the requirements from the SPEC (CAP-1..CAP-7), PRD (FR-1..FR-18), and Architecture spine (AD-1..AD-16) into implementable stories. No formal UX design contract exists; dashboard UI stories derive from their FRs.

## Requirements Inventory

### Functional Requirements

FR-1: Sender gate — process a message only if its sender matches an active Contact-whitelist entry. (CAP-1)
FR-2: Link gate — from a whitelisted sender's message text, advance only `http(s)` URLs matching an active link-pattern. (CAP-1)
FR-3: Pre-fetch validation — verify acceptable content-type and enforce a max size as a streaming byte cap during download (HEAD advisory only). (CAP-2)
FR-4: Deduplication — do not re-download content already acquired (pre-download URL key + post-download content hash). (CAP-2)
FR-5: Staged download — a validated file downloads to staging and is absent from the final store until it passes a scan. (CAP-2)
FR-6: Mandatory scan gate — a file leaves staging only after passing a live, signature-current, fail-closed scan; unscannable/encrypted content is treated as failed. (CAP-3)
FR-7: Guarded archive extraction — extract only after passing, under recursive multi-format bomb caps and canonical-path symlink rejection; re-scan extracted contents before any move to final. (CAP-3)
FR-8: Quarantine on failure — a failed file is moved to quarantine, logged, and never advances. (CAP-3)
FR-9: File & status delivery — notify over Telegram; deliver the file when ≤50MB, a status message otherwise; archive results as a filename summary. (CAP-4)
FR-10: Failure never silent — quarantine and pipeline failures always produce a Telegram notification. (CAP-4)
FR-11: Live whitelist evaluation — whitelist edits take effect on the next message with no worker restart. (CAP-1, CAP-5)
FR-12: Whitelist management — operator can add/edit/activate/deactivate contact and link-pattern entries from the dashboard. (CAP-5)
FR-13: Visibility — dashboard shows connection status, the event log, and the quarantine list. (CAP-5)
FR-14: Re-pair surface — on a session-invalidated state, render a scannable QR image in the dashboard and send a Telegram alert. (CAP-5, CAP-6)
FR-15: Resilient reconnection — distinguish transient disconnects (auto-recover with backoff + retry cap) from session-invalidating ones (require re-pair). (CAP-6)
FR-16: URL & redirect safety — re-check every redirect hop against the gates, pin the resolved IP for the connection, and refuse private/reserved ranges (SSRF). (CAP-2)
FR-17: Fail closed on unsafe/incomplete — any step that cannot complete safely leaves the file out of the final store, logged and notified. (CAP-7)
FR-18: Content & filename integrity — classify by real bytes, sanitize stored names, write files non-executable. (CAP-7)
FR-19: Policy settings management — operator edits tunable policy values in the dashboard; worker reads them live; secrets excluded. (CAP-8)

### NonFunctional Requirements

NFR-1: Security / fail-closed default — the safe default at every step is "do not deliver"; "unable to scan" is never "clean." (AD-6)
NFR-2: Data-seam integrity — one WAL-mode SQLite file is the sole integration seam; single-writer-per-domain (worker = items/events, dashboard = whitelists); every write path tolerates and retries `SQLITE_BUSY`. (AD-1, AD-2, AD-3, AD-14)
NFR-3: Reliability / recovery — transient disconnects auto-reconnect with backoff + cap; on startup the worker reconciles in-flight items and dir↔status mismatches fail-closed. (AD-15)
NFR-4: Resource / abuse bounds — downloads run through a bounded concurrency queue with a per-sender rate cap. (AD-13)
NFR-5: Operability / durability — the always-on worker runs under an auto-restarting supervisor; SQLite and the final store are backed up; the event log has a defined retention. (AD-16)
NFR-6: Privacy / locality — runs locally, dashboard not publicly exposed, no auth in v1; VirusTotal is hash-lookup only (no file upload). (Constraints)
NFR-7: Consistency — a shared status enum and Glossary terms are used verbatim; timestamps are ISO-8601 UTC; every pipeline outcome is one structured Event row. (AD-5, conventions)

### Additional Requirements

(From the Architecture spine — technical setup that shapes Epic 1.)

- Greenfield, no named starter template. Epic 1 must scaffold the two-process skeleton: `worker/` (Node/TS, ESM), `dashboard/` (Next.js), `shared/` (schema + migrations + status enum + TS types), `data/` (staging/final/quarantine/extract + Baileys auth store), gitignored `.env`.
- Pinned stack: Node 24 LTS · TypeScript 5.9 · Baileys 6.7.x (npm `baileys`, not the 7.0-rc) · Next.js 16.2.x · better-sqlite3 12.11.x (≥12 for Node 24 prebuilds) · Tailwind v4 + shadcn/ui · qrcode 1.5.4 · clamscan 2.4.0 · file-type 22 (ESM).
- SQLite opened in WAL mode with `busy_timeout` on every connection; worker owns the schema and runs versioned migrations at startup; dashboard never issues DDL. (AD-3, AD-4)
- Shared data contract pinned: `items` (single status holder), `events` (append-only log), `contacts`, `link_patterns`; Baileys auth state in a separate worker-owned store, not the shared DB. (AD-14)
- A single guarded fetcher module enforces SSRF/redirect/pinned-IP/streaming-cap; the link-pattern matcher is one shared module used by both the gate and the redirect re-check. (AD-8, AD-12)
- Baileys auth uses a dedicated store, NOT `useMultiFileAuthState`. (AD-9)
- ClamAV daemon is a required system dependency; secrets live in a gitignored `.env`. (AD-9)

### UX Design Requirements

None — no `bmad-ux` design contract was produced. The dashboard (a local Next.js app: whitelist management, connection status, event log, quarantine list, QR re-pair) is specified functionally by FR-11..FR-14 and governed by AD-1/AD-2/AD-4/AD-14. UI/UX detail is deferred to implementation or a future `bmad-ux` run.

### FR Coverage Map

FR-1: Epic 2 — sender gate
FR-2: Epic 2 — link-pattern gate (URL in text)
FR-3: Epic 3 — pre-fetch validation + streaming size cap
FR-4: Epic 3 — deduplication
FR-5: Epic 3 — staged download
FR-6: Epic 3 — mandatory fail-closed scan
FR-7: Epic 3 — guarded archive extraction + re-scan
FR-8: Epic 3 — quarantine on failure
FR-9: Epic 4 — file & status delivery
FR-10: Epic 4 — failure never silent
FR-11: Epic 2 (live worker read) + Epic 5 (whitelist management UI)
FR-12: Epic 5 — whitelist management
FR-13: Epic 5 — visibility (status, event log, quarantine)
FR-14: Epic 5 — re-pair QR surface (initial pairing enabled in Epic 1)
FR-15: Epic 1 — resilient reconnection
FR-16: Epic 3 — URL & redirect safety (SSRF)
FR-17: Epic 3 — fail-closed on unsafe/incomplete
FR-18: Epic 3 — content & filename integrity
FR-19: Epic 5 — policy settings management (dashboard-editable, worker live-read)

## Epic List

### Epic 1: Foundation, Connection & Resilience
Stand up the two-process skeleton and shared data contract, pair the dedicated secondary WhatsApp number, and keep that session reliably alive — auto-recovering transient drops and reconciling any in-flight work fail-closed on restart. After this epic the system is a correctly-scaffolded, always-on worker paired to WhatsApp, with the dashboard shell reading the same store.
**FRs covered:** FR-15 (initial pairing toward FR-14) · **NFRs:** NFR-2, NFR-3, NFR-5, NFR-7 · **Additional:** two-process scaffold, pinned stack, WAL SQLite + migrations, shared schema (AD-14), Baileys auth store (AD-9).

### Epic 2: Gated Intake
Ensure only messages from a whitelisted contact carrying a whitelisted-pattern `http(s)` URL in message text advance into the pipeline — evaluated live so operator whitelist changes apply on the next message with no restart — and everything else is silently ignored.
**FRs covered:** FR-1, FR-2, FR-11 (worker live-read side) · Governed by AD-2, AD-5, AD-12.

### Epic 3: Safe Acquisition, Scanning & Quarantine
Turn an accepted link into a trustworthy (or quarantined) file: fetched through the single guarded fetcher (SSRF/redirect/streaming-cap/dedup) into staging, passed through a mandatory live fail-closed scan, archives extracted-after-pass under bomb/zip-slip guards with contents re-scanned, clean results filed and failures quarantined — defaulting to "do not deliver" on any unsafe or incomplete condition, never trusting attacker-supplied type or name.
**FRs covered:** FR-3, FR-4, FR-5, FR-6, FR-7, FR-8, FR-16, FR-17, FR-18 · **NFRs:** NFR-1, NFR-4 · Governed by AD-6, AD-7, AD-8, AD-10, AD-13.

### Epic 4: Delivery & Notification
Keep the operator informed over Telegram without watching a screen — delivering files ≤50MB directly, status messages for larger/archive/failed outcomes, and never failing silently on a quarantine.
**FRs covered:** FR-9, FR-10 · Governed by AD-11.

### Epic 5: Control Dashboard & Visibility
Give the operator one local surface to manage both whitelists and observe the system — connection status, the full event log, the quarantine list, and a scannable QR re-pair prompt (plus Telegram alert) when the session drops.
**FRs covered:** FR-12, FR-13, FR-14, FR-19, FR-11 (management UI side) · **NFRs:** NFR-6 · Governed by AD-1, AD-2, AD-4, AD-14, AD-17.

---

## Epic 1: Foundation, Connection & Resilience

Stand up the two-process skeleton and shared data contract, pair the dedicated secondary WhatsApp number, and keep that session reliably alive. After this epic the system is a correctly-scaffolded, always-on worker paired to WhatsApp.

### Story 1.1: Project scaffold & shared data contract

As the builder,
I want the two-process skeleton and the pinned shared data contract in place,
So that the worker and dashboard integrate through one well-defined SQLite seam from day one.

**Acceptance Criteria:**

**Given** a fresh repo
**When** the scaffold is created
**Then** `worker/` (Node/TS ESM), `dashboard/` (Next.js 16.2), `shared/`, and gitignored `data/` (staging/final/quarantine/extract) and `.env` exist with the pinned stack (Node 24, Baileys 6.7.x, better-sqlite3 12.11.x). (Additional Reqs)
**And** `shared/` defines the status enum and TS types, and versioned migrations create `items`, `events`, `contacts`, `link_patterns`, and `settings` (seeded with the policy defaults) per AD-14/AD-17.
**And** the SQLite file opens in WAL mode with `busy_timeout` on every connection, and the worker runs migrations at startup while the dashboard issues no DDL. (AD-3, AD-4)

### Story 1.2: WhatsApp session & QR pairing

As the operator,
I want to pair the dedicated secondary number by scanning a QR,
So that the worker holds a live WhatsApp session.

**Acceptance Criteria:**

**Given** no existing session
**When** the worker starts
**Then** it renders a scannable QR image (via `qrcode`, not a terminal print) and, once scanned, establishes a connected session. (toward FR-14)
**And** auth state persists in a dedicated worker-owned store — **not** `useMultiFileAuthState` — outside the shared DB. (AD-9)
**And** secrets (none in DB) load from the gitignored `.env`.

### Story 1.3: Resilient reconnection

As the operator,
I want the session to recover from transient drops on its own,
So that I only intervene when a real re-pair is required.

**Acceptance Criteria:**

**Given** a live session
**When** a transient disconnect occurs (connectionLost/timedOut/etc.)
**Then** the worker auto-reconnects with backoff and a retry cap — never an immediate tight loop. (FR-15)
**And** `restartRequired` reconnects once; `badSession` clears auth and restarts pairing.
**And** a `loggedOut` state stops auto-reconnect and flags that a re-pair is needed (surfaced in Epic 5). (FR-15 → FR-14)

### Story 1.4: Fail-closed startup reconciliation

As the builder,
I want the worker to reconcile in-flight work safely on every start,
So that a crash never leaves an item trusted or a file mislocated.

**Acceptance Criteria:**

**Given** items left non-terminal or a file whose directory ≠ its DB status after a crash
**When** the worker starts
**Then** each is resolved **fail-closed** — re-queued from a safe earlier stage or moved to `quarantine`, never advanced. (AD-15, NFR-3)
**And** the bounded work queue is rebuilt from `items` status, not held only in memory.

### Story 1.5: Always-on supervision & durability

As the operator,
I want the worker kept alive and the data recoverable,
So that the pipeline survives crashes and I can restore after loss.

**Acceptance Criteria:**

**Given** the deployed worker
**When** it exits unexpectedly
**Then** a process supervisor auto-restarts it (safe resume via Story 1.4). (AD-16, NFR-5)
**And** the SQLite file and the `final/` store are backed up **daily**, and the `events` log retention is **90 days** (both editable via Settings, Story 5.4). (AD-17)

## Epic 2: Gated Intake

Ensure only messages from a whitelisted contact carrying a whitelisted-pattern `http(s)` URL in message text advance, evaluated live, and everything else is silently ignored.

### Story 2.1: Sender gate

As the operator,
I want only whitelisted contacts to be processed,
So that strangers' messages never touch the pipeline.

**Acceptance Criteria:**

**Given** an incoming message
**When** its sender is not an active `contacts` entry
**Then** it produces no download and no notification and never advances. (FR-1)
**And** a message from an active whitelisted sender proceeds to link evaluation.
**And** an inactive (disabled) contact entry is treated as not whitelisted.

### Story 2.2: Link extraction & pattern gate

As the operator,
I want only whitelisted link shapes to advance,
So that arbitrary URLs are never fetched.

**Acceptance Criteria:**

**Given** a whitelisted sender's message text
**When** `http(s)` URLs are extracted
**Then** only URLs matching an active `link_patterns` entry advance; each matching URL advances independently. (FR-2)
**And** matching uses one shared matcher module — exact-domain (optional path prefix) and/or extension allowlist, no regex, no wildcard TLD. (AD-12)
**And** a message with no URL or no pattern match does not advance and is not fetched.

### Story 2.3: Live whitelist evaluation

As the operator,
I want my whitelist edits to take effect immediately,
So that I never restart the worker to change who or what is allowed.

**Acceptance Criteria:**

**Given** the worker is running
**When** I add/activate or deactivate a contact or pattern (Epic 5)
**Then** the change is honored on the very next message with no restart. (FR-11)
**And** the worker reads both whitelist tables fresh per message and never caches them across messages. (AD-2)

## Epic 3: Safe Acquisition, Scanning & Quarantine

Turn an accepted link into a trustworthy (or quarantined) file, defaulting to "do not deliver" on any unsafe or incomplete condition.

### Story 3.1: Pre-download deduplication

As the operator,
I want an already-processed link skipped before any fetch,
So that re-sends don't re-download.

**Acceptance Criteria:**

**Given** a matched URL
**When** its normalized-URL hash matches an already-processed item
**Then** it short-circuits to `duplicate` without fetching. (FR-4 pre-key, AD-10)

### Story 3.2: Guarded fetch — SSRF, redirect & IP pinning

As the builder,
I want every fetch routed through one guarded component,
So that attacker-influenced URLs can't reach internal hosts or bypass the gate.

**Acceptance Criteria:**

**Given** a URL to fetch
**When** the fetcher connects
**Then** it resolves and pins the target IP and refuses private/loopback/link-local/metadata ranges — via the submitted URL or any redirect. (FR-16, AD-8)
**And** every 3xx redirect hop is re-checked against the link-pattern (shared matcher); a hop to a non-matching host is rejected at the redirect.
**And** redirect chains exceeding a max hop count abort.

### Story 3.3: Streaming validation & staged download

As the builder,
I want size enforced during download and files staged first,
So that a lying HEAD or oversized body can't slip through or reach the final store.

**Acceptance Criteria:**

**Given** a validated target
**When** the body is fetched
**Then** an unacceptable content-type is rejected before the body, and size is enforced as a streaming byte cap that aborts mid-transfer and discards the partial. (FR-3)
**And** a valid file lands only in `staging/`, never in `final/` before a passing scan. (FR-5)

### Story 3.4: Post-download content deduplication

As the operator,
I want identical bytes from different URLs recognized,
So that the same file isn't stored twice.

**Acceptance Criteria:**

**Given** a downloaded file
**When** its content SHA-256 matches an already-processed item
**Then** it short-circuits to `duplicate`; otherwise the hash is recorded on the `items` row. (FR-4 post-key, AD-10)

### Story 3.5: Mandatory fail-closed scan

As the operator,
I want every file scanned by a live, current engine before it's trusted,
So that "unable to scan" is never treated as "clean."

**Acceptance Criteria:**

**Given** a staged file
**When** it is scanned
**Then** ClamAV must be live and signature-current; an optional VirusTotal hash lookup may run as a second signal. (FR-6)
**And** a scanner that is down/unresponsive/stale, or content that cannot be inspected (encrypted/corrupt), results in `quarantined` — fail-closed. (AD-6, NFR-1)
**And** a file that fails is never moved to `final/` and never extracted.

### Story 3.6: Guarded archive extraction & re-scan

As the builder,
I want archives expanded only after passing and under strict guards,
So that a bomb or path-traversal archive can't detonate or escape.

**Acceptance Criteria:**

**Given** a scanned-clean archive
**When** it is extracted to an isolated location
**Then** total uncompressed size, cumulative file count, and nesting depth are capped recursively across formats; exceeding any cap aborts and quarantines. (FR-7)
**And** symlink/hardlink entries and any entry resolving outside the target (canonical-path check) are rejected; nothing overwrites existing files.
**And** extracted contents are re-scanned before any move, and the move→status write follows the fixed order (rename first, then commit status). (AD-7)

### Story 3.7: Filing, quarantine & file integrity

As the operator,
I want clean files filed safely and everything else quarantined,
So that the final store only ever holds trusted, correctly-typed files.

**Acceptance Criteria:**

**Given** a scan outcome
**When** the file is placed
**Then** a clean file moves to `final/` by atomic rename with its directory matching its status; a failure goes to `quarantine/` with a log entry. (FR-8, FR-17)
**And** the file is classified by real bytes — a declared-type/real-bytes mismatch is rejected or quarantined; stored names are sanitized; files are written non-executable and outside any auto-run path. (FR-18)

### Story 3.8: Bounded concurrency & per-sender rate cap

As the operator,
I want downloads bounded,
So that a flood of links can't exhaust disk or CPU.

**Acceptance Criteria:**

**Given** multiple incoming matched links
**When** they are processed
**Then** downloads run through a bounded queue of **2 concurrent** with a **per-sender rate of 10/min**; overflow queues rather than runs. (AD-13, NFR-4)
**And** both values are read live from Settings (Story 5.4), so tuning them needs no restart. (AD-17)

## Epic 4: Delivery & Notification

Keep the operator informed over Telegram of every outcome, never failing silently.

### Story 4.1: Telegram delivery of results

As the operator,
I want files or a clear status delivered to Telegram,
So that I get results without watching a screen.

**Acceptance Criteria:**

**Given** a stored file
**When** it is delivered
**Then** a file ≤50MB is sent via `sendDocument`; a file >50MB sends the text "file ready, too large to send directly, check the dashboard" (no failed send attempt). (FR-9)
**And** a successful archive extraction is announced as a summary list of filenames, not one message per file.

### Story 4.2: Failure & quarantine notifications

As the operator,
I want to be told when something is quarantined or fails,
So that nothing fails silently.

**Acceptance Criteria:**

**Given** a quarantine or pipeline failure
**When** it occurs
**Then** a Telegram quarantine/failure notification is sent. (FR-10)
**And** delivery fires only at a terminal transition; a Telegram send failure is recorded as an Event and surfaced, but never blocks or reverses a state transition. (AD-11)

## Epic 5: Control Dashboard & Visibility

Give the operator one local surface to manage both whitelists and observe the system.

### Story 5.1: Whitelist management UI

As the operator,
I want to manage contacts and link-patterns from the dashboard,
So that I control who and what is allowed without touching the DB.

**Acceptance Criteria:**

**Given** the dashboard
**When** I add/edit/activate/deactivate a contact or link-pattern
**Then** every whitelist field (sender + label + active; pattern + type + active) is editable and the change persists to SQLite. (FR-12)
**And** the dashboard writes only the `contacts` and `link_patterns` tables — never pipeline state. (AD-2)

### Story 5.2: Event log & quarantine views

As the operator,
I want to see everything the pipeline has done,
So that I can audit outcomes and review quarantined files.

**Acceptance Criteria:**

**Given** pipeline activity
**When** I open the dashboard
**Then** every Event is viewable with status, source contact, link, filename, scan result, and timestamp. (FR-13)
**And** quarantined files are listed distinctly from delivered/stored files.
**And** the dashboard only reads this state (local, not publicly exposed). (AD-1, NFR-6)

### Story 5.3: Connection status & QR re-pair surface

As the operator,
I want to see connection health and re-pair when needed,
So that I can restore the session quickly.

**Acceptance Criteria:**

**Given** the worker's connection state (from the shared store)
**When** I view the dashboard
**Then** current connection status is shown. (FR-13/FR-14)
**And** on a `loggedOut`/session-invalid state, a scannable QR image is rendered in the dashboard and a Telegram alert is sent; the system does not silently loop reconnecting. (FR-14)

### Story 5.4: Policy settings

As the operator,
I want to tune the pipeline's safety limits from the dashboard,
So that I can adjust behavior without editing code or restarting the worker.

**Acceptance Criteria:**

**Given** the Settings page
**When** I edit a policy value — size/archive caps, redirect hops, scanner-signature freshness, max-concurrent, per-sender rate, VirusTotal flag policy (hard-fail/warn), VirusTotal outage policy (hold/degrade), backup cadence, or event retention
**Then** it persists to the `settings` table (seeded with the pilot defaults) and the worker honors it on its next relevant operation with no restart. (FR-19, AD-17)
**And** secrets (Telegram token, VirusTotal API key) are neither shown nor editable here — they stay in `.env`. (AD-9)
**And** the dashboard writes only the `settings`, `contacts`, and `link_patterns` tables — never pipeline state. (AD-2)
