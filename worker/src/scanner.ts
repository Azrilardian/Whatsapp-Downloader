import { createRequire } from 'node:module';

// clamscan ships no TypeScript declarations; createRequire sidesteps the
// ESM/CJS default-export interop question entirely (Node's own documented
// escape hatch), so the real adapter needs no ambient .d.ts file.
const require = createRequire(import.meta.url);

export interface ScannerClient {
  getVersion(): Promise<string>;
  isInfected(filePath: string): Promise<{ isInfected: boolean; viruses: string[] }>;
}

export type VtLookup = { status: 'clean' } | { status: 'flagged' } | { status: 'outage' } | { status: 'unknown' };

export interface VtClient {
  lookupHash(sha256: string): Promise<VtLookup>;
}

let clamPromise: Promise<any> | null = null;

// One lazily-initialized clamd client shared across scans (library default
// config: auto-detects clamdscan/clamscan). Init failure surfaces on the
// first real call and is treated by scanFile as "scanner unavailable"
// (AD-6 fail-closed), not swallowed here. A rejected init clears the cache so
// the next scan retries instead of failing every scan until a worker restart.
function getClam(): Promise<any> {
  if (clamPromise) return clamPromise;
  const created: Promise<any> = new (require('clamscan'))().init();
  const retryable = created.catch((err: unknown) => {
    clamPromise = null;
    throw err;
  });
  clamPromise = retryable;
  return retryable;
}

export const realScanner: ScannerClient = {
  async getVersion() {
    const clam = await getClam();
    return clam.getVersion();
  },
  async isInfected(filePath: string) {
    const clam = await getClam();
    const { isInfected, viruses } = await clam.isInfected(filePath);
    // clamscan reports isInfected: null when the file couldn't be scanned at
    // all (permissions, corrupt/unreadable content) — that's a failure, not
    // a clean verdict, and must not be forwarded as one (AD-6 fail-closed).
    if (typeof isInfected !== 'boolean') {
      throw new Error(`clamscan returned an indeterminate result (isInfected=${String(isInfected)})`);
    }
    return { isInfected, viruses: viruses ?? [] };
  },
};

const VT_FILES_API = 'https://www.virustotal.com/api/v3/files';
const VT_TIMEOUT_MS = 10_000;

/** FR-6/AD-17: VirusTotal is an optional hash-lookup second signal — never a full-file upload. */
export function makeVtClient(apiKey: string): VtClient {
  return {
    async lookupHash(sha256: string): Promise<VtLookup> {
      let response: Response;
      try {
        response = await fetch(`${VT_FILES_API}/${sha256}`, {
          headers: { 'x-apikey': apiKey },
          signal: AbortSignal.timeout(VT_TIMEOUT_MS),
        });
      } catch {
        return { status: 'outage' };
      }
      // 404 means "not found", not "confirmed clean"; other non-OK statuses
      // (auth/quota failures) are equally uninformative — both are unknown,
      // never degraded to clean.
      if (response.status === 404) return { status: 'unknown' };
      if (!response.ok) return { status: 'unknown' };

      const body = (await response.json()) as {
        data?: { attributes?: { last_analysis_stats?: { malicious?: number; suspicious?: number } } };
      };
      const stats = body.data?.attributes?.last_analysis_stats;
      if (!stats) return { status: 'unknown' };
      const flagged = (stats.malicious ?? 0) > 0 || (stats.suspicious ?? 0) > 0;
      return { status: flagged ? 'flagged' : 'clean' };
    },
  };
}
