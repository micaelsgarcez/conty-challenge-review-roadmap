import { DatabaseSync } from "node:sqlite";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS brands (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  timezone TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS creators (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS campaigns (
  id TEXT PRIMARY KEY,
  brand_id TEXT NOT NULL REFERENCES brands(id),
  name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS scripts (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES campaigns(id),
  creator_id TEXT NOT NULL REFERENCES creators(id),
  title TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS versions (
  script_id TEXT NOT NULL REFERENCES scripts(id),
  number INTEGER NOT NULL,
  content TEXT NOT NULL,
  submitted_at TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('in_review', 'changes_requested', 'approved')),
  change_reason TEXT,
  change_due_date TEXT,
  changes_requested_at TEXT,
  approved_at TEXT,
  late INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (script_id, number),
  CHECK ((status = 'changes_requested') = (change_reason IS NOT NULL AND change_due_date IS NOT NULL AND changes_requested_at IS NOT NULL)),
  CHECK ((status = 'approved') = (approved_at IS NOT NULL))
);
`;

export function openDatabase(path = ":memory:"): DatabaseSync {
  const db = new DatabaseSync(path);
  db.exec(SCHEMA);
  return db;
}
