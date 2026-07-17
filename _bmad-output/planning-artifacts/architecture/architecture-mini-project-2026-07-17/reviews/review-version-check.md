# Stack Version-Check Review — WhatsApp Downloader

**Reviewed:** `ARCHITECTURE-SPINE.md` → Stack table + inline tech mentions
**Date:** 2026-07-17
**Method:** Live web search of each pinned technology against npm / official release channels as of mid-July 2026.

## Overall Verdict

**PASS with two fixes.** The stack is sound, current, and internally coherent for a local-only pilot. Every pinned line is real and the versions resolve to genuine, current releases. Two entries need correction:

1. **`qrcode` "current"** is misleading — the real package (`node-qrcode`) has been frozen at **1.5.4 for ~2 years**. It works, but "current" implies active maintenance it does not have. Not a blocker; pin it explicitly and note the staleness.
2. **`TypeScript 5.x`** is now one major behind — **6.0.3** shipped in 2026. 5.x (last line 5.9, Aug 2025) is still fully usable and safest for the pilot, but the pin should say "5.9 (6.0 available; deferring)" so it reads as a deliberate choice, not stale training data.

No misfits that break the architecture. The two-process / shared-SQLite design holds up against the real behavior of every dependency.

---

## Per-Technology Findings

### Node.js — pinned `24 LTS` → **OK**
- Node.js 24 released **2025-05-06**, promoted to **Active LTS in Oct 2025**, and is still in Active LTS as of July 2026 (maintenance phase begins ~Oct 2026, EOL Apr 2028). "24 LTS" is accurate and current.
- Note for the record: Node.js is changing its cadence (one major/year from Oct 2026; 26 is the last line under the old model). Doesn't affect a 24-LTS pilot.
- **Fit:** correct. Sole runtime for both worker and dashboard.

### TypeScript — pinned `5.x` → **STALE (soft)**
- Last traditional 5.x is **5.9** (Aug 2025). **TypeScript 6.0** is now GA (latest **6.0.3**), a transition release toward the Go-based 7.0 (expected late 2026).
- 5.x is not deprecated and remains the conservative choice; 6.0 is API-compatible with 5.9 but adds breaking changes/deprecations.
- **Action:** re-pin as "TypeScript 5.9 (6.0 GA — deferring to 5.9 for pilot stability)" so the choice is explicit.

### Baileys — pinned `6.7.x (stable; not 7.0.0-rc)` → **OK (assumption confirmed)**
- Confirmed: **7.0.0 is still a release candidate (7.0.0-rc13)** as of mid-2026 — not stable. The **6.7.x line is real and is the maintained legacy-stable line, latest 6.7.22.**
- The spine's `[ASSUMPTION]` that 6.x is a live stable line (not deprecated in favor of a shipped 7.x) **holds**. Choosing 6.7.x over an RC for a pilot is the correct call.
- **Package-name caveat:** the current npm package is unscoped **`baileys`** (7.0.0-rc line + 6.7.x legacy live here); the older **`@whiskeysockets/baileys`** scoped name is legacy. Make sure `package.json` targets `baileys@^6.7` (or a pinned `6.7.22`), not the deprecated scoped path.
- **Fit:** correct. Watch 7.0.0 stable for a post-pilot upgrade (breaking changes documented at whiskey.so/migrate-latest). AD-9's "not `useMultiFileAuthState`, dedicated worker-owned store" is compatible with both 6.7.x and 7.x.

### Next.js — pinned `16.2.x (LTS 16)` → **OK**
- Confirmed: **16.2.10 LTS** is the current supported release (**2026-07-01**); 16 is in **Active LTS**. "16.2.x (LTS 16)" is accurate. (16.3.0-preview exists but is pre-release.)
- Next.js 16 ships on **React 19.2**, stable Turbopack, Cache Components.
- **Fit:** correct for the read-mostly dashboard. See the better-sqlite3 note below for the one real integration caveat.

### better-sqlite3 — pinned `12.11.x` → **OK (and version choice matters)**
- Confirmed: **12.11.1** is the latest (~June 2026). Supports Node **20/22/23/24/25/26**.
- **Compatibility landmine — already dodged correctly:** prebuilt binaries for **Node 24 were added in v12.0.0**. Older lines (e.g. 11.10.0) have **no Node-24 prebuilt** and fall back to a `node-gyp` source compile. Pinning **12.11.x on Node 24 gives prebuilt binaries** — no native toolchain required. Good pin; do **not** downgrade below 12.0.0.
- **Synchronous-in-Next.js fit:** better-sqlite3 is synchronous by design. That is fine here because AD-1/AD-2 make the dashboard **read-mostly** and the worker the **sole writer of pipeline state**; the dashboard only writes `contacts`/`link_patterns`. Sync reads on Next.js server components / route handlers are acceptable at this scale, and WAL mode (AD-3) lets the dashboard read concurrently with the worker's writes without blocking. No misfit — but keep DB access on the server (never a bundled client/edge runtime), since a native addon cannot run in the Edge runtime. Worth an explicit note that dashboard DB code must run in the Node.js runtime, not Edge.
- Alternative worth a one-line mention: Node 24 ships a built-in `node:sqlite`, but staying on better-sqlite3 keeps worker and dashboard on one API — reasonable to keep.

### Tailwind CSS + shadcn/ui — pinned `current` → **OK**
- **Tailwind v4** is the current recommended line for new 2026 projects (CSS-first `@theme`, no `tailwind.config.js`, native engine). **shadcn/ui** is fully updated for **Tailwind v4 + React 19** and its CLI initializes Next.js 16 App Router / Server Component projects.
- **Fit:** confirmed compatible with the pinned Next.js 16 / React 19.2 stack. Suggest pinning "Tailwind v4.x + shadcn/ui (CLI-managed)" instead of the bare word "current".

### qrcode — pinned `current` → **STALE (misleading label)**
- The de-facto package (`qrcode` / `node-qrcode` by soldair) is at **1.5.4, last published ~2 years ago**. It is stable and widely used, but "current" overstates its activity — there is **no newer release**; 1.5.4 *is* the ceiling.
- **Action:** pin `qrcode@1.5.4` explicitly and drop the word "current". Functionally fine for the FR-14 re-pair QR image. (Confirm it renders under Node 24 — pure-JS, so no native-build risk; `@types/qrcode` needed for TS.)

### clamscan — pinned `current — ClamAV daemon is a system dependency` → **OK with a maintenance caveat**
- Confirmed: **clamscan 2.4.0** is the latest, ~193k downloads/week, scored "Popular". Supports `clamdscan`/`clamscan` binaries and TCP/Unix-socket to a `clamd` daemon — matches the stated "ClamAV daemon is a system dependency" role.
- **Caveat (flag, not block):** Snyk/registry signals show **no new npm release in ~12 months** and low recent GitHub activity — "could be considered low-attention." It is not deprecated or broken, and the API is stable, but treat it as a low-velocity dependency: pin `2.4.0`, add `@types/clamscan`, and keep the fail-closed adapter (AD-6) tolerant of the library going unmaintained.
- **Fit:** correct for the worker-side scanner adapter. The real security freshness dependency is the **ClamAV signature DB / daemon**, not this client — already acknowledged in the spine's "scanner-signature freshness" deferral.

### file-type — pinned `current (magic-byte classification, FR-18)` → **OK (compatibility footnote)**
- Confirmed: **file-type 22.0.1** (latest, ~April 2026), magic-number/binary-signature detection — exactly the FR-18 role. Correctly framed as a best-effort hint, not a guarantee (aligns with fail-closed AD-6; don't treat it as the sole scan authority).
- **Landmine:** file-type is **pure ESM** ("your project needs to be ESM too"). The **worker** must be ESM (or use dynamic `import()`) to consume it. This is compatible with Node 24 + TS 5.9/6.0, but the worker's module setup must be ESM — call this out so it isn't discovered late. Pin `file-type@22.x`.

### Inline (non-table) tech — VirusTotal + Telegram Bot API over plain `fetch` → **OK**
- Both explicitly "no client library, plain HTTPS `fetch`" — nothing to version-check; Node 24 global `fetch` covers it. Consistent with AD-8's single-guarded-fetcher discipline (though note: VT/Telegram calls are control-plane, not content fetches, so they legitimately sit outside the AD-8 content fetcher).

---

## Summary Table

| Technology | Pinned | Found (mid-2026) | Status |
| --- | --- | --- | --- |
| Node.js | 24 LTS | 24 Active LTS (rel. 2025-05-06, LTS Oct 2025) | OK |
| TypeScript | 5.x | 5.9 last 5.x; 6.0.3 GA | STALE (soft) — pin 5.9, note 6.0 |
| Baileys | 6.7.x stable (not 7.0-rc) | 6.7.22 legacy-stable; 7.0.0-rc13 (still RC) | OK — use `baileys` pkg, not scoped |
| Next.js | 16.2.x (LTS 16) | 16.2.10 LTS (2026-07-01) | OK |
| better-sqlite3 | 12.11.x | 12.11.1; Node-24 prebuilt since 12.0.0 | OK — do not go below 12.0.0 |
| Tailwind + shadcn/ui | current | Tailwind v4 + shadcn (React 19 / Next 16 ready) | OK — pin v4.x |
| qrcode | current | 1.5.4 (frozen ~2 yrs) | STALE label — pin 1.5.4 |
| clamscan | current | 2.4.0 (popular, low recent activity) | OK w/ maintenance caveat |
| file-type | current | 22.0.1 (pure ESM) | OK — worker must be ESM |

## Recommended Edits to the Stack Table

1. TypeScript → `5.9 (6.0 GA; deferring for pilot)`.
2. qrcode → `1.5.4 (pinned; upstream frozen)` — drop "current".
3. Baileys → add note: npm package is `baileys` (unscoped); target `^6.7` / `6.7.22`, not `@whiskeysockets/baileys`.
4. better-sqlite3 → add note: `>=12.0.0 required for Node 24 prebuilt binaries`.
5. file-type → add note: `pure ESM — worker must be ESM`.
6. clamscan → add note: `low upstream velocity; pin 2.4.0, keep adapter fail-closed`.
7. Add: dashboard DB access must run in Next.js **Node.js runtime**, not Edge (native addon).

## Sources
- Node.js releases — https://nodejs.org/en/about/previous-releases · https://endoflife.date/nodejs
- TypeScript — https://github.com/microsoft/typescript/releases · https://devblogs.microsoft.com/typescript/announcing-typescript-6-0/
- Baileys — https://www.npmjs.com/package/baileys · https://github.com/WhiskeySockets/Baileys/releases
- Next.js — https://endoflife.date/nextjs · https://nextjs.org/blog/next-16
- better-sqlite3 — https://www.npmjs.com/package/better-sqlite3 · https://github.com/WiseLibs/better-sqlite3/releases
- Tailwind / shadcn — https://ui.shadcn.com/docs/tailwind-v4 · https://ui.shadcn.com/docs/installation/next
- qrcode — https://www.npmjs.com/package/qrcode
- clamscan — https://www.npmjs.com/package/clamscan · https://security.snyk.io/package/npm/clamscan
- file-type — https://www.npmjs.com/package/file-type
