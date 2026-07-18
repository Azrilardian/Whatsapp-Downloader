// AD-14: row shapes of the shared SQLite seam. Column names are snake_case
// (DB convention); these types are the read/write contract for both processes.

import type { ItemStatus } from './status.ts';

export interface ItemRow {
  item_id: string; // UUIDv4
  status: ItemStatus; // single status holder (AD-5)
  sender_jid: string; // normalized Baileys JID
  source_url: string;
  url_hash: string; // pre-download dedup key (AD-10)
  content_sha256: string | null; // post-download dedup key, null until downloaded
  filename: string | null;
  size_bytes: number | null;
  scan_result: string | null;
  created_at: string; // ISO-8601 UTC
  updated_at: string; // ISO-8601 UTC
}

export interface EventRow {
  event_id: string; // UUIDv4
  item_id: string | null; // null for system-level events (e.g. connection state)
  event_type: string;
  detail: string | null;
  created_at: string; // ISO-8601 UTC
}

export interface ContactRow {
  jid: string; // normalized Baileys JID (PK)
  label: string | null;
  active: 0 | 1;
  created_at: string;
  updated_at: string;
}

export type LinkPatternType = 'domain' | 'extension';

export interface LinkPatternRow {
  pattern: string; // exact domain (optional path prefix) or extension (PK)
  type: LinkPatternType;
  active: 0 | 1;
  created_at: string;
  updated_at: string;
}

export interface SettingRow {
  key: string;
  value: string;
  updated_at: string;
}

/** Keys seeded into `settings` by migration 001 (AD-17). */
export const SETTING_KEYS = [
  'max_download_bytes',
  'max_uncompressed_bytes',
  'max_file_count',
  'max_nesting_depth',
  'max_redirect_hops',
  'scanner_sig_max_age_hours',
  'max_concurrent',
  'per_sender_rate_per_min',
  'vt_flag_policy',
  'vt_outage_policy',
  'events_retention_days',
  'backup_cadence',
] as const;

export type SettingKey = (typeof SETTING_KEYS)[number];
