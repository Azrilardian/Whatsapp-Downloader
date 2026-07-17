# Rubric Review — Architecture Spine: WhatsApp Downloader

**Reviewed:** `ARCHITECTURE-SPINE.md` (build-substrate, feature altitude, draft 2026-07-17)
**Against:** `prd.md` (final), good-spine checklist (6 items)
**Calibration:** Low-stakes internal pilot, build-substrate spine at feature altitude. Platform-grade rigor not demanded; real divergence risks held to the line.

**Overall verdict: ADEQUATE — ship after fixing the operational-dimension gap and two consistency defects.**
This is a genuinely strong *safety and state* spine: the state machine, fail-closed default, single-writer rule, guarded fetcher, and closed link-pattern grammar all fix real divergence points that stories would otherwise argue about. It is let down in one place — a whole operational dimension (how the always-on worker stays alive, how the source-of-truth is backed up, how the log is bounded) is silent, not even parked as an open question — plus two medium internal-consistency defects.

---

## Per-checklist verdict

| # | Checklist item | Verdict |
| --- | --- | --- |
| 1 | Fixes the real divergence points below; misses none | **Adequate** |
| 2 | Every AD's Rule is enforceable and prevents its divergence | **Adequate** |
| 3 | Nothing Deferred lets two units diverge | **Strong** |
| 4 | Named tech verified-current / nothing left vague-unpinned | **Thin** |
| 5 | Covers all FR-1..FR-18 via the Capability map | **Strong** |
| 6 | Every owned dimension decided/deferred/OQ (esp. operational envelope) | **Thin (broken on operational)** |

---

## Findings

### F1 — Whole operational/environmental dimension is silent `[HIGH]`
**Item 6. Section: entire spine — no AD, no Deferred entry, no open question.**

The spine calls the worker an "always-on process" (Structural Seed) and calls SQLite the source of pipeline truth and the Final store "the only trusted output location" — then never addresses the operational envelope that owns those facts at feature altitude:

- **Process supervision / always-on lifecycle** — nothing says how the worker is kept running (launchd/systemd/pm2), what restarts it on crash, or its restart policy. "Always-on" is asserted, never mechanized.
- **Backup of the SQLite source-of-truth and the Final store** — completely absent. A single unbacked SQLite file holds all pipeline state, whitelists, and the audit log; the Final store is the only trusted output. Neither has a backup dimension, not even a deferral.
- **Log retention** — the Event log is defined as the unbounded audit trail (Consistency Conventions), with no rotation/retention/pruning policy. It grows forever.
- Deployment and environment separation (dev vs. the operator's real run) are also unaddressed, though these are lighter for a single-operator local pilot.

Calibrated as HIGH not critical: single-operator local pilot lowers the blast radius, and supervision/backup are partly ops-procedure rather than code. But a build-substrate spine that never states how the always-on worker stays alive or how the data is backed up has left a dimension it owns entirely silent — epics will each improvise, or omit it.

**Fix:** Add a short "Operational envelope" AD (or explicit Deferred + open-question entries) covering: (a) supervision/restart mechanism and policy for the worker; (b) backup expectation for the SQLite file and Final store (even "manual periodic copy, documented" closes it); (c) an Event-log retention/rotation rule or an explicit "unbounded, acceptable for pilot" decision. Parking each as a decision or an OQ is enough — silence is not.

### F2 — AD-6 uses a `failed` status that AD-5's closed enum does not define `[MEDIUM]`
**Item 2. AD-6 (also FR-17 mapping, Conventions "advance/drop/fail").**

AD-5 declares a *closed* enum ("no side invents a status") — terminals: `ignored, duplicate, rejected, quarantined, delivered, stored`. AD-6's Rule then transitions items "→ `quarantined`/`rejected`/**`failed`**". `failed` is not in the enum. The spine's own invariant is violated by a sibling AD, and a story implementing fail-closed is forced to invent the very status AD-5 forbids — the exact divergence AD-5 exists to prevent.

**Fix:** Either add `failed` as a defined terminal in AD-5, or replace the AD-6 reference with an existing terminal (`quarantined`/`rejected`). Make the enum and every AD that names a status agree.

### F3 — AD-3's justification misstates SQLite locking; risks a skipped busy_timeout on the dashboard write path `[MEDIUM]`
**Item 2. AD-3.**

The Rule itself is sound (WAL + `busy_timeout` on every connection). But its closing justification — "there is exactly one writing process per domain (AD-2), so no write-write conflict can occur" — is incorrect. SQLite's write lock is **per database file, not per domain/table**. When the worker writes an Event while the dashboard commits a whitelist edit, both contend for the same file-level write lock; that contention (`SQLITE_BUSY`) is precisely what `busy_timeout` handles. A story author who believes the "no write-write conflict can occur" clause may reasonably skip `busy_timeout` (or SQLITE_BUSY handling) on the dashboard's write path — reintroducing the failure AD-3 is meant to prevent.

**Fix:** Keep the `busy_timeout`-on-every-connection rule; delete or correct the justification. State plainly: two processes write the one file, so file-level write contention is real and `busy_timeout` (both sides) is the guard — single-writer-per-domain prevents *data races on rows*, not lock contention on the file.

### F4 — Restart/crash recovery of in-flight (non-terminal) items is undefined `[MEDIUM]`
**Item 1. AD-5 state machine (interacts with F1 supervision).**

AD-5 defines non-terminal states (`received → validating → downloading → scanning → extracting`) but nothing says what happens to an item stuck in one when the worker restarts (crash mid-download, or supervisor bounce). Resume? Re-queue from `received`? Fail-closed to `quarantined`? Each is defensible and stories will pick differently — a real divergence point one level down, and one the fail-closed philosophy (AD-6) has an opinion about but doesn't state for the restart case.

**Fix:** Add a one-line reconciliation rule to AD-5 or AD-6: on startup the worker sweeps non-terminal items to a defined resolution (e.g., fail-closed → re-queue from a safe checkpoint, or → `rejected`/`quarantined`), consistent with AD-6. Ties directly to the supervision decision in F1.

### F5 — Several deps unpinned as "current"; migration runner left unnamed `[LOW]`
**Item 4.**

Tailwind CSS + shadcn/ui, `qrcode`, `clamscan`, and `file-type` are all listed as version "current"; Baileys carries an `[ASSUMPTION]`; the migration runner is explicitly deferred ("which migration runner… not fixed here"). Currency-of-versions is a separate reviewer's job — the concern here is vagueness. For a feature-altitude pilot this is tolerable, but four "current" entries plus an unnamed migration tool is thin: "current" is not a decision, and two stories could pull different majors.

**Fix:** Pin at least a major/minor for the four "current" deps (they need not be exact patch). The migration-runner deferral is acceptable since AD-4 makes the worker its sole user (no cross-unit divergence), but naming it would remove a build-time coin-flip.

### F6 — `auth_state` location is ambiguous between AD-9 and the ER diagram `[LOW]`
**Item 2 / 3. AD-9 vs. ER diagram.**

AD-9 requires Baileys auth state in "a dedicated store… neither secrets nor session bytes live in the shared SQLite tables the dashboard reads." The ER diagram, however, lists `auth_state` as a table alongside `contacts`/`events`/`files` in what reads as the one shared schema. Is auth_state a separate file, or a same-file table the dashboard simply never reads? Two units could implement it two ways. Low severity (single writer, dashboard has no reason to read it), but the artifacts disagree on their face.

**Fix:** State explicitly whether `auth_state` is a separate SQLite/store file or a same-file table excluded from the dashboard's read contract; make AD-9 and the ER diagram say the same thing.

---

## Checklist notes where no finding was needed

- **Item 5 (FR coverage):** All of FR-1..FR-18 land in the Capability map (verified each number 1–18 present). Strong.
- **Item 3 (Deferred):** Every Deferred item is either a config key with a single owner, a documented default (reputation-outage → fail-closed/hold), an ops procedure with no code, a Non-Goal, or a single-owner tool choice. None can let two units diverge. Strong. (Log retention is *missing entirely* rather than deferred — that's F1, not a Deferred defect.)
- **Item 1 (positive):** The closed status enum in `shared/`, the single guarded fetcher (AD-8), fail-closed default (AD-6), filesystem-layout-matches-status (AD-7), and closed link-pattern grammar (AD-12) are exactly the divergence points epics/stories would otherwise fight over. Genuinely good spine work.

## Severity roll-up
- Critical: 0
- High: 1 (F1)
- Medium: 3 (F2, F3, F4)
- Low: 2 (F5, F6)
