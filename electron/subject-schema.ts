import type Database from "better-sqlite3";
import { createHash } from "node:crypto";
import type { StudioData } from "../src/types";
import { z } from "zod";

export const normalizedSubjectTables = [
  "subjects",
  "subject_aliases",
  "conversations",
  "curriculum_nodes",
  "curriculum_edges",
  "subject_concepts",
  "learning_evidence",
  "subject_memory",
  "conversation_summaries",
  "memory_proposals",
  "subject_revisions",
  "subject_records",
  "record_revisions",
  "subject_search_entries",
  "conversation_tombstones",
] as const;
/** Validate untrusted SQLite/archive relationships beyond SQLite's individual foreign keys. */
export function validateNormalizedSubjects(db: Database.Database) {
  const subjects = db.prepare("SELECT * FROM subjects").all() as Record<
    string,
    any
  >[];
  for (const subject of subjects)
    z.object({
      id: z.string().min(1).max(200),
      name: z.string().min(1).max(500),
      objective: z.string().max(20000),
      depth: z.enum(["overview", "comprehensive", "advanced"]),
      version: z.number().int().min(1),
      archived: z.union([z.literal(0), z.literal(1)]),
    }).parse(subject);
  const invalid = [
    "SELECT 1 FROM conversations c JOIN conversations p ON c.parent_id=p.id WHERE c.subject_id<>p.subject_id LIMIT 1",
    "SELECT 1 FROM conversations c LEFT JOIN lessons l ON c.legacy_lesson_id=l.id WHERE l.id IS NULL LIMIT 1",
    "SELECT 1 FROM curriculum_nodes c JOIN curriculum_nodes p ON c.parent_id=p.id WHERE c.subject_id<>p.subject_id LIMIT 1",
    "SELECT 1 FROM curriculum_edges e JOIN curriculum_nodes a ON e.source_id=a.id JOIN curriculum_nodes b ON e.target_id=b.id WHERE e.subject_id<>a.subject_id OR e.subject_id<>b.subject_id OR a.id=b.id LIMIT 1",
    "SELECT 1 FROM conversation_summaries s JOIN conversations c ON s.conversation_id=c.id WHERE s.subject_id<>c.subject_id LIMIT 1",
    "SELECT 1 FROM learning_evidence e LEFT JOIN subject_concepts c ON c.subject_id=e.subject_id AND c.concept_id=e.concept_id WHERE e.concept_id IS NOT NULL AND c.concept_id IS NULL LIMIT 1",
  ];
  if (invalid.some((sql) => db.prepare(sql).get()))
    throw new Error(
      "Structured subject data contains an invalid scoped relationship.",
    );
  const acyclic = (rows: { id: string; parent_id: string | null }[]) => {
    const map = new Map(rows.map((row) => [row.id, row.parent_id]));
    const done = new Set<string>();
    for (const row of rows) {
      const path = new Set<string>();
      let cursor: string | null = row.id;
      while (cursor && !done.has(cursor)) {
        if (path.has(cursor))
          throw new Error("Structured subject data contains cyclic ancestry.");
        path.add(cursor);
        cursor = map.get(cursor) || null;
      }
      for (const key of path) done.add(key);
    }
  };
  acyclic(
    db.prepare("SELECT id,parent_id FROM conversations").all() as {
      id: string;
      parent_id: string | null;
    }[],
  );
  acyclic(
    db.prepare("SELECT id,parent_id FROM curriculum_nodes").all() as {
      id: string;
      parent_id: string | null;
    }[],
  );
  for (const table of normalizedSubjectTables.filter(
    (table) =>
      ![
        "subjects",
        "subject_aliases",
        "subject_search_entries",
        "conversation_tombstones",
      ].includes(table),
  )) {
    for (const row of db.prepare(`SELECT * FROM ${table}`).all() as Record<
      string,
      any
    >[]) {
      if (!["subject_revisions"].includes(table)) {
        const value = JSON.parse(row.value);
        if (table === "subject_records") {
          if (
            ![
              "visual",
              "chapter",
              "canvas",
              "note",
              "finding",
              "asset",
            ].includes(row.kind) ||
            Buffer.byteLength(row.value, "utf8") > 24_000_000
          )
            throw new Error(
              "An archived subject record has an unsupported type or size.",
            );
          continue;
        }
        if (!value || typeof value !== "object" || Array.isArray(value))
          throw new Error("A subject record is not structured data.");
        if (
          !["learning_evidence", "conversations", "record_revisions"].includes(
            table,
          ) &&
          value.id !== row.id &&
          value.id !== row.concept_id
        )
          throw new Error(
            "A subject record identity does not match its stored row.",
          );
        if (value.subjectId && value.subjectId !== row.subject_id)
          throw new Error("A subject record belongs to a different scope.");
        if (table === "subject_concepts")
          z.object({
            label: z.string().max(500),
            status: z.enum([
              "encountered",
              "unassessed",
              "partial",
              "demonstrated",
              "misconception",
              "review",
              "unresolved",
            ]),
            coverage: z.enum(["not-started", "introduced", "covered"]),
            evidence: z.string().max(2_000_000),
          }).parse(value);
      } else {
        const changes = JSON.parse(row.operations);
        if (!Array.isArray(changes))
          throw new Error("Subject revision operations are invalid.");
      }
    }
  }
}

export const subjectSchemaVersion = 3;
export const stableSubjectId = (name: string) =>
  "subject-" +
  createHash("sha256")
    .update(normalizeSubjectName(name))
    .digest("hex")
    .slice(0, 24);
export function normalizeSubjectName(value: string) {
  return (
    value
      .normalize("NFKC")
      .trim()
      .replace(/\s+/g, " ")
      .toLocaleLowerCase("en-US") || "general"
  );
}
export function createSubjectSchema(db: Database.Database) {
  db.exec(`
    CREATE TABLE subjects(id TEXT PRIMARY KEY,name TEXT NOT NULL,objective TEXT NOT NULL DEFAULT '',depth TEXT NOT NULL DEFAULT 'comprehensive',current_node_id TEXT,archived INTEGER NOT NULL DEFAULT 0,version INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
    CREATE TABLE subject_aliases(alias TEXT PRIMARY KEY,subject_id TEXT NOT NULL REFERENCES subjects(id));
    CREATE TABLE conversations(id TEXT PRIMARY KEY,subject_id TEXT NOT NULL REFERENCES subjects(id),legacy_lesson_id TEXT NOT NULL UNIQUE,parent_id TEXT REFERENCES conversations(id),branch_message_id TEXT,curriculum_node_id TEXT,title TEXT NOT NULL,archived INTEGER NOT NULL DEFAULT 0,position TEXT NOT NULL DEFAULT '',version INTEGER NOT NULL DEFAULT 1,value TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
    CREATE INDEX conversations_subject ON conversations(subject_id,updated_at DESC);
    CREATE TABLE curriculum_nodes(id TEXT PRIMARY KEY,subject_id TEXT NOT NULL REFERENCES subjects(id),parent_id TEXT REFERENCES curriculum_nodes(id),kind TEXT NOT NULL,title TEXT NOT NULL,status TEXT NOT NULL,ordinal REAL NOT NULL DEFAULT 0,concept_id TEXT,version INTEGER NOT NULL DEFAULT 1,value TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
    CREATE INDEX curriculum_nodes_subject ON curriculum_nodes(subject_id,parent_id,ordinal);
    CREATE TABLE curriculum_edges(id TEXT PRIMARY KEY,subject_id TEXT NOT NULL REFERENCES subjects(id),source_id TEXT NOT NULL REFERENCES curriculum_nodes(id),target_id TEXT NOT NULL REFERENCES curriculum_nodes(id),kind TEXT NOT NULL,value TEXT NOT NULL);
    CREATE INDEX curriculum_edges_target ON curriculum_edges(subject_id,target_id);
    CREATE TABLE subject_concepts(subject_id TEXT NOT NULL REFERENCES subjects(id),concept_id TEXT NOT NULL REFERENCES concepts(id) ON DELETE CASCADE,version INTEGER NOT NULL DEFAULT 1,value TEXT NOT NULL,updated_at TEXT NOT NULL,PRIMARY KEY(subject_id,concept_id));
    CREATE INDEX subject_concepts_recent ON subject_concepts(subject_id,updated_at DESC);
    CREATE INDEX subject_concepts_canonical ON subject_concepts(concept_id,subject_id);
    CREATE TABLE learning_evidence(id TEXT PRIMARY KEY,subject_id TEXT NOT NULL REFERENCES subjects(id),concept_id TEXT,conversation_id TEXT,message_id TEXT,kind TEXT NOT NULL,claim TEXT NOT NULL,value TEXT NOT NULL,created_at TEXT NOT NULL);
    CREATE INDEX learning_evidence_subject ON learning_evidence(subject_id,concept_id,created_at DESC);
    CREATE TABLE subject_memory(id TEXT PRIMARY KEY,subject_id TEXT NOT NULL REFERENCES subjects(id),kind TEXT NOT NULL,memory_key TEXT NOT NULL,value TEXT NOT NULL,version INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,UNIQUE(subject_id,memory_key));
    CREATE INDEX subject_memory_subject ON subject_memory(subject_id,kind);
    CREATE TABLE conversation_summaries(id TEXT PRIMARY KEY,subject_id TEXT NOT NULL REFERENCES subjects(id),conversation_id TEXT NOT NULL REFERENCES conversations(id),through_message_id TEXT,version INTEGER NOT NULL DEFAULT 1,value TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
    CREATE INDEX conversation_summaries_recent ON conversation_summaries(subject_id,updated_at DESC);
    CREATE TABLE memory_proposals(id TEXT PRIMARY KEY,subject_id TEXT NOT NULL REFERENCES subjects(id),base_version INTEGER NOT NULL,state TEXT NOT NULL,value TEXT NOT NULL,created_at TEXT NOT NULL,applied_revision_id TEXT);
    CREATE INDEX memory_proposals_subject ON memory_proposals(subject_id,state,created_at DESC);
    CREATE TABLE subject_revisions(id TEXT PRIMARY KEY,subject_id TEXT NOT NULL REFERENCES subjects(id),version INTEGER NOT NULL,parent_id TEXT,kind TEXT NOT NULL,actor TEXT NOT NULL,reason TEXT NOT NULL,source_conversation_id TEXT,source_message_id TEXT,operations TEXT NOT NULL,reverses_id TEXT,created_at TEXT NOT NULL,UNIQUE(subject_id,version));
    CREATE INDEX subject_revisions_subject ON subject_revisions(subject_id,version DESC);
    CREATE TABLE subject_records(id TEXT PRIMARY KEY,subject_id TEXT NOT NULL REFERENCES subjects(id),kind TEXT NOT NULL,title TEXT NOT NULL,version INTEGER NOT NULL DEFAULT 1,value TEXT NOT NULL,archived INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
    CREATE INDEX subject_records_scope ON subject_records(subject_id,kind,archived,updated_at DESC);
    CREATE TABLE record_revisions(id TEXT PRIMARY KEY,record_id TEXT NOT NULL,subject_id TEXT NOT NULL REFERENCES subjects(id),version INTEGER NOT NULL,value TEXT NOT NULL,reason TEXT NOT NULL,created_at TEXT NOT NULL,UNIQUE(record_id,version));
    CREATE VIRTUAL TABLE subject_search USING fts5(subject_id UNINDEXED,entity UNINDEXED,record_id UNINDEXED,title,body,tokenize='unicode61');
    CREATE TABLE subject_search_entries(id INTEGER PRIMARY KEY AUTOINCREMENT,subject_id TEXT NOT NULL REFERENCES subjects(id),entity TEXT NOT NULL,record_id TEXT NOT NULL,UNIQUE(subject_id,entity,record_id));
    CREATE INDEX subject_search_owner ON subject_search_entries(entity,record_id,subject_id);
    CREATE TABLE conversation_tombstones(id TEXT PRIMARY KEY,subject_id TEXT NOT NULL REFERENCES subjects(id),deleted_at TEXT NOT NULL);
    CREATE TABLE document_assets(id TEXT PRIMARY KEY,mime TEXT NOT NULL,size INTEGER NOT NULL,bytes BLOB NOT NULL,created_at TEXT NOT NULL);
    INSERT INTO migrations VALUES(3,datetime('now'));
    PRAGMA user_version=3;
  `);
}
export function indexSubjectEntity(
  db: Database.Database,
  subjectId: string,
  entity: string,
  id: string,
  title: string,
  body: string,
) {
  // Physical source rows are globally identified; a reclassified source must not
  // retain searchable text under its previous subject. Legacy shared concepts
  // are the sole exception and are never materialized as another chat's text.
  if (entity !== "concept")
    for (const row of db
      .prepare(
        "SELECT id FROM subject_search_entries WHERE entity=? AND record_id=? AND subject_id<>?",
      )
      .all(entity, id, subjectId) as { id: number }[])
      db.prepare("DELETE FROM subject_search WHERE rowid=?").run(row.id);
  db.prepare(
    "INSERT OR IGNORE INTO subject_search_entries(subject_id,entity,record_id) VALUES(?,?,?)",
  ).run(subjectId, entity, id);
  const entry = db
    .prepare(
      "SELECT id FROM subject_search_entries WHERE subject_id=? AND entity=? AND record_id=?",
    )
    .get(subjectId, entity, id) as { id: number };
  db.prepare("DELETE FROM subject_search WHERE rowid=?").run(entry.id);
  db.prepare(
    "INSERT INTO subject_search(rowid,subject_id,entity,record_id,title,body) VALUES(?,?,?,?,?,?)",
  ).run(entry.id, subjectId, entity, id, title, body.slice(0, 2_000_000));
}
export function resolveLegacySubject(
  db: Database.Database,
  name: string,
  at = new Date().toISOString(),
): string {
  const label = name.trim() || "General",
    alias = normalizeSubjectName(label);
  const existing = db
    .prepare("SELECT subject_id FROM subject_aliases WHERE alias=?")
    .get(alias) as { subject_id: string } | undefined;
  if (existing) return existing.subject_id;
  const id = stableSubjectId(label);
  db.prepare(
    "INSERT OR IGNORE INTO subjects(id,name,objective,created_at,updated_at) VALUES(?,?,?,?,?)",
  ).run(id, label, "", at, at);
  db.prepare(
    "INSERT OR IGNORE INTO subject_aliases(alias,subject_id) VALUES(?,?)",
  ).run(alias, id);
  indexSubjectEntity(db, id, "subject", id, label, "");
  return id;
}
/** Only changed legacy records are mirrored. The original tables remain export-compatible. */
export function syncLegacySubjects(
  db: Database.Database,
  data: StudioData,
  options: { partial?: boolean } = {},
) {
  const now = new Date().toISOString();
  const subjectsByLesson = new Map<string, string>();
  const subjectExists = db.prepare("SELECT 1 FROM subjects WHERE id=?");
  const resolve = (name: string, explicit?: string, at = now) =>
    explicit && subjectExists.get(explicit)
      ? explicit
      : resolveLegacySubject(db, name, at);
  const conversations = new Map(
    (
      db.prepare("SELECT id,subject_id,value FROM conversations").all() as {
        id: string;
        subject_id: string;
        value: string;
      }[]
    ).map((row) => [row.id, row]),
  );
  for (const lesson of data.lessons) {
    const subjectId = resolve(
      lesson.subject,
      lesson.subjectId,
      lesson.createdAt || now,
    );
    subjectsByLesson.set(lesson.id, subjectId);
    const previous = conversations.get(lesson.id);
    const preserved = previous ? JSON.parse(previous.value) : {};
    const value = JSON.stringify({
      objective: lesson.objective,
      mode: lesson.mode,
      position: lesson.position,
      notes: lesson.notes,
      readingProgress: lesson.readingProgress,
      studyView: lesson.studyView,
      goals: lesson.goals,
      title: lesson.title,
      curriculumNodeId: lesson.curriculumNodeId,
      resumeSummary: preserved.resumeSummary,
    });
    const before = conversations.get(lesson.id);
    if (
      before &&
      before.subject_id !== subjectId &&
      (db
        .prepare(
          "SELECT 1 FROM subject_concepts WHERE json_extract(value,'$.lessonId')=? LIMIT 1",
        )
        .get(lesson.id) ||
        db
          .prepare(
            "SELECT 1 FROM learning_evidence WHERE conversation_id=? LIMIT 1",
          )
          .get(lesson.id) ||
        db
          .prepare(
            "SELECT 1 FROM subject_memory WHERE json_extract(value,'$.conversationId')=? LIMIT 1",
          )
          .get(lesson.id) ||
        db
          .prepare(
            "SELECT 1 FROM conversation_summaries WHERE conversation_id=? LIMIT 1",
          )
          .get(lesson.id) ||
        db
          .prepare(
            "SELECT 1 FROM subject_records r JOIN messages m ON m.lesson_id=? WHERE r.subject_id=? AND r.archived=0 AND ((r.kind='visual' AND (json_extract(r.value,'$.originMessageId')=m.id OR EXISTS(SELECT 1 FROM json_each(m.value,'$.visualInstanceIds') v WHERE v.value=r.id))) OR (r.kind='chapter' AND EXISTS(SELECT 1 FROM json_each(r.value,'$.originMessageIds') v WHERE v.value=m.id))) LIMIT 1",
          )
          .get(lesson.id, before.subject_id))
    )
      throw new Error(
        "This conversation has subject learning evidence. Resolve or relink its concepts, saved visuals and source records before moving it to another subject. Existing work was preserved.",
      );
    if (!before) {
      db.prepare(
        "INSERT INTO conversations(id,subject_id,legacy_lesson_id,title,position,value,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)",
      ).run(
        lesson.id,
        subjectId,
        lesson.id,
        lesson.title,
        lesson.position,
        value,
        lesson.createdAt || now,
        lesson.updatedAt || now,
      );
      indexSubjectEntity(
        db,
        subjectId,
        "conversation",
        lesson.id,
        lesson.title,
        lesson.objective + " " + lesson.notes,
      );
    } else if (before.value !== value || before.subject_id !== subjectId) {
      db.prepare(
        "UPDATE conversations SET subject_id=?,title=?,position=?,value=?,version=version+1,updated_at=? WHERE id=?",
      ).run(
        subjectId,
        lesson.title,
        lesson.position,
        value,
        lesson.updatedAt || now,
        lesson.id,
      );
      if (before.subject_id !== subjectId)
        db.prepare(
          "DELETE FROM subject_search WHERE entity='conversation' AND record_id=?",
        ).run(lesson.id);
      indexSubjectEntity(
        db,
        subjectId,
        "conversation",
        lesson.id,
        lesson.title,
        lesson.objective + " " + lesson.notes,
      );
    }
    if (lesson.curriculumNodeId)
      db.prepare(
        "UPDATE conversations SET curriculum_node_id=? WHERE id=? AND curriculum_node_id IS NOT ?",
      ).run(lesson.curriculumNodeId, lesson.id, lesson.curriculumNodeId);
  }
  for (const lesson of data.lessons)
    if (lesson.parentConversationId) {
      const parent = db
        .prepare("SELECT subject_id FROM conversations WHERE id=?")
        .get(lesson.parentConversationId) as { subject_id: string } | undefined;
      if (!parent || parent.subject_id !== subjectsByLesson.get(lesson.id))
        throw new Error(
          "A conversation branch must have a parent in the same subject.",
        );
      db.prepare(
        "UPDATE conversations SET parent_id=?,branch_message_id=? WHERE id=? AND (parent_id IS NOT ? OR branch_message_id IS NOT ?)",
      ).run(
        lesson.parentConversationId,
        lesson.branchMessageId || null,
        lesson.id,
        lesson.parentConversationId,
        lesson.branchMessageId || null,
      );
    }
  const indexed = new Map(
    (
      db
        .prepare(
          "SELECT subject_id,entity,record_id,title,body FROM subject_search",
        )
        .all() as {
        subject_id: string;
        entity: string;
        record_id: string;
        title: string;
        body: string;
      }[]
    ).map((row) => [
      row.subject_id + "|" + row.entity + "|" + row.record_id,
      row,
    ]),
  );
  const indexChanged = (
    subjectId: string,
    kind: string,
    id: string,
    title: string,
    body: string,
  ) => {
    const before = indexed.get(subjectId + "|" + kind + "|" + id);
    if (
      !before ||
      before.title !== title ||
      before.body !== body.slice(0, 2_000_000)
    )
      indexSubjectEntity(db, subjectId, kind, id, title, body);
  };
  for (const lesson of data.lessons) {
    const subjectId = subjectsByLesson.get(lesson.id)!;
    for (const message of lesson.messages || []) {
      indexChanged(
        subjectId,
        "message",
        message.id,
        lesson.title + " · " + message.role,
        [
          message.text,
          ...(message.blocks || []).map((block) => JSON.stringify(block)),
        ].join(" "),
      );
      const equations = (message.blocks || []).filter(
        (block) => block.type === "equation",
      );
      if (equations.length)
        indexChanged(
          subjectId,
          "equation",
          message.id,
          lesson.title + " · equations",
          equations.map((block) => JSON.stringify(block)).join(" "),
        );
      const figures = (message.blocks || []).filter((block) =>
        [
          "diagram",
          "plot",
          "molecule",
          "image",
          "knowledge-graph",
          "chemical",
        ].includes(block.type),
      );
      if (figures.length)
        indexChanged(
          subjectId,
          "figure",
          message.id,
          lesson.title + " · figures",
          figures.map((block) => JSON.stringify(block)).join(" "),
        );
    }
  }
  if (!options.partial) {
    const validMessages = new Set(
        data.lessons.flatMap((lesson) =>
          lesson.messages.map((message) => message.id),
        ),
      ),
      validEquations = new Set(
        data.lessons.flatMap((lesson) =>
          lesson.messages
            .filter((message) =>
              message.blocks?.some((block) => block.type === "equation"),
            )
            .map((message) => message.id),
        ),
      ),
      validFigures = new Set(
        data.lessons.flatMap((lesson) =>
          lesson.messages
            .filter((message) =>
              message.blocks?.some((block) =>
                [
                  "diagram",
                  "plot",
                  "molecule",
                  "image",
                  "knowledge-graph",
                  "chemical",
                ].includes(block.type),
              ),
            )
            .map((message) => message.id),
        ),
      ),
      validLibrary = new Set(data.library.map((item) => item.id));
    for (const row of db
      .prepare(
        "SELECT subject_id,entity,record_id FROM subject_search WHERE entity IN ('message','equation','figure','document','reference','note')",
      )
      .all() as { subject_id: string; entity: string; record_id: string }[]) {
      const stale =
        row.entity === "message"
          ? !validMessages.has(row.record_id)
          : row.entity === "equation"
            ? !validEquations.has(row.record_id)
            : row.entity === "figure"
              ? !validFigures.has(row.record_id)
              : !validLibrary.has(row.record_id) &&
                !db
                  .prepare(
                    "SELECT 1 FROM subject_records WHERE id=? AND subject_id=? AND archived=0",
                  )
                  .get(row.record_id, row.subject_id);
      if (stale)
        db.prepare(
          "DELETE FROM subject_search WHERE subject_id=? AND entity=? AND record_id=?",
        ).run(row.subject_id, row.entity, row.record_id);
    }
  }
  for (const item of data.library) {
    const subjectId = resolve(
      item.kind === "subject" ? item.title : item.subject || "General",
      item.subjectId,
      item.createdAt || now,
    );
    indexChanged(
      subjectId,
      item.kind === "document"
        ? "document"
        : item.kind === "reference"
          ? "reference"
          : "note",
      item.id,
      item.title,
      item.content,
    );
  }
  const concepts = new Map(
    (
      db
        .prepare("SELECT subject_id,concept_id,value FROM subject_concepts")
        .all() as { subject_id: string; concept_id: string; value: string }[]
    ).map((row) => [row.subject_id + "|" + row.concept_id, row]),
  );
  const linked = new Map<string, string[]>();
  for (const row of concepts.values()) {
    const list = linked.get(row.concept_id) || [];
    list.push(row.subject_id);
    linked.set(row.concept_id, list);
  }
  const revisions = new Map<
    string,
    {
      entity: "concept" | "curriculum";
      id: string;
      before: unknown;
      after: unknown;
    }[]
  >();
  for (const concept of data.concepts) {
    const targets =
      concept.subjectId && subjectExists.get(concept.subjectId)
        ? [concept.subjectId]
        : concept.lessonId
          ? [
              subjectsByLesson.get(concept.lessonId) ||
                resolveLegacySubject(db, "General", now),
            ]
          : linked.get(concept.id) || [
              resolveLegacySubject(db, "General", now),
            ];
    for (const subjectId of targets) {
      const before = concepts.get(subjectId + "|" + concept.id),
        previous = before ? JSON.parse(before.value) : undefined;
      if (
        previous &&
        previous.label === concept.label &&
        previous.status === concept.status &&
        previous.evidence === concept.evidence &&
        previous.notes === concept.notes &&
        previous.lessonId === concept.lessonId
      )
        continue;
      const record = {
        id: concept.id,
        subjectId,
        label: concept.label,
        status: concept.status,
        coverage: previous?.coverage || "not-started",
        evidence: concept.evidence,
        notes: concept.notes,
        lessonId: concept.lessonId,
        revision: (previous?.revision || 0) + 1,
        createdAt: previous?.createdAt || now,
        updatedAt: now,
      };
      const value = JSON.stringify(record);
      db.prepare(
        "INSERT INTO subject_concepts(subject_id,concept_id,version,value,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(subject_id,concept_id) DO UPDATE SET value=excluded.value,version=excluded.version,updated_at=excluded.updated_at",
      ).run(subjectId, concept.id, record.revision, value, now);
      if (concept.subjectId) {
        const canonical = {
          ...concept,
          subjectRevision: record.revision,
          updatedAt: now,
        };
        db.prepare("UPDATE concepts SET value=? WHERE id=?").run(
          JSON.stringify(canonical),
          concept.id,
        );
      }
      indexSubjectEntity(
        db,
        subjectId,
        "concept",
        concept.id,
        concept.label,
        [concept.evidence, concept.notes].filter(Boolean).join(" "),
      );
      const changes = revisions.get(subjectId) || [];
      changes.push({
        entity: "concept",
        id: concept.id,
        before: previous || null,
        after: record,
      });
      revisions.set(subjectId, changes);
      if (!previous || previous.status !== concept.status) {
        for (const row of db
          .prepare(
            "SELECT id,value FROM curriculum_nodes WHERE subject_id=? AND concept_id=?",
          )
          .all(subjectId, concept.id) as { id: string; value: string }[]) {
          const node = JSON.parse(row.value);
          const nextStatus =
            concept.status === "demonstrated" && concept.evidence.trim()
              ? "demonstrated"
              : concept.status === "partial"
                ? "partial"
                : concept.status === "review"
                  ? "review"
                  : concept.status === "misconception"
                    ? "gap"
                    : node.status === "demonstrated"
                      ? "covered"
                      : node.status;
          if (nextStatus !== node.status) {
            const next = {
              ...node,
              status: nextStatus,
              revision: node.revision + 1,
              updatedAt: now,
            };
            db.prepare(
              "UPDATE curriculum_nodes SET status=?,version=?,value=?,updated_at=? WHERE id=?",
            ).run(nextStatus, next.revision, JSON.stringify(next), now, row.id);
            changes.push({
              entity: "curriculum",
              id: row.id,
              before: node,
              after: next,
            });
          }
        }
      }
      if (
        concept.evidence &&
        (!previous ||
          previous.evidence !== concept.evidence ||
          previous.status !== concept.status)
      ) {
        const evidenceId =
          "legacy-evidence-" +
          createHash("sha256")
            .update(subjectId + "|" + concept.id + "|" + value)
            .digest("hex")
            .slice(0, 32);
        db.prepare(
          "INSERT OR IGNORE INTO learning_evidence(id,subject_id,concept_id,conversation_id,kind,claim,value,created_at) VALUES(?,?,?,?,?,?,?,?)",
        ).run(
          evidenceId,
          subjectId,
          concept.id,
          concept.lessonId || null,
          "manual",
          concept.evidence.slice(0, 20000),
          JSON.stringify({
            status: concept.status,
            source: "legacy-learning-record",
            verified: false,
          }),
          now,
        );
      }
    }
  }
  const cards = new Map(
    (data.reviewCards || []).map((card) => [card.id, card]),
  );
  for (const attempt of data.reviewHistory || []) {
    const card = cards.get(attempt.cardId);
    if (!card?.conceptId) continue;
    const scopes = (
      db
        .prepare("SELECT subject_id FROM subject_concepts WHERE concept_id=?")
        .all(card.conceptId) as { subject_id: string }[]
    ).map((row) => row.subject_id);
    for (const subjectId of scopes) {
      const evidenceId = "review-evidence-" + attempt.id + "-" + subjectId;
      if (
        db.prepare("SELECT 1 FROM learning_evidence WHERE id=?").get(evidenceId)
      )
        continue;
      const verified = attempt.correct !== null && attempt.method !== "rubric";
      const claim =
        `${verified ? "Deterministic " + attempt.method + " check" : "Learner-reviewed practice"}: ${attempt.correct === true ? "correct" : attempt.correct === false ? "needs correction" : "self-assessed"}. ${attempt.feedback}`.slice(
          0,
          20000,
        );
      db.prepare(
        "INSERT INTO learning_evidence(id,subject_id,concept_id,conversation_id,kind,claim,value,created_at) VALUES(?,?,?,?,?,?,?,?)",
      ).run(
        evidenceId,
        subjectId,
        card.conceptId,
        card.lessonId || null,
        "review",
        claim,
        JSON.stringify({
          id: evidenceId,
          subjectId,
          conceptId: card.conceptId,
          kind: "review",
          content: claim,
          conversationId: card.lessonId,
          reviewAttemptId: attempt.id,
          correct: attempt.correct,
          method: attempt.method,
          verified,
          createdAt: attempt.createdAt,
        }),
        attempt.createdAt,
      );
    }
  }
  for (const [subjectId, changes] of revisions) {
    const subject = db
      .prepare("SELECT version FROM subjects WHERE id=?")
      .get(subjectId) as { version: number };
    const revisionId =
      "legacy-revision-" +
      createHash("sha256")
        .update(subjectId + "|" + JSON.stringify(changes) + "|" + now)
        .digest("hex")
        .slice(0, 32);
    const parent = db
      .prepare(
        "SELECT id FROM subject_revisions WHERE subject_id=? ORDER BY version DESC LIMIT 1",
      )
      .get(subjectId) as { id: string } | undefined;
    db.prepare(
      "UPDATE subjects SET version=version+1,updated_at=? WHERE id=?",
    ).run(now, subjectId);
    db.prepare(
      "INSERT INTO subject_revisions(id,subject_id,version,parent_id,kind,actor,reason,operations,created_at) VALUES(?,?,?,?,?,?,?,?,?)",
    ).run(
      revisionId,
      subjectId,
      subject.version + 1,
      parent?.id || null,
      "apply",
      "learner",
      "Synchronize learning evidence",
      JSON.stringify(changes),
      now,
    );
  }
}
export function migrateSubjectSchema(db: Database.Database) {
  createSubjectSchema(db);
  const read = (table: string) =>
    (db.prepare(`SELECT value FROM ${table}`).all() as { value: string }[]).map(
      (row) => JSON.parse(row.value),
    );
  const settings = db
    .prepare("SELECT value FROM settings WHERE id='state'")
    .get() as { value: string } | undefined;
  const messages = new Map<string, unknown[]>();
  for (const row of db
    .prepare("SELECT lesson_id,value FROM messages ORDER BY lesson_id,ordinal")
    .all() as { lesson_id: string; value: string }[]) {
    const values = messages.get(row.lesson_id) || [];
    values.push(JSON.parse(row.value));
    messages.set(row.lesson_id, values);
  }
  const data = {
    ...(settings ? JSON.parse(settings.value) : {}),
    lessons: read("lessons").map((lesson) => ({
      ...lesson,
      messages: messages.get(lesson.id) || [],
    })),
    concepts: read("concepts"),
    library: read("library"),
    relations: read("relations"),
  } as StudioData;
  populateLegacySubjectState(db, data);
}
export function populateLegacySubjectState(
  db: Database.Database,
  data: StudioData,
) {
  syncLegacySubjects(db, data);
  // Preserve the original optional pathway as coverage, never inferred mastery.
  for (const lesson of data.lessons) {
    const conversation = db
      .prepare("SELECT subject_id FROM conversations WHERE id=?")
      .get(lesson.id) as { subject_id: string };
    const subjectId = conversation.subject_id,
      at = lesson.updatedAt || new Date().toISOString();
    db.prepare(
      "UPDATE subjects SET objective=? WHERE id=? AND objective=''",
    ).run((lesson.objective || lesson.title).slice(0, 20000), subjectId);
    if (!lesson.goals?.length) continue;
    const moduleId =
      "legacy-module-" +
      createHash("sha256").update(lesson.id).digest("hex").slice(0, 24);
    const module = {
      id: moduleId,
      subjectId,
      kind: "module",
      title: lesson.title,
      description: lesson.objective.slice(0, 20000),
      position: 0,
      status: "introduced",
      userEdited: false,
      revision: 1,
      createdAt: lesson.createdAt,
      updatedAt: at,
    };
    db.prepare(
      "INSERT INTO curriculum_nodes(id,subject_id,kind,title,status,version,value,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)",
    ).run(
      moduleId,
      subjectId,
      "module",
      lesson.title,
      "introduced",
      1,
      JSON.stringify(module),
      lesson.createdAt,
      at,
    );
    indexSubjectEntity(
      db,
      subjectId,
      "curriculum",
      moduleId,
      lesson.title,
      lesson.objective,
    );
    for (const [position, goal] of lesson.goals.entries()) {
      const nodeId =
          "legacy-goal-" +
          createHash("sha256")
            .update(lesson.id + "|" + goal.id)
            .digest("hex")
            .slice(0, 24),
        state =
          goal.status === "visited"
            ? "covered"
            : goal.status === "current"
              ? "introduced"
              : "not-started",
        node = {
          id: nodeId,
          subjectId,
          parentId: moduleId,
          kind: "topic",
          title: goal.title,
          description:
            "Migrated optional lesson goal. Original prerequisites remain in the saved lesson.",
          position,
          status: state,
          userEdited: false,
          revision: 1,
          createdAt: lesson.createdAt,
          updatedAt: at,
        };
      db.prepare(
        "INSERT INTO curriculum_nodes(id,subject_id,parent_id,kind,title,status,ordinal,version,value,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
      ).run(
        nodeId,
        subjectId,
        moduleId,
        "topic",
        goal.title,
        state,
        position,
        1,
        JSON.stringify(node),
        lesson.createdAt,
        at,
      );
      indexSubjectEntity(
        db,
        subjectId,
        "curriculum",
        nodeId,
        goal.title,
        node.description,
      );
      if (goal.status === "current")
        db.prepare("UPDATE subjects SET current_node_id=? WHERE id=?").run(
          nodeId,
          subjectId,
        );
    }
  }
}
