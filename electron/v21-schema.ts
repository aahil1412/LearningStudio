import type Database from "better-sqlite3";
import { migrateAnnotationSchema } from "./annotations";

export const planningTables = [
  "subject_intakes",
  "planning_jobs",
  "planning_chunks",
] as const;
export const v21Tables = [
  ...planningTables,
  "annotation_highlights",
  "annotation_revisions",
  "graph_links",
  "graph_positions",
] as const;
export function migrateV21Schema(db: Database.Database) {
  db.exec(`
    CREATE TABLE subject_intakes (
      subject_id TEXT PRIMARY KEY REFERENCES subjects(id) ON DELETE CASCADE,
      revision INTEGER NOT NULL CHECK(revision>=1),
      status TEXT NOT NULL CHECK(status IN ('in-progress','ready','skipped')),
      value TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE planning_jobs (
      id TEXT PRIMARY KEY,
      subject_id TEXT NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
      status TEXT NOT NULL CHECK(status IN ('running','awaiting-review','complete','failed','canceled','interrupted')),
      stage TEXT NOT NULL,
      model TEXT NOT NULL,
      request_state TEXT NOT NULL CHECK(request_state IN ('idle','possibly-admitted','completed')),
      completed_modules INTEGER NOT NULL DEFAULT 0 CHECK(completed_modules>=0),
      total_modules INTEGER NOT NULL DEFAULT 0 CHECK(total_modules>=0),
      cancel_requested INTEGER NOT NULL DEFAULT 0 CHECK(cancel_requested IN (0,1)),
      value TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX planning_subject_updated ON planning_jobs(subject_id,updated_at DESC);
    CREATE UNIQUE INDEX planning_subject_running ON planning_jobs(subject_id) WHERE status='running';
    CREATE TABLE planning_chunks (
      job_id TEXT NOT NULL REFERENCES planning_jobs(id) ON DELETE CASCADE,
      module_id TEXT NOT NULL,
      ordinal INTEGER NOT NULL CHECK(ordinal>=0),
      value TEXT NOT NULL,
      completed_at TEXT NOT NULL,
      PRIMARY KEY(job_id,module_id),
      UNIQUE(job_id,ordinal)
    );
  `);
  migrateAnnotationSchema(db);
  db.exec(
    "INSERT INTO migrations VALUES (4,datetime('now')); PRAGMA user_version=4;",
  );
}
