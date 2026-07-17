---
id: SPEC-whatsapp-downloader
companions:
  - ../planning-artifacts/prds/prd-mini-project-2026-07-17/prd.md
  - ../planning-artifacts/prds/prd-mini-project-2026-07-17/addendum.md
  - ../planning-artifacts/architecture/architecture-mini-project-2026-07-17/ARCHITECTURE-SPINE.md
sources:
  - ../../brief.md
---

> **Canonical contract.** This SPEC and the files in `companions:` are the complete, preservation-validated contract for what to build, test, and validate. The PRD holds per-FR testable detail and open questions; the addendum holds mechanism/tech; the architecture spine holds the invariant decisions (`AD-1`..`AD-16`) downstream must cite. Source documents in frontmatter are traceability only.

# WhatsApp Downloader

## Why

A pain to solve, doubling as a pilot. Trusted contacts routinely share download links in WhatsApp — builds, assets, documents — and handling them by hand is tedious and unsafe: tap, download, hope it's clean, file it somewhere it won't get lost, and skip the malware check. This automates that narrow trusted-source path end to end: a whitelisted contact's whitelisted link is fetched, scanned before it is ever trusted, filed or quarantined, and reported over Telegram, with a local dashboard for control. It is also the first run of the trimmed AI-dev workflow (BMAD → task-master → Agent SDK) ahead of a larger AI-tools dashboard — but the product's own success is judged only by the working pipeline, not by the workflow experiment.

## Capabilities

- **CAP-1 — Gated ingestion**
  - **intent:** The system advances only messages from a whitelisted sender carrying an `http(s)` URL (in message text) that matches an active link-pattern; both whitelists are operator-editable while running.
  - **success:** A whitelisted sender + whitelisted link advances; a non-whitelisted sender or non-matching link is silently ignored; a whitelist edit takes effect on the next message with no restart. (FR-1, FR-2, FR-11; AD-2, AD-5, AD-12)

- **CAP-2 — Safe acquisition**
  - **intent:** The system validates, de-duplicates, and fetches a matched link into a staging area through a single guarded fetcher, trusting no attacker-supplied metadata.
  - **success:** Oversize (streamed-cap), private/redirected-to-internal (SSRF), and already-seen (dedup) targets are rejected before a file is committed; a valid file lands only in staging. (FR-3, FR-4, FR-5, FR-16; AD-8, AD-10, AD-13)

- **CAP-3 — Scanning, extraction & quarantine**
  - **intent:** Every downloaded file must pass a live, fail-closed malware scan before it is trusted; archives are expanded only after passing, under bomb/zip-slip guards, and their contents re-scanned before any move to the final store.
  - **success:** A known-bad artifact (EICAR), a decompression bomb, and a scanner-down condition are always quarantined; nothing reaches the final store without a recorded passed scan; unscannable content (encrypted/corrupt) is treated as failed. (FR-6, FR-7, FR-8; AD-6, AD-7)

- **CAP-4 — Delivery & notification**
  - **intent:** The operator is kept informed over Telegram of every pipeline outcome without watching a screen.
  - **success:** A clean file ≤50MB is delivered as the file; a clean file >50MB and any quarantine send the correct status message; a scanned-and-rejected file never fails silently. (FR-9, FR-10; AD-11)

- **CAP-5 — Control dashboard & event log**
  - **intent:** A local dashboard lets the operator manage both whitelists and see connection status, the full event log, the quarantine list, and re-pair when the session needs a fresh QR.
  - **success:** Whitelist add/edit/activate/deactivate persists; every pipeline event with its metadata is viewable and quarantine is listed distinctly; a session-invalidated state renders a scannable QR image plus a Telegram alert. (FR-11, FR-12, FR-13, FR-14; AD-1, AD-4, AD-14)

- **CAP-6 — Connection resilience**
  - **intent:** The WhatsApp session recovers from transient disconnects on its own and demands human re-pairing only when it genuinely must, without behaving in ways that raise ban risk.
  - **success:** A transient disconnect auto-reconnects with backoff and a retry cap; a logout/session-invalid state stops auto-reconnect and triggers the re-pair surface. (FR-14, FR-15; AD-9, AD-15)

- **CAP-7 — Fail-safe behavior & file integrity**
  - **intent:** The pipeline defaults to not advancing a file whenever a step cannot complete safely, and never trusts attacker-supplied type or name metadata.
  - **success:** An incomplete download, disk-full, or scanner-unavailable condition never reaches the final store; a declared-type/real-bytes mismatch is rejected or quarantined; stored files are sanitized-named and non-executable. (FR-17, FR-18; AD-6, AD-7, AD-15)

- **CAP-8 — Policy settings**
  - **intent:** The operator can view and adjust the pipeline's tunable policy values (size/archive caps, redirect hops, scanner-signature freshness, concurrency and per-sender rate, the VirusTotal flag and outage policies, and backup cadence/retention) from the dashboard, and the worker honors changes without a restart.
  - **success:** Editing a policy value in the dashboard changes the worker's behavior on the next relevant operation with no restart; secrets (Telegram/VirusTotal keys) are never exposed in this surface. (FR-19; AD-17, AD-2)

## Constraints

- **Whitelist-gated on both sides, narrow by design.** Only whitelisted senders and whitelisted link shapes are ever fetched; the whitelists are the product, not a tunable setting. Patterns are exact-domain (optional path prefix) and/or extension allowlist — no regex, no wildcard TLD (AD-12).
- **Secondary WhatsApp number only.** An unofficial library (Baileys) on a dedicated non-primary number; a ban is outside our control, indistinguishable from logout, and permanent — not recoverable in code.
- **URL-in-message-text only.** Native WhatsApp attachments and URLs in media captions are not parsed.
- **Fail-closed everywhere.** Staging → scan → final ordering is absolute; "unable to scan" is never "clean"; any error edges away from the final store (AD-6).
- **One guarded fetcher.** All outbound content fetches route through a single component enforcing IP-pinning against private ranges, per-redirect gate re-check, and a streaming size cap (AD-8, AD-16 network rules).
- **Two-process architecture, SQLite is the sole seam.** An always-on worker and a Next.js dashboard never call each other; they integrate only through one WAL-mode SQLite file. The worker is the sole writer of pipeline state (`items`/`events`); the dashboard writes only the whitelist tables (AD-1, AD-2, AD-3, AD-14).
- **Local, single-operator.** Runs locally; the dashboard is not publicly exposed; no auth in v1.
- **50MB Telegram ceiling.** Files above the `sendDocument` limit are surfaced via the dashboard, not relayed (no self-hosted Bot API server in v1).
- **Pinned tech baseline.** Node 24 LTS, Baileys 6.7.x (stable, not the 7.0-rc), Next.js 16.2.x, better-sqlite3 12.11.x; ClamAV (mandatory) + VirusTotal hash-lookup only. Mechanism detail lives in the addendum and spine.

## Non-goals

- Native WhatsApp attachments or caption URLs (v2 candidate).
- Multiple operators / multiple WhatsApp numbers.
- Cloud hosting, remote access, or an exposed/authenticated dashboard.
- Relaying files above Telegram's 50MB limit through Telegram.
- A general-purpose downloader — arbitrary senders or arbitrary URLs are never fetched.

## Success signal

On real messages, a whitelisted contact's whitelisted link reliably ends as a scanned file in the final store (or in quarantine if it fails), with the correct Telegram outcome — across the small-file, large-file, archive, malicious-file, and ignored-sender cases. No file ever reaches the final store without passing a scan (provable: an EICAR artifact is always quarantined, including when the scanner is down), and whitelist edits take effect with no restart.

## Assumptions

- Dedup treats a re-sent URL as a duplicate and does not re-fetch (content-hash primary + pre-download URL key); to be confirmed in case linked content legitimately changes (AD-10).
- Baileys 6.7.x stable is used rather than the 7.0.0 release candidate for pilot stability.
- 50MB is the effective delivery ceiling (Telegram standard `sendDocument` limit).
- The "Why" framing (trusted contacts sharing build/asset/document links) is inferred from the brief and unconfirmed by a real end user.

## Resolved Policy Defaults

*Seeded into the `settings` table (AD-17), editable via the dashboard (CAP-8), read live by the worker:*

- Caps: `max_download`=200MB · `max_uncompressed`=500MB · `max_file_count`=1000 · `max_nesting_depth`=3 · `max_redirect_hops`=5 · `scanner_sig_max_age`=48h.
- Throughput: `max_concurrent`=2 · `per_sender_rate`=10/min.
- Scan policy: VirusTotal flag on a ClamAV-clean file → **hard-fail** to quarantine; VirusTotal unreachable → **hold** the file (needs a release/retry path).
- Operational: `backup_cadence`=daily · `events_retention`=90d · process supervisor=pm2 (deploy-level).

## Open Questions

- Operational procedure for a banned secondary number, which is unrecoverable in code (PRD OQ-9; addendum §F). *Deferred.*
- Which secondary WhatsApp number and Telegram bot/chat-id setup — runtime config; the operator will provide later / capture the `chat_id` via the dashboard. *Deferred, not a build blocker.*
