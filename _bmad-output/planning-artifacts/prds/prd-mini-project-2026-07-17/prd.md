---
title: WhatsApp Downloader
status: final
created: 2026-07-17
updated: 2026-07-17
---

# PRD: WhatsApp Downloader
*Working title — confirm.*

## 0. Document Purpose

This PRD is for the builder (single operator) and any downstream BMAD workflow (architecture, epics/stories) that consumes it. It builds on the approved product brief (`brief.md`) and states the product as capabilities and testable Functional Requirements — **not** implementation. Mechanism and technology decisions (Baileys, Next.js, SQLite, ClamAV/VirusTotal, connection-recovery handling, secrets, two-process architecture) live in `addendum.md` and feed the architecture step; they are referenced here, not duplicated. Vocabulary is Glossary-anchored (§3); features are grouped with FRs nested and globally numbered; inferred content is tagged `[ASSUMPTION]` inline and indexed in §9.

## 1. Vision

Trusted contacts routinely share download links in WhatsApp — builds, assets, documents. Handling them by hand is tedious and the safety check is almost always skipped: tap the link, download, hope it's clean, move it somewhere it won't get lost. The WhatsApp Downloader automates that trusted-source path end to end. When a whitelisted contact sends a whitelisted link, the system fetches the file, scans it for malware **before** it's ever treated as real, files clean results in a canonical location, quarantines anything that fails, and notifies the operator via Telegram — with a dashboard for control and visibility.

It is deliberately small: single operator, local, whitelist-gated on **both** who may send and what may be fetched. The point is a dependable, safe, unattended pipeline for a narrow trusted flow — not a general-purpose downloader.

This build is also the pilot run of the trimmed AI-dev workflow ahead of a larger AI-tools dashboard, but the product's own success is measured only by the working pipeline (§7).

## 2. Target User

### 2.1 Jobs To Be Done

- **Functional:** "When a trusted contact sends me a file link, capture and safely store the file without me babysitting it."
- **Functional:** "Never let an unscanned or malicious file into my real folder."
- **Contextual:** "Tell me when something lands — or when something's wrong — without me watching a terminal."
- **Functional:** "Let me change who and what is allowed without redeploying or restarting anything."
- **Builder's framing:** "This is also me validating the AI-dev workflow before I scale it."

### 2.2 Non-Users (v1)

- Multiple operators / teams — v1 is single-operator, single WhatsApp number.
- Anyone needing remote or public access — runs locally, dashboard is not exposed.
- Contacts sending native WhatsApp attachments (documents/media as files) or links inside media **captions** — out of scope (§5).

### 2.3 Key User Journeys

*Single operator role → journeys are downscaled to lightweight narratives.*

- **UJ-1. Rizal receives a build link while away from his desk.** Rizal has whitelisted a teammate and the `*.zip` pattern from their build host. The teammate pastes a link in WhatsApp. Unattended, the system confirms the sender and pattern, validates and downloads the file, scans it clean, and files it. Rizal's phone buzzes with a Telegram message and the file attached (it's under 50MB) — he never opened the app. *Realizes FR-1, FR-3, FR-5, FR-7, FR-9.*

- **UJ-2. Rizal onboards a new contact and a new source, live.** A new supplier will start sending links. Rizal opens the dashboard, adds the supplier's contact and a new domain pattern, both marked active. The next message from that supplier is picked up immediately — no restart. *Realizes FR-2, FR-11.*

- **UJ-3. A link turns out to be malicious.** A whitelisted contact unknowingly forwards a bad file. The system downloads it to staging, the scan fails, and it's quarantined and logged — never moved to the final folder, never extracted. Rizal gets a Telegram quarantine alert and sees it in the dashboard's quarantine list. *Realizes FR-6, FR-8, FR-10.*

## 3. Glossary

- **Operator** — the single human who owns and runs the system; the only user.
- **Contact whitelist** — the set of allowed senders. Only messages from an active entry are processed. Managed live by the Operator.
- **Link-pattern whitelist** — the set of allowed link shapes (by domain and/or file extension). Only URLs matching an active pattern are fetched. Managed live by the Operator.
- **Link** — an `http(s)` URL appearing in a message's **text**. Excludes attachments and caption URLs (§5).
- **Staging** — the transient location a file occupies after download and before it has passed a scan. Never a source of truth.
- **Scan** — the malware check a file must pass to leave staging. Mandatory local engine, optional reputation lookup.
- **Final store** — the canonical location for files that passed a scan. The only trusted output location.
- **Quarantine** — the isolated location for files that failed a scan; never moved to the Final store, never extracted.
- **Event** — one recorded occurrence in the pipeline (received, ignored, downloaded, scanned, delivered, quarantined) with its metadata, persisted and visible in the Dashboard.
- **Delivery** — sending a file or a status message to the Operator over Telegram.
- **Dashboard** — the local UI for control (whitelists) and visibility (status, log, quarantine).
- **Re-pair** — restoring the WhatsApp session when the connection is lost in a way that requires a fresh QR scan.

## 4. Features

### 4.1 Message Ingestion & Gatekeeping

**Description:** The system maintains a WhatsApp session on a dedicated secondary number and processes incoming messages, but only advances a message that clears two independent gates — an allowed sender and an allowed link shape. Everything else is silently ignored (no download, no notification, no noise). Both gates are evaluated against live state so the Operator's dashboard edits apply without a restart. Realizes UJ-1, UJ-2.

**Functional Requirements:**

#### FR-1: Sender gate
The system processes an incoming message only if its sender matches an active entry in the Contact whitelist. Realizes UJ-1.

**Consequences (testable):**
- A message from a sender not on the whitelist produces no download and no notification and never advances. (Whether ignored senders are logged at all is a design choice — minimal logging is preferred to avoid noise from strangers.)
- A message from an inactive (disabled) contact entry is treated as not whitelisted.

#### FR-2: Link gate
From a whitelisted sender's message **text**, the system extracts `http(s)` URLs and advances only those matching an active Link-pattern (by domain and/or extension). Realizes UJ-2.

**Consequences (testable):**
- A whitelisted sender's message with no URL, or a URL matching no active pattern, does not advance and is not fetched.
- A message containing multiple URLs advances each matching URL independently.

**Out of Scope:**
- URLs in attachments or media captions; native WhatsApp file attachments (see §5).

#### FR-11: Live whitelist evaluation
Changes the Operator makes to either whitelist take effect on the next incoming message without restarting the ingestion process. Realizes UJ-2.

**Consequences (testable):**
- A contact/pattern added and marked active is honored on the next message; one marked inactive is rejected on the next message — in both cases with no restart.

### 4.2 Safe Acquisition

**Description:** Before committing to a download, the system confirms the target is genuinely downloadable and within size limits, avoids re-fetching content it already has, and stores the result only in Staging — never directly in the Final store. Realizes UJ-1.

**Functional Requirements:**

#### FR-3: Pre-fetch validation
Before and during downloading, the system verifies the target resolves to acceptable content within a maximum size limit, treating any advertised metadata as advisory only.

**Consequences (testable):**
- A URL whose advertised content-type is not downloadable content is rejected before the body is fetched, and recorded as a rejected Event.
- The maximum size is enforced by a **streaming byte cap during download** (HEAD / `Content-Length` is advisory only); a response that exceeds the cap mid-transfer is aborted and the partial file discarded — the system never trusts an advertised size (defends the HEAD/GET TOCTOU).

#### FR-16: URL & redirect safety
The system fetches only safe network targets: it re-checks every redirect hop against both gates and a network-safety policy, and never contacts private, loopback, or link-local addresses. Realizes UJ-1.

**Consequences (testable):**
- A whitelisted URL that redirects (any 3xx) to a host or IP not matching an active Link-pattern is rejected **at the redirect**, not followed to completion — one 302 can no longer defeat the whitelist.
- A request that resolves to a private / loopback / link-local / cloud-metadata address (e.g. `127.0.0.0/8`, `10/8`, `172.16/12`, `192.168/16`, `169.254/16`, `::1`) is refused — whether via the submitted URL or any redirect (defends SSRF).
- Redirect chains are bounded by a maximum hop count; exceeding it aborts the fetch.
- The IP checked against the block policy is the **same IP the connection actually uses** (resolve once, pin that address for the fetch); a hostname that passes the check cannot rebind to an internal IP for the real request (defends DNS rebinding).

#### FR-4: Deduplication
The system does not re-download content it has already successfully acquired.

**Consequences (testable):**
- The same link (or identical content by hash) already downloaded successfully is skipped and recorded as a duplicate Event rather than fetched again.

#### FR-5: Staged download
A validated file is downloaded to Staging and is not present in the Final store until it has passed a Scan (FR-6). Realizes UJ-1.

**Consequences (testable):**
- At no point between download and a passing Scan does the file exist in the Final store.

### 4.3 Scanning, Extraction & Quarantine

**Description:** Every downloaded file must pass a mandatory malware scan before it is trusted. Archives are expanded only *after* they pass, and only under guards that bound the damage a hostile archive can do. Anything that fails is isolated and logged. Realizes UJ-3.

**Functional Requirements:**

#### FR-6: Mandatory scan gate
A file leaves Staging only after passing the mandatory local Scan, which must be **live and current**; an optional reputation lookup may run as a second signal. Realizes UJ-1, UJ-3.

**Consequences (testable):**
- A file that fails the mandatory Scan is never moved to the Final store and never extracted.
- The Scan runs **fail-closed**: if the scanner is unavailable, unresponsive, or its signature database is older than a configured freshness threshold, the file is treated as failed (quarantined) — "unable to scan" is never treated as "clean."
- Content the scanner cannot actually inspect — password-protected / encrypted archives, corrupt files, or otherwise unreadable payloads — is treated as scan-failed (quarantined), not passed. A "clean" verdict on uninspectable bytes does not count as a pass.
- If the reputation lookup flags a file the local Scan passed, the file is treated as failed. `[ASSUMPTION: reputation-flag ⇒ quarantine; confirm whether it should hard-fail or only warn.]`

#### FR-7: Guarded archive extraction
An archive is extracted only after it passes the Scan, and extraction is bounded to prevent archive-bomb and path-traversal attacks. Realizes UJ-1.

**Consequences (testable):**
- Extraction bounds apply **recursively and across formats** (zip, gzip, tar, bzip2, xz, 7z, and nested archives): total uncompressed size, cumulative file count, and **nesting depth** are each capped; exceeding any cap aborts extraction and quarantines the archive (defends multi-layer decompression bombs).
- Any entry that is a symlink or hardlink, or that resolves outside the target directory, is rejected via a **canonical-path check (not a substring match)**; no file is ever written outside the isolated extraction target and none overwrites an existing file.
- Extracted contents are **re-scanned (FR-6) before any of them move to the Final store** — an archive passing as a blob does not exempt its contents. Only scanned-clean extracted files reach the Final store.

#### FR-8: Quarantine on failure
A file that fails the Scan (or extraction guards) is moved to Quarantine, logged, and never advances. Realizes UJ-3.

**Consequences (testable):**
- A failed file appears in the Dashboard quarantine list and generates a Delivery notification (FR-10); it is absent from the Final store.

### 4.4 Delivery & Notification

**Description:** The Operator is kept informed over Telegram without watching a screen — files come through directly when small enough, and everything else arrives as a clear status message. Realizes UJ-1, UJ-3.

**Functional Requirements:**

#### FR-9: File & status delivery
On pipeline outcomes, the system notifies the Operator over Telegram, sending the file directly when within Telegram's size limit and a status message otherwise. Realizes UJ-1.

**Consequences (testable):**
- A clean file ≤ 50MB is delivered as the actual file.
- A clean file > 50MB triggers a text message ("file ready, too large to send directly, check the dashboard"), not a failed send attempt.
- A successful archive extraction is announced as a summary list of contained filenames, not one message per extracted file.

#### FR-10: Failure never silent
Quarantine and pipeline failures always produce a Delivery notification. Realizes UJ-3.

**Consequences (testable):**
- A quarantined file produces a quarantine notification; the pipeline never fails silently on a scanned-and-rejected file.

### 4.5 Control Dashboard & Event Log

**Description:** A local dashboard is the Operator's single surface for control (managing both whitelists live) and visibility (connection status, the full Event log, the quarantine list, and re-pairing when the session needs a fresh QR). Realizes UJ-2, UJ-3.

**Functional Requirements:**

#### FR-12: Whitelist management
The Operator can add, edit, activate, and deactivate Contact and Link-pattern entries from the Dashboard. Realizes UJ-2.

**Consequences (testable):**
- Every whitelist field named in the Glossary (sender identity + label + active flag; pattern + type + active flag) is editable from the Dashboard, and edits persist.

#### FR-13: Visibility
The Dashboard shows current connection status, the Event log, and the quarantine list. Realizes UJ-3.

**Consequences (testable):**
- Every Event (received/ignored/downloaded/scanned/delivered/quarantined) with its metadata (status, source contact, link, filename, scan result, timestamp) is viewable.
- Quarantined files are listed distinctly from delivered files.

#### FR-14: Re-pair surface
When the WhatsApp session requires a fresh QR, the Dashboard displays a scannable QR image and the Operator is alerted over Telegram. Realizes UJ-1.

**Consequences (testable):**
- On a session-invalidated state, a QR is rendered as an image in the Dashboard (not a terminal print) and a Telegram alert is sent; the system does not silently loop trying to reconnect.

### 4.6 Connection Resilience

**Description:** The WhatsApp session recovers from transient disconnects on its own and only demands human action (re-pair) when it genuinely must, without raising ban risk. *Recovery mechanism detail (per-disconnect-reason handling, backoff, auth-state storage) is specified in `addendum.md`.*

**Functional Requirements:**

#### FR-15: Resilient reconnection
The system distinguishes transient disconnects (auto-recover) from session-invalidating ones (require re-pair, FR-14) and paces reconnection attempts.

**Consequences (testable):**
- A transient disconnect leads to an automatic reconnect with backoff and a retry cap, not an immediate tight retry loop.
- A logout/session-invalid state stops auto-reconnect and triggers the re-pair surface (FR-14).

**Notes:** `[NOTE FOR PM]` A banned secondary number can be indistinguishable from a logout and is unrecoverable in code — an operational risk carried in §8, not a solvable FR.

### 4.7 Fail-Safe Behavior & File Integrity

**Description:** The pipeline defaults to *not advancing* a file whenever any step cannot complete safely, and it never trusts attacker-supplied metadata about a file's type or name. Realizes UJ-3.

**Functional Requirements:**

#### FR-17: Fail closed on any unsafe or incomplete condition
Any pipeline step that cannot complete safely leaves the file out of the Final store — logged and notified. The safe default is "do not deliver." Realizes UJ-3.

**Consequences (testable):**
- An incomplete or interrupted download (connection dropped, disk full, size cap hit) never advances to Scan or Final store; the partial file is discarded and the failure recorded.
- If the mandatory Scan cannot run (FR-6), the file does not reach the Final store. If the optional reputation lookup errors or rate-limits, the system holds or degrades to local-scan-only per configured policy. `[ASSUMPTION: reputation-outage policy — confirm hold vs. degrade.]`
- A failure to record an Event or send a Telegram notification is itself logged and surfaced, never silently dropped; worker/UI contention on the shared store does not corrupt or lose an Event.

#### FR-18: Content and filename integrity
The system classifies files by actual content, sanitizes stored names, and never makes downloaded files executable.

**Consequences (testable):**
- The acceptable-type decision (FR-3) is based on the file's **real bytes**, not the declared Content-Type or URL extension; a mismatch (e.g. a `.pdf` that is actually a PE executable) is rejected or quarantined.
- Stored filenames are sanitized (no path separators, control characters, or overlong names) before writing to Staging, Final store, or Quarantine.
- Files are written **non-executable** and outside any auto-run / watched path; the system never executes downloaded content.

## 5. Non-Goals (Explicit)

- **Attachments and captions are not handled.** Only `http(s)` URLs in message **text**; native WhatsApp file attachments and URLs inside image/document/video captions are out of v1.
- **Not multi-user.** Single Operator, single secondary WhatsApp number.
- **Not hosted / not remote.** Runs locally; the Dashboard is not publicly exposed.
- **Not a large-file relay.** Files over Telegram's 50MB limit are not delivered through Telegram (no self-hosted Bot API server in v1); the Dashboard is the fallback.
- **Not a general downloader.** Arbitrary senders and arbitrary URLs are never fetched — the whitelists are the product, not a setting.

## 6. MVP Scope

### 6.1 In Scope

- Sender + link-pattern gated ingestion from WhatsApp text messages, evaluated live.
- Pre-fetch validation, dedup, staged download.
- Mandatory local scan; optional reputation lookup; guarded post-scan archive extraction; quarantine on failure.
- Telegram delivery/notification (file ≤50MB, status otherwise, archive summary, failure alerts).
- Local dashboard: whitelist management, connection status, event log, quarantine list, QR re-pair.
- Persisted event log.
- Resilient reconnection with re-pair surfacing.
- Safety guarantees: redirect/SSRF guard, streaming size cap, recursive extraction bounds, scanner fail-closed, and content/filename integrity (FR-16, FR-17, FR-18).

### 6.2 Out of Scope for MVP

- Attachment/caption handling — *deferred, v2 candidate.* `[NOTE FOR PM]` This is the most likely "we should also…" request; flagged for revisit if the trusted flow proves it out.
- Files > 50MB over Telegram (self-hosted Bot API server) — *deferred, adopt only if the need is clear.*
- Multi-operator, remote/hosted access, auth on the dashboard — *out; single local operator assumption.*
- Automated re-pair for a banned number — *not solvable; operational procedure only.*

## 7. Success Metrics

*Stakes: internal pilot, ship-focused, no timebox. Metrics are lightweight and outcome-anchored.*

**Primary**
- **SM-1**: End-to-end correctness — a whitelisted-contact + whitelisted-link message reliably results in a scanned file in the Final store (or Quarantine if it fails), with the correct Telegram outcome. Target: works on real messages across the common cases (small file, large file, archive, malicious file, ignored sender). Validates FR-1, FR-2, FR-5, FR-6, FR-7, FR-9, FR-10.
- **SM-2**: Scan gate provably blocks known-bad — a known-malicious test artifact (e.g. the EICAR test file), and hostile inputs across the redirect-bypass, archive-bomb, and scanner-down cases, are **always quarantined and never reach the Final store**. Target: 0 escapes across those test cases (a falsifiable control, not a true-by-definition claim). Validates FR-6, FR-7, FR-8, FR-16, FR-17.

**Secondary**
- **SM-3**: Live control works — whitelist edits take effect with no restart. Validates FR-11, FR-12.

**Counter-metrics (do not optimize)**
- **SM-C1**: Do not chase ingestion breadth (handling more message/link shapes) at the cost of the whitelist guarantees — over-broadening the gates works against SM-1's reliability and SM-2's safety. The whitelists staying narrow is a feature.

## 8. Open Questions

1. Confirm/replace the `[ASSUMPTION]` problem framing carried from the brief (§1) with the real use case.
2. Reputation-lookup flag semantics (FR-6): hard-fail to quarantine, or warn-only?
3. Configured caps (FR-3, FR-7): max download size, max uncompressed archive size, cumulative file count, and max archive **nesting depth** — concrete values.
4. Dedup basis (FR-4): match on URL, on content hash, or both?
5. Network-safety policy (FR-16): max redirect hops, and the exact private/reserved IP ranges to block.
6. Scanner freshness threshold (FR-6): how old may ClamAV signatures be before a file is failed-closed?
7. Reputation-outage policy (FR-17): when VirusTotal is unreachable, hold the file or proceed on local scan only?
8. Which secondary WhatsApp number, and Telegram bot/chat-id setup (operational, from brief §10).
9. Operational procedure when the secondary number is banned (unrecoverable) — how does the Operator recover the flow?
10. Sender-identity trust (FR-1): how is a whitelisted sender verified — can a JID/display be spoofed, and does that change the trust model?
11. Link-pattern grammar (FR-2): how are patterns expressed and matched, and how do we prevent an over-permissive pattern from acting as a wildcard?
12. Rate / concurrency caps: max in-flight downloads and per-sender message rate, to bound resource use and abuse.

## 9. Assumptions Index

- §1 Vision / problem framing — inferred (trusted contacts sharing build/asset/document links); carried from brief `[ASSUMPTION]`, unconfirmed.
- §2.3 UJ personas ("Rizal", supplier) — illustrative names, not real users.
- §4.3 FR-6 — reputation-lookup flag assumed to force quarantine; confirm hard-fail vs. warn.
- §4.7 FR-17 — reputation-outage policy assumed configurable (hold vs. degrade to local-scan-only); confirm the default.
- §6 — 50MB assumed as the effective delivery ceiling (Telegram standard limit), no self-hosted server.
