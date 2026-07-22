// Policy field definitions mirror the worker's getSetting/resolve* readers
// (concurrency.ts, download.ts, extract.ts, guarded-fetch.ts, scan.ts,
// backup.ts) — bounds here must match theirs so the dashboard never accepts
// a value the worker would silently fall back from.
export type SettingField =
  | { key: string; label: string; help: string; kind: 'int'; min: number }
  | { key: string; label: string; help: string; kind: 'select'; options: string[] };

export const SETTINGS_FIELDS: SettingField[] = [
  { key: 'max_download_bytes', label: 'Max download size (bytes)', help: 'Streaming byte cap per download.', kind: 'int', min: 1 },
  { key: 'max_uncompressed_bytes', label: 'Max uncompressed archive size (bytes)', help: 'Zip-bomb cap on extracted content.', kind: 'int', min: 1 },
  { key: 'max_file_count', label: 'Max files per archive', help: 'Zip-bomb cap on entry count.', kind: 'int', min: 1 },
  { key: 'max_nesting_depth', label: 'Max archive nesting depth', help: 'Zip-bomb cap on nested archives.', kind: 'int', min: 0 },
  { key: 'max_redirect_hops', label: 'Max redirect hops', help: 'Redirects re-checked against gates before refusal.', kind: 'int', min: 0 },
  { key: 'scanner_sig_max_age_hours', label: 'Scanner signature max age (hours)', help: 'ClamAV signatures older than this fail closed.', kind: 'int', min: 1 },
  { key: 'max_concurrent', label: 'Max concurrent downloads', help: 'Bounded concurrency queue size.', kind: 'int', min: 1 },
  { key: 'per_sender_rate_per_min', label: 'Per-sender rate (per minute)', help: 'Abuse cap per whitelisted sender.', kind: 'int', min: 1 },
  { key: 'vt_flag_policy', label: 'VirusTotal flag policy', help: 'What to do when VT flags a hash.', kind: 'select', options: ['hard-fail', 'warn'] },
  { key: 'vt_outage_policy', label: 'VirusTotal outage policy', help: 'What to do when VT is unreachable.', kind: 'select', options: ['hold', 'degrade'] },
  { key: 'events_retention_days', label: 'Event log retention (days)', help: 'Rows older than this are pruned.', kind: 'int', min: 0 },
  { key: 'backup_cadence', label: 'Backup cadence', help: 'How often DB + final store are backed up.', kind: 'select', options: ['hourly', 'daily', 'weekly'] },
];
