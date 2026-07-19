-- Migration 002 — worker connection status surface (FR-13/FR-14; AD-1).
-- Single-row table: the worker is the sole writer, the dashboard reads it
-- read-only to render connection status and the re-pair QR (AD-4).

CREATE TABLE worker_state (
  id                INTEGER PRIMARY KEY CHECK (id = 1),
  connection_status TEXT NOT NULL CHECK (connection_status IN ('connecting', 'open', 'close', 'logged_out')),
  qr_data_url       TEXT,
  updated_at        TEXT NOT NULL
);

INSERT INTO worker_state (id, connection_status, qr_data_url, updated_at)
VALUES (1, 'connecting', NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
