import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb, runMigrations, nowIso } from '@wadl/shared';
import { MIGRATIONS_DIR } from './paths.ts';
import { guardedFetch, isBlockedIp, type GuardedFetchDeps } from './guarded-fetch.ts';

// isBlockedIp boundary checks: CGNAT, multicast, and IPv6 ULA/link-local,
// each just inside and just outside the blocked range.
assert.equal(isBlockedIp('100.64.0.1'), true); // CGNAT start
assert.equal(isBlockedIp('100.63.255.255'), false); // just below CGNAT
assert.equal(isBlockedIp('100.127.255.255'), true); // CGNAT end
assert.equal(isBlockedIp('100.128.0.0'), false); // just above CGNAT
assert.equal(isBlockedIp('224.0.0.1'), true); // multicast
assert.equal(isBlockedIp('223.255.255.255'), false); // just below multicast
assert.equal(isBlockedIp('8.8.8.8'), false); // public
assert.equal(isBlockedIp('fc00::1'), true); // ULA
assert.equal(isBlockedIp('fbff:ffff::1'), false); // just below ULA
assert.equal(isBlockedIp('fe80::1'), true); // link-local
assert.equal(isBlockedIp('2606:4700:4700::1111'), false); // public v6

// Task 10 self-check (FR-16/AD-8/AD-12/AD-17): pins the resolved IP and
// refuses private/reserved ranges via URL or redirect; each redirect
// re-checks the active link patterns and rejects non-matching hops; chains
// over the hop cap abort. DNS lookup and the socket request are faked so
// this runs without network access.
// Run: npx tsx src/check-guarded-fetch.ts

const root = mkdtempSync(join(tmpdir(), 'wadl-guarded-fetch-'));
const db = openDb(join(root, 'app.db'));
runMigrations(db, MIGRATIONS_DIR);

const now = () => nowIso();
db.prepare(
  'INSERT INTO link_patterns (pattern, type, active, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
).run('good.example.com', 'domain', 1, now(), now());

function fakeResponse(statusCode: number, location?: string): any {
  return { statusCode, headers: location ? { location } : {}, resume: () => {} };
}

// case 1: initial URL's resolved IP is private -> blocked before any request.
{
  const deps: GuardedFetchDeps = {
    lookup: async () => ({ address: '10.0.0.5' }),
    request: async () => fakeResponse(200),
  };
  const result = await guardedFetch(db, 'https://good.example.com/a.pdf', deps);
  assert.equal(result.ok, false);
  assert.equal(!result.ok && result.reason, 'blocked_ip');
}

// case 1b: initial URL's host has no active pattern -> pattern_mismatch
// before any DNS lookup or request (whitelist applies to hop zero too).
{
  let lookupCount = 0;
  const deps: GuardedFetchDeps = {
    lookup: async () => {
      lookupCount++;
      return { address: '93.184.216.34' };
    },
    request: async () => fakeResponse(200),
  };
  const result = await guardedFetch(db, 'https://unmatched.example.com/a.pdf', deps);
  assert.equal(result.ok, false);
  assert.equal(!result.ok && result.reason, 'pattern_mismatch');
  assert.equal(lookupCount, 0);
}

// case 2: clean fetch, no redirect -> ok.
{
  const deps: GuardedFetchDeps = {
    lookup: async () => ({ address: '93.184.216.34' }),
    request: async () => fakeResponse(200),
  };
  const result = await guardedFetch(db, 'https://good.example.com/a.pdf', deps);
  assert.equal(result.ok, true);
  assert.equal(result.ok && result.finalUrl, 'https://good.example.com/a.pdf');
}

// case 3: redirect to a host with no active pattern -> pattern_mismatch, no
// second request attempted (whitelist can't be bypassed by one 302).
{
  let requestCount = 0;
  const deps: GuardedFetchDeps = {
    lookup: async () => ({ address: '93.184.216.34' }),
    request: async () => {
      requestCount++;
      return requestCount === 1
        ? fakeResponse(302, 'https://evil.example.com/a.pdf')
        : fakeResponse(200);
    },
  };
  const result = await guardedFetch(db, 'https://good.example.com/a.pdf', deps);
  assert.equal(result.ok, false);
  assert.equal(!result.ok && result.reason, 'pattern_mismatch');
  assert.equal(requestCount, 1);
}

// case 4: redirect to a resolved-private IP -> blocked_ip, even though the
// redirect host itself isn't in link_patterns (checked here to prove IP
// pinning applies per-hop; add a matching pattern so it gets past the gate
// check and hits the IP check).
db.prepare(
  'INSERT INTO link_patterns (pattern, type, active, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
).run('rebind.example.com', 'domain', 1, now(), now());
{
  let requestCount = 0;
  const deps: GuardedFetchDeps = {
    lookup: async (hostname: string) => {
      requestCount++;
      return hostname === 'rebind.example.com' ? { address: '169.254.169.254' } : { address: '93.184.216.34' };
    },
    request: async () => fakeResponse(302, 'https://rebind.example.com/a.pdf'),
  };
  const result = await guardedFetch(db, 'https://good.example.com/a.pdf', deps);
  assert.equal(result.ok, false);
  assert.equal(!result.ok && result.reason, 'blocked_ip');
}

// case 5: redirect chain exceeding max_redirect_hops (default 5) -> too_many_redirects.
db.prepare(
  'INSERT INTO link_patterns (pattern, type, active, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
).run('loop.example.com', 'domain', 1, now(), now());
{
  const deps: GuardedFetchDeps = {
    lookup: async () => ({ address: '93.184.216.34' }),
    request: async () => fakeResponse(302, 'https://loop.example.com/a.pdf'),
  };
  const result = await guardedFetch(db, 'https://loop.example.com/a.pdf', deps);
  assert.equal(result.ok, false);
  assert.equal(!result.ok && result.reason, 'too_many_redirects');
}

// case 6: max_redirect_hops read live from settings, not hardcoded (AD-17).
db.prepare('UPDATE settings SET value = ? WHERE key = ?').run('1', 'max_redirect_hops');
{
  let requestCount = 0;
  const deps: GuardedFetchDeps = {
    lookup: async () => ({ address: '93.184.216.34' }),
    request: async () => {
      requestCount++;
      return fakeResponse(302, 'https://loop.example.com/a.pdf');
    },
  };
  const result = await guardedFetch(db, 'https://loop.example.com/a.pdf', deps);
  assert.equal(result.ok, false);
  assert.equal(!result.ok && result.reason, 'too_many_redirects');
  assert.equal(requestCount, 2); // hop 0 + hop 1, then hop cap of 1 exceeded
}

db.close();
console.log('check-guarded-fetch: ok');
