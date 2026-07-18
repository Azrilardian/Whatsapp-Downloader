import { lookup as dnsLookup } from 'node:dns/promises';
import * as http from 'node:http';
import * as https from 'node:https';
import { isIP } from 'node:net';
import type { Db, LinkPatternRow } from '@wadl/shared';
import { matchesLinkPattern } from '@wadl/shared';

const DEFAULT_MAX_REDIRECT_HOPS = 5;

// AD-8: private/loopback/link-local/cloud-metadata ranges are refused for
// both the initial URL and every redirect hop's resolved IP.
const BLOCKED_V4_RANGES: [number, number][] = [
  cidr4('127.0.0.0', 8),
  cidr4('10.0.0.0', 8),
  cidr4('172.16.0.0', 12),
  cidr4('192.168.0.0', 16),
  cidr4('169.254.0.0', 16),
];

function cidr4(base: string, bits: number): [number, number] {
  const num = base.split('.').reduce((acc, part) => (acc << 8) + Number(part), 0) >>> 0;
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return [num & mask, mask];
}

function ipv4ToInt(ip: string): number {
  return ip.split('.').reduce((acc, part) => (acc << 8) + Number(part), 0) >>> 0;
}

function isBlockedIp(ip: string): boolean {
  if (isIP(ip) === 4) {
    const num = ipv4ToInt(ip);
    return BLOCKED_V4_RANGES.some(([base, mask]) => (num & mask) === base);
  }
  // ::1 loopback and IPv4-mapped ::ffff:a.b.c.d fall back to the v4 check.
  const normalized = ip.toLowerCase();
  if (normalized === '::1') return true;
  const mapped = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  return mapped?.[1] ? isBlockedIp(mapped[1]) : false;
}

// AD-17: read live from `settings`, never cached — mirrors backup.ts's getSetting.
function getSetting(db: Db, key: string, fallback: string): string {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
  return row?.value ?? fallback;
}

export function resolveMaxRedirectHops(raw: string): number {
  const parsed = raw.trim() === '' ? Number.NaN : Number(raw);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : DEFAULT_MAX_REDIRECT_HOPS;
}

function activeLinkPatterns(db: Db): LinkPatternRow[] {
  return db.prepare('SELECT * FROM link_patterns WHERE active = 1').all() as LinkPatternRow[];
}

export type GuardedFetchResult =
  | { ok: true; response: http.IncomingMessage; finalUrl: string }
  | { ok: false; reason: 'blocked_ip' | 'pattern_mismatch' | 'too_many_redirects' | 'fetch_error'; detail: string };

type LookupFn = (hostname: string) => Promise<{ address: string }>;
type RequestFn = (
  url: URL,
  address: string,
) => Promise<http.IncomingMessage | Error>;

function realRequest(url: URL, address: string): Promise<http.IncomingMessage | Error> {
  return new Promise((resolve) => {
    const transport = url.protocol === 'http:' ? http : https;
    const req = transport.request(
      {
        hostname: address, // pin: connect to the resolved IP, not re-resolved on request
        servername: url.protocol === 'https:' ? url.hostname : undefined,
        port: url.port || (url.protocol === 'http:' ? 80 : 443),
        path: url.pathname + url.search,
        headers: { Host: url.hostname },
      },
      (res) => resolve(res),
    );
    req.on('error', (err) => resolve(err));
    req.end();
  });
}

// deps seam: production always uses the real DNS lookup + real socket
// connection; self-check injects fakes so hop/pattern/hop-cap logic is
// verifiable without depending on network reachability from the sandbox.
export interface GuardedFetchDeps {
  lookup: LookupFn;
  request: RequestFn;
}

const REAL_DEPS: GuardedFetchDeps = { lookup: dnsLookup, request: realRequest };

/**
 * AD-8: the single guarded fetch path for all outbound content. Resolves and
 * pins the target IP per hop (defeats DNS rebinding), refuses private/
 * reserved ranges, and re-applies the shared link-pattern gate (AD-12) on
 * every redirect — so one 3xx can't route around the whitelist. Fails closed
 * (AD-6) on any blocked IP, non-matching hop, or hop-cap overrun.
 */
export async function guardedFetch(
  db: Db,
  startUrl: string,
  deps: GuardedFetchDeps = REAL_DEPS,
): Promise<GuardedFetchResult> {
  const maxHops = resolveMaxRedirectHops(getSetting(db, 'max_redirect_hops', String(DEFAULT_MAX_REDIRECT_HOPS)));

  let currentUrl = startUrl;
  for (let hop = 0; hop <= maxHops; hop++) {
    const url = new URL(currentUrl);

    if (hop > 0) {
      const patterns = activeLinkPatterns(db);
      if (!patterns.some((pattern) => matchesLinkPattern(url, pattern))) {
        return { ok: false, reason: 'pattern_mismatch', detail: currentUrl };
      }
    }

    let address: string;
    try {
      address = (await deps.lookup(url.hostname)).address;
    } catch (err) {
      return { ok: false, reason: 'fetch_error', detail: `dns lookup failed for ${url.hostname}: ${String(err)}` };
    }
    if (isBlockedIp(address)) {
      return { ok: false, reason: 'blocked_ip', detail: `${url.hostname} -> ${address}` };
    }

    const response = await deps.request(url, address);
    if (response instanceof Error) {
      return { ok: false, reason: 'fetch_error', detail: String(response) };
    }

    const status = response.statusCode ?? 0;
    if (status >= 300 && status < 400 && response.headers.location) {
      response.resume(); // drain, discard body of the redirect response
      currentUrl = new URL(response.headers.location, currentUrl).toString();
      continue;
    }

    return { ok: true, response, finalUrl: currentUrl };
  }

  return { ok: false, reason: 'too_many_redirects', detail: `exceeded ${maxHops} hop(s)` };
}
