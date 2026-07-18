import type { LinkPatternRow } from './types.ts';

// AD-12: one shared matcher module used by both the initial link gate and
// the guarded fetcher's per-redirect-hop re-check — no second implementation
// of "does this URL match an active pattern" is ever allowed to exist.
// Patterns are exact-domain (optional path prefix) and/or an extension
// allowlist — no regex, no wildcard TLD, no substring matching.

const URL_RE = /https?:\/\/[^\s<>()"']+/gi;

// Trailing prose punctuation (a sentence-ending period, a comma before the
// next clause, ...) is not part of the URL — strip it so
// "https://x.com/a.pdf." doesn't wrongly pass a domain rule or
// "https://x.com/archive.zip," doesn't wrongly fail an extension rule.
const TRAILING_URL_PUNCTUATION_RE = /[.,!?:;]+$/u;

/** Pulls every http(s) URL out of free-form message text. */
export function extractUrls(text: string): string[] {
  return [...text.matchAll(URL_RE)].map((match) => match[0].replace(TRAILING_URL_PUNCTUATION_RE, ''));
}

function parseDomainPattern(pattern: string): { domain: string; pathPrefix: string | null } {
  const slashIndex = pattern.indexOf('/');
  if (slashIndex === -1) return { domain: pattern.toLowerCase(), pathPrefix: null };
  return { domain: pattern.slice(0, slashIndex).toLowerCase(), pathPrefix: pattern.slice(slashIndex) };
}

function normalizeExtension(pattern: string): string {
  const lower = pattern.toLowerCase();
  return lower.startsWith('.') ? lower : `.${lower}`;
}

/** Does this parsed URL match one active link_patterns row? Exact match only — no substring/wildcard. */
export function matchesLinkPattern(url: URL, pattern: LinkPatternRow): boolean {
  if (pattern.type === 'domain') {
    const { domain, pathPrefix } = parseDomainPattern(pattern.pattern);
    if (url.hostname.toLowerCase() !== domain) return false;
    return pathPrefix === null || url.pathname.startsWith(pathPrefix);
  }
  return url.pathname.toLowerCase().endsWith(normalizeExtension(pattern.pattern));
}

/**
 * FR-2: from a list of candidate URL strings, keep only the http(s) ones
 * that parse cleanly and match at least one active pattern — every other
 * candidate (malformed, non-http(s), no match) never advances.
 */
export function findMatchingUrls(urls: string[], activePatterns: LinkPatternRow[]): string[] {
  const matched: string[] = [];
  for (const raw of urls) {
    let parsed: URL;
    try {
      parsed = new URL(raw);
    } catch {
      continue;
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') continue;
    if (activePatterns.some((pattern) => matchesLinkPattern(parsed, pattern))) matched.push(raw);
  }
  return matched;
}
