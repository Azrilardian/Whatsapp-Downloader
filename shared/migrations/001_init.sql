-- Migration 001 — the shared data contract (AD-14).
-- Applied by the worker only (AD-4); the dashboard never issues DDL.

CREATE TABLE items (
  item_id        TEXT PRIMARY KEY,
  status         TEXT NOT NULL CHECK (status IN (
                   'received','validating','downloading','scanning','extracting',
                   'ignored','duplicate','rejected','failed','quarantined','stored'
                 )),
  sender_jid     TEXT NOT NULL,
  source_url     TEXT NOT NULL,
  url_hash       TEXT NOT NULL,
  content_sha256 TEXT,
  filename       TEXT,
  size_bytes     INTEGER,
  scan_result    TEXT,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);

CREATE INDEX idx_items_status ON items (status);
CREATE INDEX idx_items_url_hash ON items (url_hash);
CREATE INDEX idx_items_content_sha256 ON items (content_sha256);

-- Append-only audit log: rows are never updated (AD-14).
CREATE TABLE events (
  event_id   TEXT PRIMARY KEY,
  item_id    TEXT REFERENCES items (item_id),
  event_type TEXT NOT NULL,
  detail     TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_events_item_id ON events (item_id);
CREATE INDEX idx_events_created_at ON events (created_at);

-- Operator whitelists — dashboard-writable (AD-2).
CREATE TABLE contacts (
  jid        TEXT PRIMARY KEY,
  label      TEXT,
  active     INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE link_patterns (
  pattern    TEXT PRIMARY KEY,
  type       TEXT NOT NULL CHECK (type IN ('domain', 'extension')),
  active     INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Policy store — dashboard-writable, worker reads live (AD-17). No secrets.
CREATE TABLE settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

INSERT INTO settings (key, value, updated_at) VALUES
  ('max_download_bytes',        '209715200', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('max_uncompressed_bytes',    '524288000', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('max_file_count',            '1000',      strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('max_nesting_depth',         '3',         strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('max_redirect_hops',         '5',         strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('scanner_sig_max_age_hours', '48',        strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('max_concurrent',            '2',         strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('per_sender_rate_per_min',   '10',        strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('vt_flag_policy',            'hard-fail', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('vt_outage_policy',          'hold',      strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('events_retention_days',     '90',        strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('backup_cadence',            'daily',     strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
