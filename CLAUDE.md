# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Rules

- Before committing, run `/ponytail-review` on the diff and address what it finds.

## What this is

WhatsApp Downloader: a local pilot that watches whitelisted WhatsApp contacts for whitelisted download links, fetches them through a guarded pipeline (dedup → validate → download → ClamAV scan → extract → store), and delivers/notifies via a Telegram bot. A Next.js dashboard manages whitelists and shows pipeline/event history. Full design rationale lives in `_bmad-output/planning-artifacts/architecture/architecture-mini-project-2026-07-17/ARCHITECTURE-SPINE.md` (the "AD-N" invariants referenced throughout the code) and `brief.md`.

## Commands

npm workspaces (`shared`, `worker`, `dashboard`), Node >=24, ESM throughout.

```bash
npm run worker          # start the always-on worker (Baileys session + pipeline)
npm run worker:once     # boot worker (migrations + startup reconciliation), then exit — no WhatsApp socket
npm run dashboard       # next dev, dashboard on 127.0.0.1
npm run typecheck       # tsc --noEmit across all workspaces
npm run supervise       # pm2 start ecosystem.config.cjs (production supervisor)
npm run supervise:stop
npm run supervise:logs
```

There is no test framework. Each pipeline component has a standalone self-check script under `worker/src/check-*.ts` (assert-based, no fixtures/runner) — run individually with `npx tsx src/check-<name>.ts` from `worker/`. When touching pipeline logic, find and run the matching check script; when adding non-trivial logic, add one (see existing `check-*.ts` files for the pattern: build a temp SQLite db via `openDb`/`runMigrations`, exercise the function, `assert.equal`, `console.log('check-x: ok')`).

Secrets and data-dir overrides go in a gitignored `.env` at repo root (see `.env.example`): `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `VIRUSTOTAL_API_KEY`, optional `WADL_DATA_DIR`/`WADL_DB_PATH` overrides. `worker/src/paths.ts` loads it before anything else reads those env vars — order matters if you touch startup code.

## Architecture

Two independent OS processes integrating **only** through a shared SQLite file (`data/app.db`, WAL mode) — never HTTP/IPC between them:

- **`worker/`** — always-on Node process. Owns the Baileys WhatsApp session, runs the pipeline, is the sole writer of `items`/`events`, and the sole schema owner (runs migrations from `shared/migrations/` at startup).
- **`dashboard/`** — Next.js app. Read-only over pipeline state; the *only* tables it writes are `contacts` and `link_patterns` (operator whitelists). Never touches schema, secrets, or the Baileys auth store.
- **`shared/`** — the seam: SQL migrations, the `ItemStatus` enum (`shared/src/status.ts`), and TypeScript row types (`shared/src/types.ts`) both processes import. Update the enum/types here first when changing the data contract, then migrate.

### Pipeline state machine (`shared/src/status.ts`)

`received → validating → downloading → scanning → extracting` (non-terminal, one-directional) ending in one terminal state: `ignored | duplicate | rejected | failed | quarantined | stored`. Any exception/timeout/uncertain outcome moves an item **away** from `stored`, never toward it (fail-closed default). A file's directory (`data/{staging,final,quarantine,extract}`) must always match its DB `status`; moves are atomic renames done *before* the status commit, and `worker/src/reconcile.ts` repairs any crash-time mismatch at startup (rebuilds the in-memory queue from `items` rows, never trusts in-flight state).

### Key worker modules

- `index.ts` — startup sequence: load `.env` → ensure data dirs → run migrations → log `worker_started` event → startup reconciliation (`reconcile.ts`) → (unless `--once`) schedule backups (`backup.ts`) → start Baileys session (`session.ts`).
- `gates.ts` / `check-gates.ts` — sender whitelist gate; re-reads `contacts` live on every message (no startup caching), so dashboard whitelist edits take effect without a worker restart.
- `check-link-gate.ts` — link-pattern gate; shares one matcher module (`shared/src/link-matcher.ts`) with the guarded fetcher's per-redirect re-check — never reimplement pattern matching in a second place.
- `guarded-fetch.ts` — the single fetch component for all outbound content: resolves-and-pins target IPs, blocks private/reserved ranges, re-applies the link-pattern gate on every redirect hop, enforces the size cap as a streaming abort. No other code path should issue a raw fetch for link content.
- `check-dedup.ts` — dedup uses two keys on the `items` row: pre-download `url_hash` (skip re-fetching) and post-download `content_sha256` (catch identical bytes from different URLs).
- `auth-store.ts` — Baileys auth state, worker-owned, deliberately not `useMultiFileAuthState` (upstream docs call it IO-heavy/reference-only). Session bytes and secrets never enter the shared DB.
- `session.ts` / `check-reconnect-policy.ts` — `DisconnectReason` handling: `loggedOut` stops and surfaces a fresh QR + Telegram alert; `badSession` clears auth state and restarts pairing; `restartRequired` reconnects silently; everything else backs off and retries with a cap.
- `backup.ts` / `check-backup.ts` — scheduled DB + `final/` backups and `events` retention pruning, driven by the `settings` table (read live, not env-only).
- `items.ts` — shared item CRUD/status-transition helpers used across pipeline stages.

### Data contract (`shared/migrations/001_init.sql`)

`items` (one row per candidate, single status holder), `events` (append-only audit log, FK `item_id`, never updated), `contacts`/`link_patterns` (dashboard-writable whitelists), `settings` (dashboard-writable policy/config values — caps, thresholds, `max_concurrent`, retention days, etc. — worker reads these live, never hardcodes them).

### Conventions

- DB columns `snake_case`; TypeScript `camelCase`. Timestamps are ISO-8601 UTC everywhere.
- Every pipeline outcome (advance/drop/fail) gets one `events` row — the event log is the audit trail, not stdout.
- Config values (size caps, redirect limits, concurrency, retention) belong in the `settings` table, not hardcoded constants.
- `.zip` extraction only happens after a passing scan, into an isolated `extract/` root, with caps on uncompressed size/file count/nesting and zip-slip path checks.

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).
