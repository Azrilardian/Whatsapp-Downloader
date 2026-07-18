import { lookup as dnsLookup } from 'node:dns/promises';
import * as http from 'node:http';
import * as https from 'node:https';
import { isIP } from 'node:net';
import type { Db, LinkPatternRow } from '@wadl/shared';
import { matchesLinkPattern } from '@wadl/shared';

const DEFAULT_MAX_REDIRECT_HOPS = 5;
const REQUEST_TIMEOUT_MS = 30_000;

// AD-8: private/loopback/link-local/reserved/cloud-metadata ranges are
// refused for both the initial URL and every redirect hop's resolved IP.
// Source: IANA special-purpose address registries (RFC 6890 / RFC 6724).
const BLOCKED_V4_RANGES: [number, number][] = [
  cidr4('0.0.0.0', 8), // "this network"
  cidr4('10.0.0.0', 8),
  cidr4('100.64.0.0', 10), // CGNAT
  cidr4('127.0.0.0', 8),
  cidr4('169.254.0.0', 16),
  cidr4('172.16.0.0', 12),
  cidr4('192.0.0.0', 24), // IETF protocol assignments
  cidr4('192.0.2.0', 24), // TEST-NET-1
  cidr4('192.88.99.0', 24), // 6to4 relay anycast
  cidr4('192.168.0.0', 16),
  cidr4('198.18.0.0', 15), // benchmarking
  cidr4('198.51.100.0', 24), // TEST-NET-2
  cidr4('203.0.113.0', 24), // TEST-NET-3
  cidr4('224.0.0.0', 4), // multicast
  cidr4('240.0.0.0', 4), // reserved
];

function cidr4(base: string, bits: number): [number, number] {
  const num = base.split('.').reduce((acc, part) => (acc << 8) + Number(part), 0) >>> 0;
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return [num & mask, mask];
}

function ipv4ToInt(ip: string): number {
  return ip.split('.').reduce((acc, part) => (acc << 8) + Number(part), 0) >>> 0;
}

// Full 128-bit parse so ULA (fc00::/7) and other >16-bit-prefixed ranges are
// checked correctly, not just the first hextet.
function ipv6ToBigInt(ip: string): bigint {
  const full = expandIpv6(ip);
  return full.reduce((acc, part) => (acc << 16n) + BigInt(part), 0n);
}

function expandIpv6(ip: string): number[] {
  const [head, tail = ''] = ip.split('::');
  const headParts = head ? head.split(':').map((p) => parseInt(p, 16)) : [];
  const tailParts = tail ? tail.split(':').map((p) => parseInt(p, 16)) : [];
  const missing = 8 - headParts.length - tailParts.length;
  return [...headParts, ...Array(Math.max(missing, 0)).fill(0), ...tailParts];
}

function cidr6(base: string, bits: number): [bigint, bigint] {
  const num = ipv6ToBigInt(base);
  const mask = bits === 0 ? 0n : (((1n << 128n) - 1n) << BigInt(128 - bits)) & ((1n << 128n) - 1n);
  return [num & mask, mask];
}

const BLOCKED_V6_RANGES: [bigint, bigint][] = [
  cidr6('::', 128), // unspecified
  cidr6('::1', 128), // loopback
  cidr6('fc00::', 7), // unique local (ULA)
  cidr6('fe80::', 10), // link-local
  cidr6('2001:db8::', 32), // documentation
  cidr6('::ffff:0:0', 96), // IPv4-mapped (unwrapped separately, kept as backstop)
];

export function isBlockedIp(ip: string): boolean {
  if (isIP(ip) === 4) {
    const num = ipv4ToInt(ip);
    return BLOCKED_V4_RANGES.some(([base, mask]) => (num & mask) === base);
  }
  const normalized = ip.toLowerCase();
  const mapped = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped?.[1]) return isBlockedIp(mapped[1]);
  const num = ipv6ToBigInt(normalized);
  return BLOCKED_V6_RANGES.some(([base, mask]) => (num & mask) === base);
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
    req.setTimeout(REQUEST_TIMEOUT_MS, () => {
      req.destroy(new Error('guarded fetch timed out'));
    });
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
    let url: URL;
    try {
      url = new URL(currentUrl);
    } catch (err) {
      return { ok: false, reason: 'fetch_error', detail: `invalid url ${currentUrl}: ${String(err)}` };
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return { ok: false, reason: 'fetch_error', detail: `unsupported protocol ${url.protocol}` };
    }

    // Gate every hop, including hop zero, so callers can't bypass the
    // whitelist with an unmatched initial URL.
    const patterns = activeLinkPatterns(db);
    if (!patterns.some((pattern) => matchesLinkPattern(url, pattern))) {
      return { ok: false, reason: 'pattern_mismatch', detail: currentUrl };
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

    let response: http.IncomingMessage | Error;
    try {
      response = await deps.request(url, address);
    } catch (err) {
      response = err instanceof Error ? err : new Error(String(err));
    }
    if (response instanceof Error) {
      return { ok: false, reason: 'fetch_error', detail: String(response) };
    }

    const status = response.statusCode ?? 0;
    if (status >= 300 && status < 400 && response.headers.location) {
      response.resume(); // drain, discard body of the redirect response
      try {
        currentUrl = new URL(response.headers.location, currentUrl).toString();
      } catch (err) {
        return { ok: false, reason: 'fetch_error', detail: `invalid redirect location: ${String(err)}` };
      }
      continue;
    }

    return { ok: true, response, finalUrl: currentUrl };
  }

  return { ok: false, reason: 'too_many_redirects', detail: `exceeded ${maxHops} hop(s)` };
}
