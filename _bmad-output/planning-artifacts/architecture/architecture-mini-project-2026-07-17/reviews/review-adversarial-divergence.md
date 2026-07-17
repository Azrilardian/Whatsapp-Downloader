---
title: Adversarial Divergence Review — ARCHITECTURE-SPINE (WhatsApp Downloader)
reviewer: adversarial architecture reviewer
method: two-compliant-units divergence attack
target: ../ARCHITECTURE-SPINE.md
prd: ../../../prds/prd-mini-project-2026-07-17/prd.md
date: 2026-07-17
verdict: NOT READY TO BUILD — 4 critical seam holes
---

# Adversarial Divergence Review — WhatsApp Downloader Spine

## Attack model

For each finding I construct **two units one level down** (two filters, the worker vs the
dashboard, or two developers implementing different FRs) that each obey **every** Architecture
Decision (AD) to the letter, yet build **incompatibly**. Every such pair is a hole the spine must
close with a new or tightened AD. No praise; only holes.

## Verdict

**NOT READY TO BUILD.** The spine nails the *safety* invariants (fetch guarding, fail-closed,
extraction bounds) but leaves the **shared-data contract underspecified at exactly the one seam it
declares** (the SQLite file). The `events` table is described two mutually incompatible ways, the
`status` enum omits a status its own fail-closed rule references, and no AD fixes the DB-write vs
file-move order that AD-7's headline invariant depends on. Four critical divergences below can each
produce two "fully compliant" implementations that cannot read each other's data.

## Findings

Severity legend: **critical** = two compliant units cannot interoperate / invariant breaks;
**high** = silent behavioral divergence or data desync; **medium** = display/semantic drift; **low** = cosmetic.

---

### C-1 — `events` is BOTH an append-only audit log AND the single-status holder, with no correlation id `[critical]`
**ADs involved:** AD-5, AD-2, Consistency Conventions (Errors & logging), ER diagram.

The spine says two incompatible things about the same table:
- **Conventions:** "Every pipeline outcome (advance, drop, fail) is written as **one structured Event
  row**; the Event log is the audit trail." → **append-only, many rows per item.**
- **AD-5:** "every ingested item holds **exactly one** `status` … transitions are one-directional." →
  reads as **one mutable row per item whose `status` is updated in place.**

The ER diagram gives `events { uuid id PK }` and **no `item_id` / correlation key**.

**Two-compliant-units divergence (one line):** Dev A models `events` as an append-only transition log
(one row per outcome, `status` = that outcome) correlated by an `item_id`; Dev B models `events` as
one mutable row per item whose `status` advances in place — both obey AD-5 and the logging convention,
and their schemas are unreadable to each other, with no `item_id` even defined for Dev A to correlate on.

**Fix direction:** New AD pinning the event model explicitly. Recommend: `items` (or reuse `events`) is
the **append-only** log; introduce a first-class **`item_id`** (the correlation key an "item" is
defined by, since AD-5 keeps saying "item" but the ER has no such entity); the "current status" is
either the latest row's status or a derived view — state which. One sentence closes it.

---

### C-2 — Where `status` lives (events vs files) is undefined, and `files` is keyed by a value that does not exist for pre-download states `[critical]`
**ADs involved:** AD-5, AD-2, AD-10, ER diagram.

AD-5 says the *item* holds the status. AD-2 lists the worker as writer of "events, **file/item
status**" — conflating two entities. The ER shows `events ||--o| files` and `files { sha256 id PK }`.
But `sha256` is the **post-download** content hash (AD-10). Items in `received / validating /
rejected / ignored / duplicate` **never produce a files row** (no bytes, no hash), so `status`
cannot live on `files`.

**Two-compliant-units divergence:** Dev A puts `status` on `events` (item = event, files is just the
blob record); Dev B puts `status` on `files` and treats the file as the item — but then every
pre-download and rejected item has nowhere to hold its status, and a resend that dedups to an existing
hash (AD-10) has no place for its own `duplicate` status because `files.sha256` is already taken. Both
"compliant"; incompatible schemas and the `events||--o|files` 1:1 cardinality contradicts AD-10's
many-events-to-one-hash reality.

**Fix direction:** Tighten AD-2/AD-5: **status lives on the item/event row, never on `files`**;
`files` is a content-addressed blob record (sha256 PK) that many events may reference (change ER
cardinality to `events }o--|| files`). State the FK direction.

---

### C-3 — AD-6 and FR-17 reference a `failed` status that AD-5's enum does not contain `[critical]`
**ADs involved:** AD-5, AD-6, FR-17.

AD-6 rule: transitions "→ `quarantined`/`rejected`/**`failed`**". FR-17 title: "Fail closed." But
AD-5's fixed enum is `ignored, duplicate, rejected, quarantined, delivered, stored` +
`received…extracting`. **There is no `failed`.** AD-5 also forbids inventing statuses: "no side
invents a status."

**Two-compliant-units divergence:** Dev A (reading AD-6 literally) writes `status = 'failed'` for an
interrupted download; the shared enum in `shared/` rejects it or Dev A adds `failed` — violating
AD-5's closed enum. Dev B maps the same interrupted-download outcome to `rejected` or `quarantined`.
The dashboard's quarantine/failure queries (FR-8, FR-13) miss Dev A's rows entirely.

**Fix direction:** Reconcile the enum. Either add `failed` to AD-5's terminal set, or strike `failed`
from AD-6/FR-17 and map interrupted/incomplete conditions to a named existing terminal (recommend a
dedicated `rejected` vs `quarantined` split — see M-2). Pick one; the enum must be the single source.

---

### C-4 — AD-7 fixes *atomicity of the rename* but not the *order* of DB-write vs file-move; a crash desyncs dir and status `[critical]`
**ADs involved:** AD-7, AD-13, AD-6.

AD-7: "a file's directory must match its DB `status`; moves are **atomic renames**; a file is never
in `final/` without a recorded passed scan." Atomic rename guarantees the *move* is all-or-nothing,
but says nothing about ordering the move relative to the **DB write**, which is a *separate*
operation. There is no restart-reconciliation rule.

**Two-compliant-units divergence:** Dev A writes `status=stored` then renames `staging/→final/`; Dev B
renames then writes `status=stored`. Crash in the gap: Dev A leaves `status=stored` with the file
still in `staging/` (dir ≠ status — AD-7 invariant broken); Dev B leaves the file in `final/` with
`status=scanning` (file in `final/` with no recorded passed scan — AD-7's headline invariant broken).
Both used atomic renames; both are "AD-7 compliant" in isolation.

**Fix direction:** New AD (or tighten AD-7): **fix the order** — write the DB status *last* and treat
the filesystem as reconstructible from status on boot (or vice versa, but pin one), and add a
**startup reconciliation rule**: on boot, any item whose dir ≠ status is repaired toward the
fail-closed side (AD-6) — a file found in `final/` without a recorded passed scan is quarantined, not
trusted. Name who runs it (worker, AD-4).

---

### H-1 — Dedup has no pre-download key; content-hash-primary (AD-10) means every resend re-downloads before it can be deduped `[high]`
**ADs involved:** AD-10, FR-4, AD-8, AD-13.

AD-10: dedup identity = "SHA-256 of its **downloaded bytes** (primary) plus the source URL." The hash
only exists **after** the fetch. FR-4's testable consequence: an already-acquired link "is **skipped**
and recorded as a duplicate Event **rather than fetched again**." To skip the *fetch* you need a
**pre-download** key — the URL — but AD-10 marks URL secondary and flags `[ASSUMPTION:
content-hash-primary]`.

**Two-compliant-units divergence:** Dev A implements dedup as content-hash-only, checked post-download
→ every resend re-fetches (through the guarded fetcher, burning bandwidth/SSRF surface) then discards
— violating FR-4's "not fetched again" while still obeying AD-10 as written. Dev B pre-checks a
normalized URL and skips the fetch. Both "compliant"; opposite network behavior.

**Fix direction:** Tighten AD-10 into **two keys**: a **pre-download dedup key** (normalized source
URL) that short-circuits before the fetcher runs, and a **post-download content key** (sha256) that
dedups delivery/storage. State that FR-4's "rather than fetched again" is satisfied by the URL key.

---

### H-2 — Whitelist read-freshness is unpinned; a compliant worker can cache and go stale, breaking FR-11's "no restart" `[high]`
**ADs involved:** AD-3, AD-2, FR-11, SM-3.

FR-11/SM-3 require whitelist edits to take effect "on the **next incoming message** without
restarting." AD-3 gives WAL + `busy_timeout`, and AD-2 makes the dashboard the sole whitelist writer —
but **nothing forbids the worker from caching the whitelist in memory or holding a long-lived read
transaction.** Under WAL, a reader inside an open transaction sees a *snapshot* frozen at txn start.

**Two-compliant-units divergence:** Worker-Dev A queries `contacts`/`link_patterns` fresh per inbound
message on a short read → live edits honored. Worker-Dev B loads whitelists at startup (or holds one
long read txn) for performance → dashboard edits are invisible until restart, silently violating FR-11
while fully obeying AD-2 and AD-3.

**Fix direction:** New AD: the worker **re-reads the active whitelist per message on a fresh/short read
transaction; no cross-message caching** of whitelist state (or, if cached, an explicit invalidation
signal — but AD-1 forbids IPC, so per-message read is the clean answer). Ties the read-your-writes
guarantee to the seam.

---

### H-3 — The bounded queue's persistence and restart ownership are undefined; non-terminal items are orphaned or silently resumed `[high]`
**ADs involved:** AD-13, AD-6, AD-5, AD-4.

AD-13 defines a bounded queue with overflow-queues-not-runs, but never says whether **queue state is
persisted** or **who owns it on restart**. Items in `downloading`/`scanning`/`extracting` are
non-terminal (AD-5) and their in-flight position lives in RAM.

**Two-compliant-units divergence:** Dev A keeps the queue in-memory; a worker crash drops queued items
— they remain `downloading` in the DB **forever** (stuck non-terminal), and the dashboard shows them
as in-progress indefinitely. Dev B scans the DB for non-terminal statuses on boot and re-enqueues them
— re-running side effects (re-download, interacting with H-1 dedup). Both "compliant" with AD-13;
opposite recovery semantics and one leaks stuck items.

**Fix direction:** New AD (pairs with C-4's reconciliation): **on startup the worker sweeps all
non-terminal items and drives each to a fail-closed terminal** (AD-6) — re-enqueue only where safe and
idempotent under the dedup keys (H-1); never leave an item non-terminal across a restart. The DB, not
RAM, is the queue's source of truth.

---

### H-4 — The link-pattern matcher is implemented twice (ingestion gate vs redirect re-check) with no mandate to share one implementation `[high]`
**ADs involved:** AD-12, AD-8, FR-2, FR-16.

AD-5 mandates the **status enum** lives in `shared/`, but **nothing** puts the AD-12 pattern matcher
there. FR-2 evaluates it in `worker/pipeline` (gate); FR-16/AD-8 re-evaluate it in `worker/fetcher` on
**every redirect hop** — two code sites implementing the same "exact-domain (+ optional path prefix)
and/or extension allowlist" grammar.

**Two-compliant-units divergence:** Gate-Dev matches extensions case-insensitively and treats
`example.com` as covering `www.example.com`; Fetcher-Dev matches case-sensitively and requires exact
host. A URL passes the gate then is rejected at a same-host redirect (or worse, the reverse: the
fetcher accepts a redirect the gate would have blocked). Both obey AD-12's grammar; the two matchers
disagree — a whitelist bypass or false reject depending on direction (directly undermines SM-2).

**Fix direction:** Tighten AD-12: the pattern matcher is a **single function exported from `shared/`
and imported by both the gate and the fetcher** — same as the status enum. Additionally pin the
under-specified semantics: subdomain handling (exact host vs suffix), case-folding of host/extension,
and trailing-slash/path-prefix boundary.

---

### H-5 — `delivered` and `stored` overlap: a small clean file is both, but AD-5 permits exactly one status `[high]`
**ADs involved:** AD-5, AD-11, FR-5, FR-9.

AD-5 terminals include both `delivered` and `stored`, and mandates "**exactly one** status." But a
clean ≤50MB file is filed in `final/` (`stored`, FR-5) **and** sent over Telegram (`delivered`,
FR-9/AD-11). These are not mutually exclusive outcomes, yet the item may hold only one terminal
status.

**Two-compliant-units divergence:** Deliver-Dev A marks a small clean file `delivered`; Storage-Dev B
marks the same outcome `stored`. Both are in `final/`; both obey AD-5. The dashboard's
"delivered vs …" views (FR-13) and any "is it in the final store?" query split the population
arbitrarily depending on which dev's filter set the terminal.

**Fix direction:** Decide the axis. Either (a) `stored` is the terminal for final-store membership and
Telegram delivery is a **separate boolean/side-effect record** (consistent with AD-11 calling
notification a side effect, not a state) — recommended; or (b) enumerate an explicit ordered terminal
(`stored` → then a delivery sub-state). Remove the overlap from the single-status enum.

---

### H-6 — auth_state / QR / connection-status crossing the seam is unmodeled and self-contradictory `[high]`
**ADs involved:** AD-9, AD-1, AD-2, FR-13, FR-14.

AD-9: "neither secrets nor **session bytes live in the shared SQLite tables the dashboard reads**;"
Baileys auth uses "a **dedicated store**." Yet the ER diagram models `auth_state { key string PK }` as
a table in the same schema. Meanwhile FR-13 (connection status) and FR-14 (render QR **image** in the
dashboard + Telegram alert) require the worker's session/connection state to reach the dashboard —
and AD-1 says the **only** cross-process transport is the SQLite file.

**Two-compliant-units divergence:** Worker-Dev A stores Baileys auth as a table in the shared DB (per
the ER) under worker migrations (AD-4), asserting the dashboard "just doesn't read it"; Worker-Dev B
puts auth in a separate file/store (per AD-9's "dedicated store, not in shared tables"). For FR-14,
Dev A writes the QR string into a `session_status` row; Dev B writes a PNG to disk and stores only a
path. The dashboard team, reading a different model, cannot render the QR or show connection status.
All four are "compliant" with some subset of AD-9/AD-1/ER.

**Fix direction:** (1) Resolve AD-9 vs the ER: **auth_state is NOT in the shared DB** — remove it from
the ER, or explicitly carve it as worker-private and un-migrated. (2) New AD naming the **seam entity
for connection status + current QR** that the worker writes and the dashboard reads (this is worker-
owned pipeline-adjacent state — extend AD-2's writer list). Pin whether the QR crosses as a data URI
in a row or a file path, since FR-14 requires an image, not a terminal print.

---

### M-1 — The event/file/contacts/link_pattern **column shapes and types** are unpinned; only PKs + the status enum are fixed `[medium]`
**ADs involved:** AD-4, AD-5, FR-12, FR-13.

The spine pins the status enum (AD-5) and PKs (ER) but **not the actual columns** the dashboard must
read. FR-13 demands: status, source contact, link, filename, **scan result**, timestamp. AD-4 makes
the worker the schema owner and the dashboard a read-only consumer — but the spine never states the
column names/types/nullability of the contract the dashboard consumes.

**Two-compliant-units divergence:** Worker-Dev A stores `scan_result` as a boolean; Worker-Dev B as a
free-text engine verdict; a third as an enum. The dashboard, written against one shape, breaks against
another — all obey AD-4/AD-5. Same for null semantics: an `ignored` event has null filename/scan; the
dashboard may treat null as "pending" vs "not applicable."

**Fix direction:** New companion (a `shared/schema` contract table in the spine, or a tightened AD-4):
enumerate the **column names, types, and null semantics** of `events`, `files`, `contacts`,
`link_patterns` — at least for every field FR-12/FR-13 name. The dashboard's read contract must be as
pinned as the enum. (`scan_result` type in particular: enum, not free text.)

---

### M-2 — `rejected` vs `quarantined` selection for SSRF/redirect/validation failures is unpinned; the dashboard's quarantine list becomes non-deterministic `[medium]`
**ADs involved:** AD-6, AD-8, FR-16, FR-8, FR-13.

AD-6 lists `quarantined`/`rejected`(/`failed`) as fail-closed targets but never maps **which failure
class goes to which terminal.** FR-16 says a bad redirect/SSRF is "rejected"; FR-8 says scan failures
"quarantine." Validation failures (FR-3), redirect failures (FR-16), and scan failures (FR-6) each
need a definite terminal.

**Two-compliant-units divergence:** Fetcher-Dev A marks an SSRF/redirect-blocked URL `rejected`;
Fetcher-Dev B marks it `quarantined`. FR-13's quarantine list (which must list quarantined distinctly
from delivered) shows a different population depending on the dev — both obey AD-6.

**Fix direction:** Tighten AD-6 with a **failure-class → terminal-status table**: pre-fetch/gate/
redirect/SSRF rejections → `rejected`; downloaded-then-failed-scan/extraction → `quarantined`;
interrupted/incomplete → the C-3 resolution. Make it exhaustive.

---

### M-3 — Pipeline filter order (dedup before fetch) contradicts the dedup key (post-fetch hash), and per-transition legality is not enumerated `[medium]`
**ADs involved:** AD-5, AD-10.

The paradigm lists the order `gate → validate → **dedup** → fetch → scan → extract`. So dedup runs
**before** fetch — but AD-10's primary key is the **post-fetch** content hash. AD-5 says transitions
are "one-directional toward terminal" but **does not enumerate the legal transition set** (which
terminal may follow which non-terminal, or where `duplicate` is entered).

**Two-compliant-units divergence:** Dedup-filter-Dev checks content hash and, finding it can't (no
bytes yet), passes everything through to fetch; Fetch-filter-Dev assumes dedup already blocked
resends. A resend is fetched, hashed, found duplicate post-fetch, and now must transition to
`duplicate` from `scanning`-ish — a path neither dev enumerated. Both "compliant" with a state machine
whose edges were never drawn.

**Fix direction:** Draw the **explicit transition table** in AD-5 (every legal `from → to` edge,
including where `duplicate` is reachable from) and reconcile with H-1's two-key dedup so the
pre-download URL check sits before fetch and the post-download hash check sits after.

---

### L-1 — `contacts` / `link_patterns` active-flag column name and semantics are unpinned `[low]`
**ADs involved:** AD-2, AD-4, FR-1, FR-12.

The worker reads the `active` flag to gate (FR-1); the dashboard writes it (FR-12). AD-4 (worker owns
schema) *mostly* saves this — the worker defines the column — but the spine never states that the
worker's migration defines the exact columns FR-12 needs, so a dashboard dev may assume `is_active`
while the worker migrates `active`. Mitigated by AD-4 but not stated. Fold into M-1's column contract.

---

## Summary table

| ID | Sev | ADs | One-line divergence |
| --- | --- | --- | --- |
| C-1 | critical | AD-5, AD-2, Conventions | `events` is both append-only log and single-status holder, with no `item_id` to correlate — two incompatible schemas. |
| C-2 | critical | AD-5, AD-2, AD-10 | Status location (events vs files) undefined; `files` is keyed by post-download sha256 so it can't hold pre-download states. |
| C-3 | critical | AD-5, AD-6, FR-17 | AD-6/FR-17 use a `failed` status that AD-5's closed enum omits — one dev invents it, another maps away. |
| C-4 | critical | AD-7, AD-13, AD-6 | AD-7 fixes rename atomicity but not DB-write vs move *order*; a crash lands a file in `final/` without a passed scan (or status=stored in staging). |
| H-1 | high | AD-10, FR-4, AD-8 | No pre-download dedup key; content-hash-primary means every resend re-fetches before it can dedup. |
| H-2 | high | AD-3, FR-11 | Whitelist read-freshness unpinned; a caching worker goes stale and breaks "no restart." |
| H-3 | high | AD-13, AD-6 | Queue persistence/restart ownership undefined; non-terminal items orphaned forever or silently re-run. |
| H-4 | high | AD-12, AD-8, FR-16 | Pattern matcher implemented twice (gate vs redirect re-check); divergent host/case/extension semantics = bypass or false reject. |
| H-5 | high | AD-5, AD-11 | `delivered` and `stored` overlap for a small clean file, but AD-5 allows exactly one status. |
| H-6 | high | AD-9, AD-1, AD-2, FR-14 | auth_state modeled as a shared table yet AD-9 forbids it; QR/connection-status seam entity unmodeled. |
| M-1 | medium | AD-4, AD-5, FR-13 | Column shapes/types/null-semantics of the dashboard read-contract unpinned (e.g. `scan_result`). |
| M-2 | medium | AD-6, AD-8, FR-16 | `rejected` vs `quarantined` per failure class unpinned; quarantine list non-deterministic. |
| M-3 | medium | AD-5, AD-10 | Dedup-before-fetch order contradicts post-fetch hash key; transition set not enumerated. |
| L-1 | low | AD-2, AD-4 | active-flag column name/semantics unpinned (mostly saved by AD-4). |

## Counts

- critical: 4
- high: 6
- medium: 3
- low: 1
- **total: 14**

## Closing note

Every finding is a place where two developers can each pass an AD-compliance checklist and still ship
schemas or behaviors that cannot read each other across the SQLite seam — which is the *only* seam the
architecture has. The four criticals cluster on one root cause: **the shared-data contract (`events`
model, `status` ownership, the enum, and the write/move order) is named but not pinned.** Close C-1
through C-4 first; they gate everything the dashboard reads.
