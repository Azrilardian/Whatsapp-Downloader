---
title: Adversarial Security Review — WhatsApp Downloader PRD
status: draft
created: 2026-07-17
reviewer: adversarial security review
scope: prd.md + addendum.md
---

# Adversarial Security Review — WhatsApp Downloader PRD

**Verdict:** REJECT as written. This is a product whose entire reason to exist is "handle malicious files safely," yet the FRs describe the happy path and hand-wave the adversary. The threat model is a rounding error. An attacker who controls the *content behind a whitelisted link* — which is the explicit design assumption (a trusted contact "unknowingly forwards a bad file") — is given a shockingly large attack surface: the fetcher will talk to internal network addresses, the size gate is racy and spoofable, "decompression bomb" defense is scoped to a single archive layer, and "passed the scan" is treated as "safe" when ClamAV is a weak, bypassable, signature engine. The safety guarantees (SM-2, "zero unsafe files in final store") are asserted, not engineered, and are not testable as written.

Counts: **Critical 7 · High 9 · Medium 8 · Low 4** (28 findings).

---

## 1. Security / Safety Holes (the whole point)

### C-1 (Critical) — SSRF: the fetcher will HEAD/GET attacker-controlled URLs with no address restriction
**Location:** FR-3 (Pre-fetch validation), Addendum §C step 6 (HEAD request), FR-2.
**Scenario:** A whitelisted *domain* pattern is not the same as a whitelisted *destination*. `link_patterns` matches on "domain and/or extension." If the pattern is extension-only (`*.zip`), ANY host is allowed. Even if domain-scoped, a whitelisted domain can `302` to `http://169.254.169.254/latest/meta-data/` (cloud metadata), `http://127.0.0.1:port`, or `http://192.168.x.x/router-admin`. The worker runs locally on the operator's machine/network — internal services (SQLite-adjacent tooling, router, other LAN hosts) are directly reachable. FR-3 only checks "downloadable content-type + size," never *where* the URL points.
**Fix:** Resolve DNS and reject any URL/redirect target resolving to private, loopback, link-local, CGNAT, or reserved ranges (RFC1918, 127/8, 169.254/16, ::1, fc00::/7, IPv4-mapped). Enforce on the *final* resolved IP after every redirect hop, and pin that IP for the actual GET (defeat DNS rebinding). Disallow non-http(s) schemes, non-standard ports, and userinfo (`user@host`) in URLs. Add this as an explicit FR with testable consequences.

### C-2 (Critical) — TOCTOU between the HEAD size-check and the GET body download
**Location:** FR-3 → FR-5, Addendum §C steps 6→7.
**Scenario:** The size gate is a HEAD request; the download is a separate GET. An attacker's server returns `Content-Length: 1000` on HEAD, then streams 50 GB on GET (or omits Content-Length entirely / uses chunked transfer, where HEAD gives no size at all). "Rejected before any file body is fetched" is defeated because the body fetch is a different request the attacker answers differently. Result: disk-fill DoS, or a bomb that never hit the size gate.
**Fix:** Do not trust HEAD. Enforce a hard byte cap *during* the streaming GET — abort the connection the moment bytes exceed the cap. Treat missing/chunked Content-Length as "unknown" and still cap by streamed bytes. The size guarantee must be a streaming counter, not a HEAD header. Make FR-3's consequence read against actual bytes read, not the advertised header.

### C-3 (Critical) — "Decompression bomb" defense is single-layer; nested archives and gzip bypass FR-7
**Location:** FR-7, Addendum §D.
**Scenario:** FR-7/§D cap "total uncompressed size" and "file count" of *the* archive. Two bypasses: (a) **Nested archives** — a 1 MB zip containing a 1 MB zip containing … expands within caps at each layer but detonates if anything recurses; if you *don't* recurse, a malicious inner archive lands in the final store unscanned/unexpanded (see C-6). (b) **Non-zip formats** — gzip, bzip2, xz, tar, 7z, rar, nested tar.gz. A 10:1 or 1000:1 gzip stream is not a "zip" and §D never names it. ClamAV may pass the compressed bytes; extraction detonates. The word "archive" is undefined and the guards assume zip semantics only.
**Fix:** Enumerate exactly which archive formats are supported and reject all others. Enforce the uncompressed-size cap as a *streaming* counter during decompression (abort mid-stream), not a post-hoc total. Bound nesting depth (e.g. depth ≤ 1, or scan-then-refuse-to-recurse) and count nested-archive uncompressed bytes against the global cap. Cap the compression *ratio* per entry.

### C-4 (Critical) — Symlink / hardlink entries in archives escape the extraction sandbox; zip-slip check is insufficient
**Location:** FR-7 ("no file written outside the extraction target"), Addendum §D.
**Scenario:** The guard only mentions "entries resolving outside the target dir (path traversal / zip-slip)." tar (and some zip tooling) supports **symlink and hardlink** entries. Attacker ships a symlink entry `link -> /Users/op/.ssh/authorized_keys` followed by a regular entry `link/…` — the *path* stays inside the target dir, so a naive zip-slip string check passes, but writes follow the symlink out. Hardlinks to files outside the target similarly escape. Also unaddressed: absolute paths on extraction, device/FIFO entries, and Windows `..\` / drive-letter / UNC paths.
**Fix:** Refuse symlink, hardlink, device, and FIFO entries outright (regular files + dirs only). Never follow symlinks during extraction; resolve each entry's real path with the target as a locked root (`openat`/`O_NOFOLLOW` semantics) and re-verify containment *after* canonicalization, not by string prefix. Reject absolute and drive-qualified paths.

### C-5 (Critical) — "Passed ClamAV" is treated as "safe"; ClamAV is a weak, bypassable, staleness-prone gate and there is no freshness/liveness requirement
**Location:** FR-6 (Mandatory scan gate), SM-2, Addendum §A.
**Scenario:** ClamAV catches known-signature commodity malware and little else. Targeted/novel/packed/encrypted payloads sail through. Worse: (a) no requirement that `freshclam` signatures are current — a months-stale DB silently degrades to near-zero detection while every consequence still reports "scanned: passed"; (b) no requirement that the daemon is actually *up* (see H-2); (c) an **encrypted zip** cannot be scanned at all — ClamAV can't read the contents — yet FR-7 would happily extract it after a "pass." The product's headline guarantee (SM-2: "zero unsafe files") rests on an engine that structurally cannot deliver it.
**Fix:** Reframe SM-2 honestly: "no file reaches the final store *without being scanned*" — never "no unsafe file." Require signature-freshness check (fail-closed if DB older than N hours). Treat encrypted/unscannable archives as scan-failures → quarantine, not passes. State ClamAV's detection limits as an accepted residual risk in §8, and treat the final store itself as still-untrusted (do not auto-execute anything).

### C-6 (Critical) — Content-type / extension spoofing: gates trust advertised type and URL extension, never real bytes
**Location:** FR-2 (extension match), FR-3 ("acceptable type"), FR-7 (deciding "an archive").
**Scenario:** The link gate matches the *URL's* extension (`*.zip`) and FR-3 matches the server's *advertised* Content-Type. Both are attacker-controlled strings. `evil.zip` can serve `Content-Type: application/zip` while the bytes are a Windows PE, a HTML file with a polyglot payload, or an ISO. Conversely `report.pdf` can be a zip. FR-7 decides "is this an archive" — on what? If on extension/MIME, a renamed archive skips extraction guards; if on magic bytes, it may extract something the gates never anticipated. Nothing reconciles claimed type vs. real type.
**Fix:** Determine file type from *magic bytes* after download, and make the acceptance decision on the sniffed type. Reject when sniffed type contradicts the allowed set regardless of extension/MIME. Choose the extraction path from sniffed type, not the filename. Define the allowlist of acceptable real types explicitly.

### C-7 (Critical) — No sender-authenticity requirement: "sender matches whitelist" is spoofable/ambiguous and the JID basis is undefined
**Location:** FR-1, Addendum §A (`contacts` table: JID).
**Scenario:** The gate is "sender matches an active entry." But WhatsApp identifiers are not simple: a contact's phone number vs. LID (privacy identifier), group participants, forwarded messages, "broadcast" senders, and number recycling (a banned/relinquished number reassigned to a stranger) all muddy "who sent this." If the whitelist keys on a display name or an easily-confused identifier, an attacker in a shared group or a recycled number passes gate 1. The PRD never pins *what* identity is authoritative.
**Fix:** Specify the exact authoritative sender key (canonical JID / verified phone identity), define behavior for group messages and forwards (recommend: reject group/forwarded unless explicitly configured), and add a testable consequence for number-recycling and LID/phone mapping.

---

## 2. Filesystem / Store Safety

### H-1 (High) — Staging, quarantine, and final-store permissions are unspecified; world-readable/executable landing is not prevented
**Location:** FR-5, FR-8, Glossary (Staging/Quarantine/Final store), Addendum §C.
**Scenario:** Nothing states the on-disk permissions or ownership of these folders. If staging is `0755`/world-readable (or on a shared/synced folder — iCloud/Dropbox), untrusted and possibly malicious bytes are exposed to every local user and auto-synced off-box. Downloaded files may retain executable bits (or archive entries carry mode `0777`), so a malicious binary lands executable in the final store. Quarantine is described as "isolated" but "isolated" is never defined — same filesystem, same user, one `mv` from the final store.
**Fix:** Specify: staging/quarantine `0700`, owned by the worker user, on a local non-synced volume; strip all execute bits on write; store quarantined files with a neutralized extension (e.g. append `.quarantine`) and never preserve archive-entry modes. Make "isolated" concrete and add a testable permission assertion.

### H-2 (High) — Filename sanitization is absent everywhere a filename is derived from attacker input
**Location:** FR-5 (download filename), FR-7 (extracted entry names), FR-9 (Telegram summary of "contained filenames").
**Scenario:** The download filename can come from the URL path or `Content-Disposition` (attacker-controlled). Extracted entry names come from inside the archive. Neither is sanitized in the FRs. Consequences: path traversal via filename (overlaps C-4), overwrite of pipeline files, control characters / newlines / RTL-override (`U+202E`) to disguise `exe` as `pdf`, absurdly long names, reserved names (`CON`, `NUL`), and — for FR-9 — the "summary list of contained filenames" is injected verbatim into a Telegram message (see M-3).
**Fix:** Generate the stored filename from a system-controlled UUID/hash; keep the original name only as sanitized metadata (strip path separators, control chars, bidi overrides; length-cap; NFC-normalize). Never let attacker-supplied names determine write paths.

### H-3 (High) — Dedup by hash can be poisoned; dedup by URL can be evaded — and dedup can suppress a *fresh scan*
**Location:** FR-4, Open Question #4.
**Scenario:** "Does not re-download content it has already successfully acquired." (a) URL-based dedup: attacker appends `?x=1` to re-trigger, or a stable URL now serves *different* bytes (the safe file you cached is not the malware served today). (b) Hash-based dedup: an attacker who once got a clean file cached can later serve malware at the same URL and — if dedup short-circuits before scan — skip scanning. Critically, "already acquired" must not mean "skip the scan": a cache hit must never move bytes to the final store without a current scan verdict.
**Fix:** Dedup only *after* a fresh scan verdict, or re-scan on every acquisition; never let a dedup hit substitute for a scan or promote to final store. Pin dedup to content hash of freshly downloaded bytes, not URL. State that identical URL ≠ identical content.

---

## 3. Testability Gaps (Consequences that aren't verifiable as written)

### H-4 (High) — FR-5 "At no point between download and a passing Scan does the file exist in the Final store" is not observably testable
**Location:** FR-5 Consequences.
**Scenario:** "At no point" is a temporal universal over an interval you cannot sample exhaustively. A polling test can miss a millisecond-long window (e.g., a download that writes to final then moves to staging, or a crash mid-move). The consequence asserts an invariant with no stated mechanism (atomic move? write-to-staging-only-by-construction?) that would make it true by design rather than by observation.
**Fix:** Restate as a structural invariant: "the final-store path is only ever written by the post-scan move step; download writes exclusively to staging." Verify by code path + a crash-injection test, and by fs auditing, not by sampling.

### M-1 (Medium) — FR-3 "acceptable type" and "downloadable content" are undefined terms
**Location:** FR-3.
**Scenario:** A test cannot pass/fail "acceptable type" without an enumerated allowlist. "Downloadable content" excludes what — `text/html`? A login page returning `200 text/html` is "downloadable." The consequence is untestable until the set is named (ties to Open Question #3 which only covers sizes, not types).
**Fix:** Enumerate acceptable real (sniffed) types; define handling for `text/html` and redirects-to-HTML explicitly.

### M-2 (Medium) — FR-6 reputation-flag semantics are an open `[ASSUMPTION]`, so the consequence is contradictory
**Location:** FR-6 Consequence 2, §8 Q2, §9.
**Scenario:** The consequence states "reputation flag ⇒ treated as failed," but the inline `[ASSUMPTION]` and Open Question #2 say it might be warn-only. A tester cannot know the expected outcome. Additionally VT hash-lookup returns "unknown" for any file VT has never seen (i.e. every targeted/novel payload) — "not flagged" is silently treated as "clean," which the consequence doesn't address.
**Fix:** Resolve Q2 before build. Define the three VT states explicitly: malicious→fail, unknown→(does not upgrade trust), clean→(second signal only). Never let VT "unknown" read as "safe."

### M-3 (Medium) — FR-9 archive "summary list of contained filenames" is an injection/abuse vector and has no bound
**Location:** FR-9 Consequence 3.
**Scenario:** Filenames come from inside an untrusted archive. Rendered into a Telegram message they can carry HTML/Markdown (if `parse_mode` set), spoofed content, bidi overrides, or thousands of entries that blow the 4096-char Telegram limit and cause the send to fail (which then trips FR-10's "never silent" — cascading). No cap on how many names are listed.
**Fix:** Escape/neutralize filenames before sending, cap the list length ("… and N more"), send with `parse_mode` disabled.

### M-4 (Medium) — SM-2 "zero unsafe files in the final store" is unfalsifiable by the team that owns "unsafe"
**Location:** SM-2, FR-6.
**Scenario:** "Unsafe" is defined operationally as "didn't pass ClamAV." So SM-2 can report 0 violations while malware ClamAV missed sits in the final store. The metric measures process compliance, not the safety property it claims. It is *true by definition* and therefore worthless as a safety signal (see C-5).
**Fix:** Rename to "0 files reached final store without a completed scan" and separately track/accept detection-miss risk as residual.

---

## 4. Ambiguities / Contradictions between prd.md and addendum.md

### H-5 (High) — PRD FR-6 vs Addendum §C step 9: when does the archive get scanned relative to being moved to final?
**Location:** prd FR-6/FR-7 vs Addendum §C steps 9–10.
**Scenario:** §C step 9 reads "Pass → move to **final** folder …; if archive, extract **after** pass." This says the archive is moved to final, *then* extracted. But the extracted *contents* are never scanned again — only the archive container was scanned. So malware inside a zip that ClamAV didn't unpack (encrypted, nested, or format ClamAV doesn't recurse) is now extracted *into or beside the final store*. The PRD says extraction goes to "an isolated location" (FR-7) while the addendum says the archive is already in final. These conflict on where extracted bytes live and whether contents get their own scan.
**Fix:** Order must be: scan archive → if pass, extract to isolated staging → scan every extracted file individually → only then promote clean files to final. Make PRD and addendum agree on this ordering and on per-file re-scan.

### M-5 (Medium) — "Isolated"/"quarantine"/"staging" are three separate untrusted areas but their relationship is unspecified across both docs
**Location:** Glossary, FR-7, FR-8, Addendum §C/§D.
**Scenario:** Staging (pre-scan), the FR-7 "isolated extraction location," and quarantine are all named but their mutual isolation, cleanup, and retention are undefined. Does staging get purged on failure? Do quarantined bombs get deleted or retained forever (disk growth, re-infection risk)? Nothing says.
**Fix:** Define lifecycle: staging purged after verdict; extraction sandbox purged after promotion; quarantine retention policy + size cap + operator purge control.

### M-6 (Medium) — Addendum §A/§B: SQLite "shared between worker and UI" with no concurrency contract vs FR-11/FR-13 live semantics
**Location:** Addendum §A, §B, §C step 11 vs FR-11, FR-13.
**Scenario:** Two processes on one SQLite file. The worker writes events and reads whitelists "live on every message"; the UI writes whitelist edits and reads everything. SQLite's default locking will throw `SQLITE_BUSY` under concurrent write, and "live on every incoming message" queries can collide with dashboard writes. Neither doc specifies WAL mode, busy-timeout, or what happens to a message that arrives during a locked DB. See H-6.
**Fix:** Mandate WAL + busy_timeout, single-writer discipline, and a defined behavior when the DB is momentarily locked (retry, not drop).

---

## 5. Missing Failure Modes

### H-6 (High) — SQLite locked between worker and UI: no defined behavior; risk is a *dropped message* = silent miss
**Location:** FR-1/FR-11/FR-13, Addendum §B.
**Scenario:** A message arrives while the UI holds a write lock (operator editing whitelist). If the worker's "live whitelist query" or its event-write fails with `SQLITE_BUSY` and the code doesn't retry, the message is either mis-gated or never recorded — a silent failure, violating the spirit of FR-10 ("never silent") for the ingestion stage.
**Fix:** WAL + busy_timeout + bounded retry; on persistent lock, queue the message and alert, never drop.

### H-7 (High) — ClamAV daemon down / VirusTotal unreachable: fail-open vs fail-closed is never stated
**Location:** FR-6, Addendum §A/§C step 8.
**Scenario:** If `clamd` is down, does the pipeline (a) block and quarantine (fail-closed) or (b) skip the scan and proceed (fail-open)? The FR says the scan is "mandatory" but never says what happens when the mandatory engine is unavailable — the most dangerous ambiguity in the doc. A naive implementation logs an error and moves on, promoting unscanned files to final. VT rate-limit (free tier: ~4 req/min) / outage similarly undefined — does it block the pipeline?
**Fix:** Explicit **fail-closed**: scan-engine unavailable ⇒ file stays in staging or goes to quarantine, with an alert. Never promote on scanner error. VT is optional/best-effort and must never block; its unavailability must never upgrade trust.

### M-7 (Medium) — Partial / interrupted download is not handled
**Location:** FR-5, Addendum §C step 7.
**Scenario:** Connection drops mid-download. Does the truncated file get scanned and possibly promoted? A truncated archive can still contain a valid malicious member; a truncated file hashed for dedup poisons the dedup cache with a hash that never recurs.
**Fix:** Download to a temp name, verify completion (expected length if known, or clean EOF), fsync+atomic-rename into staging only on success; discard partials; never hash/scan/dedup a partial.

### M-8 (Medium) — Disk full during download or extraction
**Location:** FR-5, FR-7.
**Scenario:** A near-cap download (or an extraction approaching the uncompressed cap) fills the disk. SQLite writes then fail (compounding H-6), the event log can't record, Telegram alert may not fire → the pipeline fails *silently*, violating FR-10. Also a cheap DoS: attacker sends many just-under-cap files.
**Fix:** Pre-flight free-space check ≥ cap; reserve headroom; on ENOSPC, abort cleanly, purge partial, and ensure the alert path itself doesn't depend on the full disk.

### M-8b (Medium) — Telegram send failure has no fallback and can recurse with FR-10
**Location:** FR-9, FR-10.
**Scenario:** Telegram API is down / token invalid / chat_id wrong / message too long (M-3). FR-10 says failures "always produce a Delivery notification" — but the delivery channel *is* Telegram. If the notification itself fails, the guarantee is circular and the operator learns nothing. No retry/queue/dead-letter is specified.
**Fix:** Persist an "undelivered notification" state visible in the dashboard, retry with backoff, and treat the dashboard as the authoritative failure surface (not Telegram) so the "never silent" guarantee doesn't depend solely on the channel that failed.

### L-1 (Low) — FR-14 QR image in dashboard: QR is a live credential; no expiry/access note
**Location:** FR-14, Addendum §E.
**Scenario:** The re-pair QR is effectively a login credential for the WhatsApp session. Dashboard has no auth (by design, §5) but if it's ever reachable beyond localhost the QR is a session-hijack. Also QR codes expire quickly; a stale rendered QR wastes operator effort.
**Fix:** Bind dashboard to localhost only (explicit FR), note QR sensitivity, auto-refresh/expire the rendered QR.

---

## 6. Scope / Whitelist Bypass

### C-1b (Critical, cross-ref C-1) — Redirect chains from a whitelisted domain to an arbitrary host defeat the link gate entirely
**Location:** FR-2, FR-3, Addendum §C steps 4→6.
**Scenario:** The gate matches the *submitted URL* against `link_patterns`. A whitelisted `https://builds.trusted.com/x` returns `302 → https://evil.attacker.com/payload.exe` (or → an internal IP, see C-1). The gate already passed on the original URL; the fetch follows the redirect to anywhere. The whitelist — described as "the product, not a setting" — is bypassed by one redirect.
**Fix:** Re-apply BOTH gates (domain pattern + IP-range check + type/size) to every redirect hop's target. Reject cross-domain redirects unless the target *also* matches an active pattern. Cap redirect count. Prefer disabling automatic redirect-following and validating each hop explicitly.

### H-8 (High) — URL shorteners and open redirects trivially launder an arbitrary destination through a whitelisted pattern
**Location:** FR-2, Link-pattern Glossary.
**Scenario:** If a shortener domain (`bit.ly`, `t.co`) or any site with an open-redirect endpoint is whitelisted, the *pattern* matches while the real destination is arbitrary. Extension-only patterns (`*.zip`) make the destination host irrelevant from the start.
**Fix:** Warn against extension-only and shortener patterns; resolve shorteners and re-gate the final destination (this is just C-1b's redirect handling). Consider a policy that patterns must be domain-scoped, not extension-only.

### H-9 (High) — Link-pattern matching weakness: "domain and/or extension" invites substring/suffix bugs
**Location:** FR-2, FR-12, Addendum §A (`link_patterns.pattern`, `type`).
**Scenario:** Pattern semantics are unspecified. Naive matching yields classic bypasses: `trusted.com` matches `trusted.com.evil.com` (suffix), `evil-trusted.com`, `trusted.com@evil.com` (userinfo), `trusted.com.` (trailing dot), IDN/punycode homographs, uppercase, or `evil.com/trusted.com` (path contains the pattern). Extension matching on the URL string matches `?x=.zip` or `#.zip`. The operator authoring patterns has no defined grammar, so safe-looking patterns are exploitable.
**Fix:** Define exact matching semantics: host must equal or be a dot-delimited subdomain of the pattern (parsed host, not substring); extension checked against the parsed path's final segment only; normalize case and punycode; reject userinfo. Provide a tested matcher, not operator-freeform regex.

### M-9 (Medium) — Multiple-URL fan-out (FR-2) multiplies every attack and enables amplification
**Location:** FR-2 Consequence 2.
**Scenario:** "A message containing multiple URLs advances each matching URL independently." One message with 500 matching URLs = 500 concurrent downloads/scans → resource exhaustion, ClamAV queue saturation, disk fill, Telegram flood. No per-message or global rate/concurrency limit anywhere.
**Fix:** Cap URLs processed per message, cap global concurrent downloads/scans, and rate-limit deliveries.

### L-2 (Low) — No cap on message/ingestion rate from a whitelisted (but compromised) contact
**Location:** FR-1, FR-9/FR-10.
**Scenario:** A whitelisted contact whose device is compromised becomes a firehose; the pipeline and Telegram notifications amplify it. Whitelisting the sender is not the same as trusting unlimited volume.
**Fix:** Per-contact rate limit + a global kill switch in the dashboard.

### L-3 (Low) — Deactivation race: an in-flight message may be processed against stale whitelist state
**Location:** FR-11, FR-1.
**Scenario:** "Takes effect on the next incoming message" — but a message already mid-pipeline when the operator deactivates a contact/pattern still completes. For a *revoke-because-malicious* action this is exactly the moment you want it stopped.
**Fix:** Define whether the gate is re-checked at later pipeline stages; provide an emergency "abort in-flight" control.

### L-4 (Low) — Number recycling / ban indistinguishability is carried as risk but has no operator-facing detection
**Location:** FR-15 Notes, Addendum §F, §8 Q6.
**Scenario:** Correctly flagged as not code-solvable — but there's no dashboard signal or heartbeat that would let the operator *notice* a silently-dead/banned session before messages pile up unprocessed.
**Fix:** Add a liveness/last-message-seen indicator and a "no activity in N hours" alert so a silent death is at least visible.

---

## 7. Summary of Fix Priorities (build blockers)

Before any code: resolve **C-1 (SSRF/IP-range gating), C-2 (streaming size cap), C-3 (multi-format + nested decompression bomb), C-4 (symlink/hardlink extraction escape), C-6 (magic-byte type sniffing), C-1b/C-7 (redirect + sender-identity gating), and H-7 (fail-closed on scanner-down)**. These are the load-bearing safety properties; every one of them is currently either absent or asserted without a mechanism. Then make SM-2 and the "at no point" invariants (H-4, M-4) *structural* rather than *observational*, and close the "never silent" circularity (M-8b, H-6, M-8) where the failure channel depends on the very resource that failed.

The recurring anti-pattern across this PRD: **it trusts attacker-controlled inputs** — advertised Content-Length, advertised Content-Type, URL extension, archive entry names, redirect targets, "already scanned once" — **at exactly the points where the threat model says the attacker controls them.** Every FR that says "the system verifies X" must specify *from what source* X is read, because for this product the answer is almost always "a source the adversary controls."
