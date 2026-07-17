---
stepsCompleted: ["step-01-validate-prerequisites"]
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

{{requirements_coverage_map}}

## Epic List

{{epics_list}}
