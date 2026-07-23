-- Migration 003 — group whitelist (FR-19; AD-18).
-- Separate table from `contacts`, not a `kind` discriminator, so a group
-- identity can never be mistaken for a person identity in a query that
-- forgot to filter. Dashboard-writable, worker reads live (AD-2).

CREATE TABLE groups (
  group_jid  TEXT PRIMARY KEY,
  label      TEXT,
  active     INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
