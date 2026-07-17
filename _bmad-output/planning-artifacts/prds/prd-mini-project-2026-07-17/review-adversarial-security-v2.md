---
title: Adversarial Security Review v2 (Re-Review) — WhatsApp Downloader PRD
status: draft
created: 2026-07-17
reviewer: adversarial security review (re-review after hardening)
scope: prd.md + addendum.md (post-FR-16/17/18 hardening)
---

# Adversarial Security Re-Review — WhatsApp Downloader PRD

**Verdict: NOT yet ship-ready for architecture — but close.** The hardening is real, not cosmetic. Four of the five headline criticals are genuinely closed at the requirements level with testable consequences (SSRF, size-TOCTOU, redirect bypass, decompression-bomb + symlink). The fifth (scanner trust) is *mostly* closed but leaks on the encrypted/unscannable-archive case. What blocks "ship" is a small, specific set of survivors and freshly-sharpened contradictions: (1) extracted archive **contents are still never individually re-scanned**, and the addendum still says the archive is moved to *final* before extraction — a direct contradiction with FR-7's "isolated target"; (2) the DNS-rebinding defense **dropped the IP-pin** that the prior fix called for, leaving a resolve-then-connect window across the still-present HEAD→GET split; (3) encrypted/unscannable archives are not defined as scan-failures; (4) the C-7 sender-identity critical was never touched. None of these needs a redesign — they need four more sentences with testable consequences.

Do not read the effort as done work. "We added an FR that says the right words" is not the same as "the consequence is falsifiable and the addendum agrees with it."

---

## Part 1 — Status of the 5 headline criticals

### (1) SSRF via attacker URLs/redirects to internal IPs — **CLOSED (residual: DNS-rebind pin, see N-2)**
- **Closes it:** FR-16 C2 — *"A request that resolves to a private / loopback / link-local / cloud-metadata address (e.g. `127.0.0.0/8`, `10/8`, `172.16/12`, `192.168/16`, `169.254/16`, `::1`) is refused — whether via the submitted URL or any redirect (defends SSRF)."* Addendum D2 adds *"enforce at connect time against the resolved IP, so DNS-rebinding can't slip through a name check."*
- Core SSRF is closed with a testable consequence. **Residual:** the fix says *check the resolved IP at connect time* but does **not** require **pinning** that IP for the actual transfer. With a HEAD→GET split (still present, see N-3) or any re-resolution, the checked IP and the connected IP can differ. Downgraded from Critical to a remaining High (N-2), not a re-open.

### (2) TOCTOU between HEAD size-check and GET body — **CLOSED**
- **Closes it:** FR-3 C2 — *"The maximum size is enforced by a **streaming byte cap during download** (HEAD / `Content-Length` is advisory only); a response that exceeds the cap mid-transfer is aborted and the partial file discarded — the system never trusts an advertised size (defends the HEAD/GET TOCTOU)."* Addendum D2 mirrors it.
- Testable against actual bytes read, not the header. Good. (Caveat: addendum §C step 6 still describes a HEAD "size ≤ max" check — a stale wording contradiction, see N-3.)

### (3) Redirect bypass of the whitelist gates — **CLOSED**
- **Closes it:** FR-16 C1 — *"A whitelisted URL that redirects (any 3xx) to a host or IP not matching an active Link-pattern is rejected **at the redirect**, not followed to completion — one 302 can no longer defeat the whitelist."* Plus FR-16 C3 (bounded hop count). Addendum D2 re-applies the link-pattern gate to every hop.
- Closed. Minor wording nit: FR-16 says re-check "both gates" per hop; the sender gate is meaningless on a redirect target (no sender). Addendum D2 correctly narrows it to link-pattern + IP. Harmless but see N-5.

### (4) Multi-layer/multi-format decompression bombs + symlink archive entries — **CLOSED**
- **Closes it (bombs):** FR-7 C1 — *"Extraction bounds apply **recursively and across formats** (zip, gzip, tar, bzip2, xz, 7z, and nested archives): total uncompressed size, cumulative file count, and **nesting depth** are each capped; exceeding any cap aborts extraction and quarantines the archive."*
- **Closes it (symlink):** FR-7 C2 — *"Any entry that is a symlink or hardlink, or that resolves outside the target directory, is rejected via a **canonical-path check (not a substring match)**."*
- Both closed with testable consequences. The formats are enumerated and the canonical-path requirement is explicit. Note the *bomb* defense is closed; the separate "extracted contents never re-scanned" hole (N-1) is adjacent, not a re-open of #4.

### (5) ClamAV not fail-closed / no signature freshness / SM-2 unfalsifiable — **PARTIAL**
- **Fail-closed + freshness — CLOSED:** FR-6 C2 — *"The Scan runs **fail-closed**: if the scanner is unavailable, unresponsive, or its signature database is older than a configured freshness threshold, the file is treated as failed (quarantined) — 'unable to scan' is never treated as 'clean.'"* Addendum D3 mirrors it.
- **SM-2 falsifiability — CLOSED:** SM-2 now uses *"a known-malicious test artifact (e.g. the EICAR test file) … always quarantined and never reach the Final store … 0 escapes … (a falsifiable control, not a true-by-definition claim)."* This directly answers prior M-4/C-5. (Minor wording defect: SM-2 folds the redirect-bypass case under "quarantined," but a blocked redirect produces *no file* — see N-4.)
- **Not closed — encrypted/unscannable archives:** FR-6's fail-closed list is *unavailable / unresponsive / stale signatures*. It omits the case the prior review named explicitly: an **encrypted or otherwise unscannable archive** where ClamAV returns a clean/OK verdict because it *cannot read the contents*. Under the current FRs that reads as "passed," and FR-7 then extracts it. This is the surviving hole from prior C-5 → remaining High (N-3-crypt / see N-6).

---

## Part 2 — Status of the prior Highs

| Prior High | Status | Closing text / gap |
|---|---|---|
| Partial/interrupted download (M-7) | **CLOSED** | FR-17 C1: *"An incomplete or interrupted download … never advances to Scan or Final store; the partial file is discarded and the failure recorded."* |
| Disk full (M-8) | **CLOSED (note)** | FR-17 C1 covers "disk full" as a discard-and-record case. Note: FR-17 does not guarantee the *alert path itself* survives a full disk (SQLite/Telegram may also fail) — minor residual, see N-7. |
| ClamAV daemon down (H-7) | **CLOSED** | FR-6 C2 fail-closed (quoted above). |
| VirusTotal unreachable (H-7) | **PARTIAL** | FR-17 C2: *"the system holds or degrades to local-scan-only per configured policy"* — still an unresolved `[ASSUMPTION]` + Open Q7. Untestable as written and the "degrade" branch is exploitable (see N-8). |
| SQLite lock (H-6, M-6) | **PARTIAL** | FR-17 C3 covers **Event-write** contention: *"worker/UI contention on the shared store does not corrupt or lose an Event."* Addendum D3 adds WAL/busy-timeout. But the *live whitelist query* mis-gating / **dropped inbound message** during a lock (the actual H-6 scenario) is not addressed — a locked read at gate time has no defined "retry, not drop" requirement (N-9). |
| Telegram send failure (M-8b) | **PARTIAL** | FR-17 C3: *"A failure to … send a Telegram notification is itself logged and surfaced, never silently dropped."* Better, but "surfaced" is not pinned to the dashboard as the authoritative fallback channel, so the circularity (the failure channel *is* Telegram) is softened, not eliminated. No retry/dead-letter requirement. |
| Content-type spoofing (C-6) | **CLOSED** | FR-18 C1: *"based on the file's **real bytes**, not the declared Content-Type or URL extension; a mismatch (e.g. a `.pdf` that is actually a PE executable) is rejected or quarantined."* |
| Filename sanitization (H-2) | **CLOSED** | FR-18 C2: *"Stored filenames are sanitized (no path separators, control characters, or overlong names)."* (Bidi/RTL-override and reserved-name specifics not named, but "control characters" + "sanitized" is adequate at PRD altitude.) |
| Executables in final store (H-1) | **CLOSED** | FR-18 C3: *"Files are written **non-executable** and outside any auto-run / watched path; the system never executes downloaded content."* (Folder *permissions*/ownership 0700 from prior H-1 still unspecified — minor, non-blocking.) |

Not-in-scope-of-this-pass but still OPEN from v1 (unchanged, flagged for completeness, not counted as new): **C-7 sender identity** (JID basis, group/forward/recycled-number behavior undefined — nothing in the hardening touched it), **H-9 link-pattern matching semantics** (suffix/userinfo/punycode bypass), **M-9/L-2 rate & concurrency limits** (multi-URL fan-out amplification). H-8 (shorteners/open-redirects) is now **PARTIAL** — FR-16 re-gates the redirect destination, which resolves the open-redirect case; extension-only patterns still launder host.

---

## Part 3 — NEW / freshly-sharpened findings from the hardening

Counts — **High: 3 (remaining/uncovered) · Medium: 3 (contradictions or untestable text introduced/sharpened) · Low: 2**

### N-1 (High) — Extracted archive contents are still never individually re-scanned; PRD FR-7 and Addendum §C step 9 contradict each other on *where* extracted bytes land
The hardening bounded *how* extraction runs but not *what happens to the output's trust*. FR-7 says extraction goes to an "isolated extraction target." Addendum §C step 9 still reads: *"Pass → move to **final** folder (source of truth); if archive, extract **after** pass, under guards."* — i.e. archive is already **in final** when it detonates open. Neither doc requires a **per-file re-scan of extracted contents**. A malicious member inside an archive ClamAV did not recurse into (encrypted/nested/format-limited) is extracted *into or beside the final store* unscanned. This is the prior H-5, untouched. **Fix:** mandate order = scan archive → extract to isolated staging → scan each extracted file → promote only clean files; make FR-7 and Addendum §C step 9 agree.

### N-2 (High) — DNS-rebinding: the IP-pin was dropped; check-time IP ≠ connect-time IP across the HEAD→GET split
Prior C-1's fix explicitly required *"pin that IP for the actual GET (defeat DNS rebinding)."* FR-16/D2 only require checking the *resolved IP at connect time*. With the HEAD→GET split still present (Addendum §C step 6), the name is resolved at least twice; an attacker's DNS can answer public on the checked resolution and `169.254.169.254` on the transfer resolution. "Enforce at connect time" narrows but does not close the window without a **pin-the-checked-IP** requirement. **Fix:** resolve once, validate, and connect to that exact IP for every subsequent request in the fetch (or re-validate the IP on every new connection and refuse if it changed).

### N-6 (High) — Encrypted/unscannable archives are not defined as scan-failures
FR-6's fail-closed triggers are scanner-down / unresponsive / stale-signatures. A password-protected zip (or any container ClamAV cannot read) yields a *clean* verdict — nothing was scanned — and FR-7 then extracts it under N-1's unscanned path. Prior C-5's fix named this explicitly and it was not adopted. **Fix:** add a consequence — "a file or archive that cannot be fully scanned (encrypted, password-protected, or format the scanner cannot read) is treated as scan-failed → quarantine."

### N-3 (Medium) — Addendum §C step 6 still describes a HEAD "size ≤ max" check, contradicting FR-3's "HEAD is advisory only, streaming cap"
FR-3 was correctly rewritten to a streaming cap; the pipeline-mechanism step 6 in the addendum was not updated and still says *"HEAD request: confirm downloadable content-type + size ≤ max."* An implementer reading the addendum's step list will build the very HEAD-trust the FR forbids. **Fix:** rewrite §C step 6 to "streaming byte cap during GET; HEAD advisory only," matching FR-3/D2. (Also the reason N-2's rebind window exists.)

### N-4 (Medium) — FR-3 (pre-fetch, advisory) vs FR-18 (real-bytes) both claim to own the "acceptable-type decision"
FR-3 C1: reject "before the body is fetched" on advertised content-type. FR-18 C1: *"The acceptable-type decision (FR-3) is based on the file's **real bytes**."* You cannot sniff real bytes before fetching. These are two different checks (a pre-fetch advisory reject and a post-download authoritative reject), but FR-18 phrases the byte-based check as *the* FR-3 decision, which reads as a contradiction. A tester cannot tell which check is authoritative for acceptance. **Fix:** state both explicitly — advertised type may pre-reject (advisory), real bytes are authoritative for acceptance/quarantine.

### N-8 (Medium) — FR-17 "hold or degrade to local-scan-only per configured policy" is untestable and the degrade branch is a self-inflicted downgrade
The reputation-outage behavior is still an open `[ASSUMPTION]` (Open Q7). A tester cannot assert an expected outcome. Worse, the *degrade* branch means an attacker who can make VirusTotal unreachable (or simply sends a file VT has never seen → "unknown") forces the pipeline onto ClamAV-only. VT is optional-second-signal so degrade isn't a *large* weakening, but shipping an unresolved either/or with no default makes SM-2's "0 escapes" claim un-runnable for this case. **Fix:** pick a testable default now (recommend "degrade — VT is advisory and must never block," with an explicit consequence that VT-unknown/unreachable never upgrades *or blocks* trust), and delete the ambiguity.

### N-4b (Low) — SM-2 conflates "rejected at fetch" with "quarantined"
SM-2 asserts the redirect-bypass and scanner-down cases are *"always quarantined."* A blocked redirect (FR-16) or a refused private-IP target produces **no file at all** — there is nothing to quarantine. The success criterion should read "blocked/refused *or* quarantined, and never reaching the Final store," else a correct implementation (that rejects with no artifact) technically fails the metric as written.

### N-5 (Low) — FR-16 "re-checks every redirect hop against **both gates**" is imprecise
The sender gate cannot apply to a redirect target (there is no sender on hop N). Addendum D2 correctly narrows to link-pattern + IP; FR-16's "both gates" wording should match, or a tester will look for a nonexistent sender re-check.

---

## Part 4 — Bottom line for the architect

The load-bearing network and archive-bomb properties are now specified and testable — that is the bulk of the prior REJECT, and it is addressed. To reach ship-ready, close four things at the requirements level (all small):

1. **N-1** — per-file re-scan of extracted contents + fix the FR-7 / Addendum §C-step-9 "isolated vs final" contradiction. (Highest: it re-opens a path to unscanned bytes in final.)
2. **N-2** — add an explicit IP-pin (or re-validate-per-connection) requirement so the DNS-rebind window across HEAD→GET is closed.
3. **N-6** — define encrypted/unscannable archives as scan-failures.
4. **N-3 + N-4 + N-8** — reconcile the three text-level contradictions (addendum HEAD step, FR-3-vs-FR-18 type authority, and the hold-vs-degrade open question) so every new consequence is falsifiable.

Then optionally pick up the still-open pre-existing items (C-7 sender identity, H-9 pattern grammar, rate/concurrency caps) — none are new, but C-7 in particular is a genuine gate-1 bypass that no amount of network hardening compensates for.

The anti-pattern from v1 is *mostly* gone: the FRs now name the source of each checked value. The residue is at the seams — between two requests (N-2), between two documents (N-1, N-3), and between two type-checks (N-4).
