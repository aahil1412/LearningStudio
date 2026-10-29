import Database from "better-sqlite3";
import { z } from "zod";
import type { StudioData } from "../src/types";
import { defaultData } from "../src/lib/defaults";
import { validateContentBlock } from "../src/lib/visualSpecs";
import { resolve } from "node:path";
import {
  libraryHierarchyProblems,
  gradingSchema,
  removeLessonReferences,
} from "../src/lib/learning";
import {
  existsSync,
  openSync,
  writeFileSync,
  fsyncSync,
  closeSync,
} from "node:fs";
import { randomUUID, createHash } from "node:crypto";
import {
  migrateSubjectSchema,
  syncLegacySubjects,
  validateNormalizedSubjects,
  normalizedSubjectTables,
  populateLegacySubjectState,
} from "./subject-schema";
import { migrateV21Schema, v21Tables } from "./v21-schema";
import { teachingPreferencesSchema, validatePlanningData } from "./planning";
import { validateAnnotationData, reindexAnnotations } from "./annotations";

const id = z.string().min(1).max(200);
const bounded = z.string().max(2_000_000);
const mode = z.enum(["Learn", "Explore", "Deep Dive", "Practice", "Review"]);
const lesson = z.object({
  id,
  title: z.string().max(300),
  subject: z.string().max(300),
  subjectId: id.optional(),
  curriculumNodeId: id.optional(),
  parentConversationId: id.optional(),
  branchMessageId: id.optional(),
  mode,
  objective: bounded,
  position: bounded,
  messages: z
    .array(
      z.object({
        id,
        role: z.enum(["user", "assistant"]),
        text: bounded,
        content: z
          .array(z.unknown())
          .max(100)
          .transform((items) =>
            items.map(validateContentBlock).filter((item) => item !== null),
          )
          .optional(),
        blocks: z
          .array(z.unknown())
          .max(100)
          .transform((items) =>
            items.map(validateContentBlock).filter((item) => item !== null),
          )
          .optional(),
        createdAt: z.string(),
        status: z.enum(["complete", "partial", "failed"]).optional(),
        error: z.string().max(1000).optional(),
        visualInstanceIds: z.array(id).max(100).optional(),
        sources: z
          .array(
            z.object({
              documentId: id,
              title: z.string().max(500),
              page: z.number().int().min(1).optional(),
              citation: z.string().max(1000),
              text: z.string().max(6000),
            }),
          )
          .max(12)
          .optional(),
      }),
    )
    .max(10000),
  notes: bounded,
  createdAt: z.string(),
  updatedAt: z.string(),
  example: z.boolean().optional(),
  readingProgress: z.number().min(0).max(1).optional(),
  studyView: z
    .object({ mode: z.enum(["lesson", "history"]), messageId: id.optional() })
    .optional(),
  goals: z
    .array(
      z.object({
        id,
        title: z.string().max(300),
        status: z.enum(["planned", "current", "visited"]),
        prerequisites: z.array(z.string().max(200)).max(10),
      }),
    )
    .max(20)
    .optional(),
  exerciseResponses: z
    .record(
      z.string().max(300),
      z.object({ answer: z.string().max(30000), skipped: z.boolean() }),
    )
    .optional(),
});
const schema = z.object({
  version: z.literal(1),
  lessons: z.array(lesson).max(10000),
  concepts: z
    .array(
      z.object({
        id,
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
        evidence: bounded,
        lessonId: z.string().optional(),
        subjectId: id.optional(),
        subjectRevision: z.number().int().min(1).optional(),
        updatedAt: z.string().optional(),
        notes: bounded.optional(),
        position: z
          .object({
            x: z.number().finite().min(-100000).max(100000),
            y: z.number().finite().min(-100000).max(100000),
          })
          .optional(),
      }),
    )
    .max(10000),
  relations: z
    .array(
      z.object({
        id,
        source: id,
        target: id,
        kind: z.enum([
          "prerequisite",
          "related",
          "application",
          "analogy",
          "cross-disciplinary",
        ]),
      }),
    )
    .max(30000),
  library: z
    .array(
      z.object({
        id,
        title: z.string().max(500),
        kind: z.enum([
          "note",
          "document",
          "reference",
          "practice",
          "course",
          "topic",
          "subject",
        ]),
        subject: z.string().max(300),
        subjectId: id.optional(),
        sourceAssetId: id.optional(),
        content: bounded,
        createdAt: z.string(),
        source: z.string().optional(),
        parentId: id.optional(),
        lessonIds: z.array(id).max(10000).optional(),
        verified: z.boolean().optional(),
        pages: z
          .array(z.object({ page: z.number().int().min(1), text: bounded }))
          .max(2000)
          .optional(),
        figures: z
          .array(
            z.object({
              id,
              page: z.number().int().min(1),
              dataUrl: z
                .string()
                .max(5_000_000)
                .regex(/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/),
              caption: z.string().max(2000).optional(),
            }),
          )
          .max(200)
          .optional(),
        citations: z
          .array(
            z.object({
              text: z.string().max(2000),
              doi: z.string().max(500).optional(),
              url: z.string().max(2000).optional(),
            }),
          )
          .max(100)
          .optional(),
        warnings: z.array(z.string().max(2000)).max(1000).optional(),
      }),
    )
    .max(10000),
  settings: z.object({
    personalization: z.boolean(),
    profile: z.string().max(20000),
    assessments: z.boolean(),
    backgroundConsent: z.boolean(),
    planUsageAcknowledged: z.boolean().optional(),
    backgroundOnClose: z.boolean().optional(),
    updates: z
      .object({ feedUrl: z.string().max(1000), autoCheck: z.boolean() })
      .optional(),
    models: z.object({
      tutor: z.object({ model: z.string(), reasoning: z.string() }),
      visual: z.object({ model: z.string(), reasoning: z.string() }),
      review: z.object({ model: z.string(), reasoning: z.string() }),
    }),
    planning: z
      .object({ model: z.string().max(200), reasoning: z.string().max(100) })
      .optional(),
    modelProfileId: z
      .string()
      .regex(/^[\w-]{1,80}$/)
      .optional(),
    modelProfiles: z
      .record(
        z.string().regex(/^[\w-]{1,80}$/),
        z.object({
          models: z.object({
            tutor: z.object({
              model: z.string().max(200),
              reasoning: z.string().max(100),
            }),
            visual: z.object({
              model: z.string().max(200),
              reasoning: z.string().max(100),
            }),
            review: z.object({
              model: z.string().max(200),
              reasoning: z.string().max(100),
            }),
          }),
          planning: z
            .object({
              model: z.string().max(200),
              reasoning: z.string().max(100),
            })
            .optional(),
        }),
      )
      .refine((value) => Object.keys(value).length <= 40)
      .optional(),
    leftWidth: z.number().min(180).max(440),
    rightWidth: z.number().min(280).max(700),
    labOpen: z.boolean(),
    visualizationPlacement: z
      .enum(["auto", "inline", "side", "split"])
      .optional(),
    subjectOrder: z.array(id).max(10000).optional(),
    teaching: teachingPreferencesSchema.optional(),
  }),
  appearance: z.unknown(),
  activeLessonId: z.string().optional(),
  activeSubjectId: id.optional(),
  reviewCards: z
    .array(
      z.object({
        id,
        collectionId: id.optional(),
        conceptId: id.optional(),
        lessonId: id.optional(),
        subjectId: id.optional(),
        question: z.string().min(1).max(10000),
        answer: z.string().max(30000),
        grading: gradingSchema,
        dueAt: z.string().datetime(),
        intervalDays: z.number().finite().min(0).max(100000),
        repetitions: z.number().int().min(0),
        easeFactor: z.number().finite().min(1.3).max(10),
        lapses: z.number().int().min(0),
        createdAt: z.string(),
      }),
    )
    .max(20000)
    .optional(),
  reviewHistory: z
    .array(
      z.object({
        id,
        cardId: id,
        subjectId: id.optional(),
        answer: z.string().max(30000),
        grade: z.number().int().min(0).max(5),
        correct: z.boolean().nullable(),
        feedback: z.string().max(10000),
        method: z.enum(["numeric", "symbolic", "exact", "rubric"]),
        createdAt: z.string(),
        rubricChecks: z.record(z.string().max(200), z.boolean()).optional(),
      }),
    )
    .max(50000)
    .optional(),
  knowledgeSuggestions: z
    .array(
      z.object({
        id,
        lessonId: id.optional(),
        subjectId: id.optional(),
        conceptLabel: z.string().min(1).max(500),
        proposedStatus: z.enum([
          "encountered",
          "unassessed",
          "partial",
          "demonstrated",
          "misconception",
          "review",
          "unresolved",
        ]),
        evidence: bounded,
        reason: z.string().max(5000),
        state: z.enum(["pending", "accepted", "dismissed"]),
        createdAt: z.string(),
      }),
    )
    .max(10000)
    .optional(),
  graphHistory: z
    .object({
      past: z.array(z.unknown()).max(30),
      future: z.array(z.unknown()).max(30),
    })
    .optional(),
  backgroundTasks: z
    .array(
      z.object({
        id,
        kind: z.enum(["review", "lesson", "summary", "research"]),
        prompt: z.string().min(1).max(30000),
        lessonId: id.optional(),
        model: z.string().max(200),
        reasoning: z.string().max(30).optional(),
        nextRunAt: z.string().datetime(),
        intervalMinutes: z.number().min(5).max(525600).optional(),
        enabled: z.boolean(),
        status: z.enum([
          "scheduled",
          "running",
          "complete",
          "failed",
          "cancelled",
        ]),
        result: z.string().max(2_000_000).optional(),
        error: z.string().max(1000).optional(),
        createdAt: z.string().datetime(),
        updatedAt: z.string().datetime(),
        completedAt: z.string().datetime().optional(),
      }),
    )
    .max(1000)
    .optional(),
});
export function validateStudioData(value: unknown): StudioData {
  const serialized = JSON.stringify(value);
  if (!serialized) throw new Error("Choose a valid Learning Studio export.");
  if (Buffer.byteLength(serialized, "utf8") > 50_000_000)
    throw new Error("Library exceeds the 50 MB import limit.");
  const data = schema.parse(value) as StudioData;
  for (const snapshot of [
    ...(data.graphHistory?.past || []),
    ...(data.graphHistory?.future || []),
  ]) {
    const graph = z
      .object({
        concepts: schema.shape.concepts,
        relations: schema.shape.relations,
      })
      .parse(snapshot);
    const ids = new Set(graph.concepts.map((c) => c.id));
    if (graph.relations.some((r) => !ids.has(r.source) || !ids.has(r.target)))
      throw new Error("Graph history contains a missing concept.");
  }
  const reviewIds = new Set((data.reviewCards || []).map((card) => card.id));
  if (reviewIds.size !== (data.reviewCards || []).length)
    throw new Error("Duplicate review card identifiers.");
  for (const attempt of data.reviewHistory || [])
    if (!reviewIds.has(attempt.cardId))
      throw new Error("A review attempt refers to a missing practice card.");
  for (const list of [
    data.lessons,
    data.concepts,
    data.relations,
    data.library,
  ])
    if (new Set(list.map((v) => v.id)).size !== list.length)
      throw new Error("Duplicate record identifiers.");
  const messages = data.lessons.flatMap((item) => item.messages);
  if (new Set(messages.map((item) => item.id)).size !== messages.length)
    throw new Error("Duplicate message identifiers.");
  const concepts = new Set(data.concepts.map((item) => item.id));
  if (
    data.relations.some(
      (item) => !concepts.has(item.source) || !concepts.has(item.target),
    )
  )
    throw new Error("A knowledge connection refers to a missing concept.");
  const lessons = new Set(data.lessons.map((item) => item.id));
  if (data.activeLessonId && !lessons.has(data.activeLessonId))
    throw new Error("The active lesson refers to a missing lesson.");
  if (
    data.concepts.some((item) => item.lessonId && !lessons.has(item.lessonId))
  )
    throw new Error("A concept refers to a missing lesson.");
  const hierarchyErrors = libraryHierarchyProblems(data.library, lessons);
  if (hierarchyErrors.length) throw new Error(hierarchyErrors[0]);
  return data;
}
export class StudioStore {
  readonly db: Database.Database;
  readonly migrationBackupPath?: string;
  constructor(path: string, options: { readonly?: boolean } = {}) {
    const existed = path !== ":memory:" && existsSync(path);
    this.db = new Database(path, {
      readonly: options.readonly ?? false,
      fileMustExist: options.readonly ?? false,
    });
    try {
      const version = this.db.pragma("user_version", {
        simple: true,
      }) as number;
      if (version > 4)
        throw new Error(
          "This library was created by a newer Learning Studio version.",
        );
      if (options.readonly && ![1, 2, 3, 4].includes(version))
        throw new Error("This file is not a supported Learning Studio backup.");
      if (!options.readonly && existed && version >= 1 && version < 4) {
        this.migrationBackupPath =
          path +
          ".pre-v4-" +
          new Date().toISOString().replace(/[:.]/g, "-") +
          "-" +
          randomUUID().slice(0, 8) +
          ".sqlite";
        const handle = openSync(this.migrationBackupPath, "wx", 0o600);
        try {
          writeFileSync(handle, this.db.serialize());
          fsyncSync(handle);
        } finally {
          closeSync(handle);
        }
      }
      if (!options.readonly) this.db.pragma("journal_mode = WAL");
      this.db.pragma("foreign_keys = ON");
      if (version < 1)
        this.db.transaction(() => {
          this.db.exec(
            `CREATE TABLE settings (id TEXT PRIMARY KEY, value TEXT NOT NULL); CREATE TABLE lessons (id TEXT PRIMARY KEY, value TEXT NOT NULL); CREATE TABLE messages (id TEXT PRIMARY KEY, lesson_id TEXT NOT NULL REFERENCES lessons(id) ON DELETE CASCADE, ordinal INTEGER NOT NULL, value TEXT NOT NULL); CREATE TABLE concepts (id TEXT PRIMARY KEY, value TEXT NOT NULL); CREATE TABLE relations (id TEXT PRIMARY KEY, value TEXT NOT NULL); CREATE TABLE library (id TEXT PRIMARY KEY, value TEXT NOT NULL); CREATE TABLE migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL); INSERT INTO migrations VALUES (1, datetime('now')); PRAGMA user_version=1;`,
          );
        })();
      if (!options.readonly && version < 2)
        this.db.transaction(() => {
          this.db.exec(
            `CREATE VIRTUAL TABLE search_index USING fts5(record_id UNINDEXED, entity UNINDEXED, title, body, tokenize='unicode61'); CREATE INDEX messages_lesson_ordinal ON messages(lesson_id,ordinal); INSERT INTO migrations VALUES (2,datetime('now')); PRAGMA user_version=2;`,
          );
          for (const table of ["lessons", "library"])
            for (const row of this.db
              .prepare(`SELECT id,value FROM ${table}`)
              .all() as { id: string; value: string }[]) {
              const v = JSON.parse(row.value);
              this.db
                .prepare(
                  "INSERT INTO search_index(record_id,entity,title,body) VALUES(?,?,?,?)",
                )
                .run(
                  row.id,
                  table,
                  v.title || "",
                  v.content || v.objective || "",
                );
            }
        })();
      if (!options.readonly && version < 3)
        this.db.transaction(() => migrateSubjectSchema(this.db))();
      if (!options.readonly && version < 4)
        this.db.transaction(() => migrateV21Schema(this.db))();
    } catch (error) {
      this.db.close();
      throw error;
    }
  }
  load(): StudioData {
    const get = (table: string) =>
      (
        this.db.prepare(`SELECT value FROM ${table}`).all() as {
          value: string;
        }[]
      ).map((r) => JSON.parse(r.value));
    const settings = this.db
      .prepare("SELECT value FROM settings WHERE id='state'")
      .get() as { value: string } | undefined;
    const data = {
      ...defaultData(),
      ...(settings ? JSON.parse(settings.value) : {}),
      lessons: get("lessons"),
      concepts: get("concepts"),
      relations: get("relations"),
      library: get("library"),
    };
    const grouped = new Map<string, unknown[]>();
    for (const row of this.db
      .prepare(
        "SELECT lesson_id,value FROM messages ORDER BY lesson_id,ordinal",
      )
      .all() as { lesson_id: string; value: string }[]) {
      const list = grouped.get(row.lesson_id) || [];
      list.push(JSON.parse(row.value));
      grouped.set(row.lesson_id, list);
    }
    for (const l of data.lessons) l.messages = grouped.get(l.id) || [];
    return validateStudioData(data);
  }
  save(input: unknown) {
    let data = validateStudioData(input);
    for (const row of this.db
      .prepare("SELECT id FROM conversation_tombstones")
      .all() as { id: string }[])
      if (data.lessons.some((lesson) => lesson.id === row.id))
        data = removeLessonReferences(data, row.id);
    const managedConcepts = new Map(
      (
        this.db.prepare("SELECT id,value FROM concepts").all() as {
          id: string;
          value: string;
        }[]
      ).flatMap((row) => {
        const value = JSON.parse(row.value);
        return value.subjectId && value.subjectRevision
          ? [[row.id, value] as const]
          : [];
      }),
    );
    data.concepts = data.concepts.map((concept) => {
      const current = managedConcepts.get(concept.id);
      if (!current) return concept;
      if (
        (concept as unknown as { subjectRevision?: number }).subjectRevision !==
        current.subjectRevision
      )
        return current;
      if (concept.subjectId && concept.subjectId !== current.subjectId)
        throw new Error(
          "A managed concept cannot change subjects through a legacy save. Relink its curriculum and evidence explicitly before transferring ownership.",
        );
      return { ...concept, subjectId: current.subjectId };
    });
    for (const [conceptId, concept] of managedConcepts)
      if (!data.concepts.some((value) => value.id === conceptId))
        data.concepts.push(concept);
    const protectedLessons = new Set(
      (
        this.db
          .prepare(
            "SELECT id FROM conversations WHERE parent_id IS NOT NULL OR id IN (SELECT parent_id FROM conversations WHERE parent_id IS NOT NULL)",
          )
          .all() as { id: string }[]
      ).map((row) => row.id),
    );
    const incomingLessons = new Set(data.lessons.map((lesson) => lesson.id));
    for (const row of this.db.prepare("SELECT id,value FROM lessons").all() as {
      id: string;
      value: string;
    }[]) {
      const value = JSON.parse(row.value);
      if (
        !incomingLessons.has(row.id) &&
        (value.subjectId || protectedLessons.has(row.id))
      ) {
        value.messages = (
          this.db
            .prepare(
              "SELECT value FROM messages WHERE lesson_id=? ORDER BY ordinal",
            )
            .all(row.id) as { value: string }[]
        ).map((message) => JSON.parse(message.value));
        data.lessons.push(value);
      }
    }
    const requiredPrefixes = new Map<string, number>();
    for (const row of this.db
      .prepare(
        "SELECT m.lesson_id,m.ordinal FROM conversations c JOIN messages m ON c.branch_message_id=m.id WHERE c.parent_id IS NOT NULL",
      )
      .all() as { lesson_id: string; ordinal: number }[])
      requiredPrefixes.set(
        row.lesson_id,
        Math.max(requiredPrefixes.get(row.lesson_id) ?? -1, row.ordinal),
      );
    for (const [lessonId, through] of requiredPrefixes) {
      const lesson = data.lessons.find((value) => value.id === lessonId);
      if (!lesson) continue;
      const prefix = (
        this.db
          .prepare(
            "SELECT value FROM messages WHERE lesson_id=? AND ordinal<=? ORDER BY ordinal",
          )
          .all(lessonId, through) as { value: string }[]
      ).map((row) => JSON.parse(row.value));
      const prefixIds = new Set(prefix.map((message) => message.id));
      if (
        prefix.some(
          (message) =>
            !lesson.messages.some((incoming) => incoming.id === message.id),
        )
      ) {
        const incoming = new Map(
          lesson.messages.map((message) => [message.id, message]),
        );
        lesson.messages = [
          ...prefix.map((message) => incoming.get(message.id) || message),
          ...lesson.messages.filter((message) => !prefixIds.has(message.id)),
        ];
      }
    }
    validateStudioData(data);
    // A stale renderer snapshot cannot overwrite a newer scheduler result.
    const current = this.db
      .prepare("SELECT value FROM settings WHERE id='state'")
      .get() as { value: string } | undefined;
    const tasks = current
      ? JSON.parse(current.value).backgroundTasks || []
      : [];
    if (data.backgroundTasks)
      data.backgroundTasks = data.backgroundTasks.map((task) => {
        const previous = tasks.find((t: any) => t.id === task.id);
        return previous && previous.updatedAt > task.updatedAt
          ? previous
          : task;
      });
    this.db.transaction(() => {
      const sync = (
        table: string,
        rows: { id: string; [key: string]: any }[],
      ) => {
        const existing = new Map(
          (
            this.db.prepare(`SELECT id,value FROM ${table}`).all() as {
              id: string;
              value: string;
            }[]
          ).map((r) => [r.id, r.value]),
        );
        const put = this.db.prepare(
          `INSERT INTO ${table}(id,value) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value`,
        );
        const remove = this.db.prepare(`DELETE FROM ${table} WHERE id=?`);
        for (const row of rows) {
          const text = JSON.stringify(row),
            before = existing.get(row.id);
          if (text !== before) {
            put.run(row.id, text);
            if (table === "lessons" || table === "library") {
              this.db
                .prepare(
                  "DELETE FROM search_index WHERE record_id=? AND entity=?",
                )
                .run(row.id, table);
              this.db
                .prepare(
                  "INSERT INTO search_index(record_id,entity,title,body) VALUES(?,?,?,?)",
                )
                .run(
                  row.id,
                  table,
                  row.title || "",
                  row.content || row.objective || "",
                );
            }
          }
          existing.delete(row.id);
        }
        for (const id of existing.keys()) {
          remove.run(id);
          if (table === "lessons" || table === "library")
            this.db
              .prepare(
                "DELETE FROM search_index WHERE record_id=? AND entity=?",
              )
              .run(id, table);
        }
      };
      sync(
        "lessons",
        data.lessons.map(({ messages: _m, ...rest }) => rest),
      );
      const existing = new Map(
        (
          this.db
            .prepare("SELECT id,lesson_id,ordinal,value FROM messages")
            .all() as {
            id: string;
            lesson_id: string;
            ordinal: number;
            value: string;
          }[]
        ).map((r) => [r.id, r]),
      );
      const putMessage = this.db.prepare(
        "INSERT INTO messages(id,lesson_id,ordinal,value) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET lesson_id=excluded.lesson_id,ordinal=excluded.ordinal,value=excluded.value",
      );
      for (const lesson of data.lessons)
        lesson.messages.forEach((message, index) => {
          const text = JSON.stringify(message),
            before = existing.get(message.id);
          if (
            !before ||
            before.value !== text ||
            before.ordinal !== index ||
            before.lesson_id !== lesson.id
          )
            putMessage.run(message.id, lesson.id, index, text);
          existing.delete(message.id);
        });
      for (const id of existing.keys())
        this.db.prepare("DELETE FROM messages WHERE id=?").run(id);
      for (const table of ["concepts", "relations", "library"] as const)
        sync(table, data[table]);
      const {
        lessons: _l,
        concepts: _c,
        relations: _r,
        library: _b,
        ...settings
      } = data;
      this.db
        .prepare("INSERT OR REPLACE INTO settings VALUES (?,?)")
        .run("state", JSON.stringify(settings));
      syncLegacySubjects(this.db, data);
    })();
  }
  search(query: string, limit = 30) {
    const terms = query.match(/[\p{L}\p{N}_]+/gu)?.slice(0, 12) || [];
    if (!terms.length) return [];
    const match = terms.map((t) => '"' + t + '"*').join(" AND ");
    return this.db
      .prepare(
        "SELECT record_id AS id,entity,title,snippet(search_index,3,'[',']','…',24) AS snippet FROM search_index WHERE search_index MATCH ? ORDER BY bm25(search_index) LIMIT ?",
      )
      .all(match, Math.min(100, Math.max(1, limit)));
  }
  updateBackgroundTask(id: string, patch: Record<string, unknown>) {
    const data = this.load();
    data.backgroundTasks = (data.backgroundTasks || []).map((task) =>
      task.id === id
        ? { ...task, ...patch, updatedAt: new Date().toISOString() }
        : task,
    );
    this.save(data);
  }
  /** Retain an original PDF inside SQLite so backups and portable archives are complete. */
  putDocumentAsset(bytes: Buffer): string {
    if (
      !Buffer.isBuffer(bytes) ||
      bytes.length > 100_000_000 ||
      bytes.length < 12 ||
      !/%PDF-\d\.\d/.test(bytes.subarray(0, 1024).toString("latin1")) ||
      !bytes
        .subarray(Math.max(0, bytes.length - 2048))
        .toString("latin1")
        .includes("%%EOF")
    )
      throw new Error("Choose a complete PDF smaller than 100 MB.");
    const assetId = createHash("sha256").update(bytes).digest("hex");
    this.db
      .prepare(
        "INSERT OR IGNORE INTO document_assets(id,mime,size,bytes,created_at) VALUES(?,'application/pdf',?,?,?)",
      )
      .run(assetId, bytes.length, bytes, new Date().toISOString());
    return assetId;
  }
  getDocumentAsset(assetId: string): Buffer | null {
    if (!/^[a-f0-9]{64}$/.test(assetId))
      throw new Error("The document asset identifier is invalid.");
    const row = this.db
      .prepare("SELECT bytes,size,mime FROM document_assets WHERE id=?")
      .get(assetId) as
      { bytes: Buffer; size: number; mime: string } | undefined;
    if (!row) return null;
    const bytes = Buffer.from(row.bytes);
    if (
      row.mime !== "application/pdf" ||
      row.size !== bytes.length ||
      bytes.length > 100_000_000 ||
      createHash("sha256").update(bytes).digest("hex") !== assetId
    )
      throw new Error("The original PDF failed its integrity check.");
    return bytes;
  }
  async backup(path: string) {
    if (
      this.db.name !== ":memory:" &&
      resolve(path).toLowerCase() === resolve(this.db.name).toLowerCase()
    )
      throw new Error(
        "Choose a backup destination different from the active library.",
      );
    await this.db.backup(path);
  }
  /** Inspect a backup without applying migrations or writing to the supplied file. */
  static readBackup(path: string): StudioData {
    const backup = new StudioStore(path, { readonly: true });
    try {
      if (backup.db.pragma("quick_check", { simple: true }) !== "ok")
        throw new Error("This backup failed its SQLite integrity check.");
      if ((backup.db.pragma("foreign_key_check") as unknown[]).length)
        throw new Error("This backup contains broken message references.");
      return backup.load();
    } finally {
      backup.close();
    }
  }
  /** A durable, consistent image is written before an explicit destructive restore. */
  checkpointBackup(reason = "restore"): string | undefined {
    if (this.db.name === ":memory:") return undefined;
    const destination =
      this.db.name +
      ".pre-" +
      reason.replace(/[^a-z0-9-]/gi, "") +
      "-" +
      new Date().toISOString().replace(/[:.]/g, "-") +
      "-" +
      randomUUID().slice(0, 8) +
      ".sqlite";
    const handle = openSync(destination, "wx", 0o600);
    try {
      writeFileSync(handle, this.db.serialize());
      fsyncSync(handle);
    } finally {
      closeSync(handle);
    }
    return destination;
  }
  /** Restore all supported tables atomically; the supplied backup is opened read-only. */
  restoreBackup(path: string): StudioData {
    if (
      this.db.name !== ":memory:" &&
      resolve(path).toLowerCase() === resolve(this.db.name).toLowerCase()
    )
      throw new Error("Choose a backup different from the active library.");
    const source = new StudioStore(path, { readonly: true });
    const legacyTables = [
      "settings",
      "lessons",
      "messages",
      "concepts",
      "relations",
      "library",
    ] as const;
    const subjectTables = normalizedSubjectTables;
    try {
      if (
        source.db.pragma("quick_check", { simple: true }) !== "ok" ||
        (source.db.pragma("foreign_key_check") as unknown[]).length
      )
        throw new Error(
          "This backup failed its integrity or relationship check.",
        );
      source.load(); // Also checks legacy JSON, lesson/message identities, reviews, and hierarchy.
      const version = Number(
        source.db.pragma("user_version", { simple: true }),
      );
      if (version >= 3) validateNormalizedSubjects(source.db);
      if (version >= 4) validateAnnotationData(source.db);
      if (version >= 4) validatePlanningData(source.db);
      const copied = new Map<string, Record<string, unknown>[]>();
      for (const table of [
        ...legacyTables,
        ...(version >= 3 ? [...subjectTables, "document_assets"] : []),
        ...(version >= 4 ? [...v21Tables] : []),
      ]) {
        const rows = source.db
          .prepare(`SELECT * FROM ${table}`)
          .all() as Record<string, unknown>[];
        for (const row of rows)
          for (const key of ["value", "operations"])
            if (typeof row[key] === "string") {
              const json = JSON.parse(row[key] as string);
              if (json === null || typeof json !== "object")
                throw new Error(
                  "A backup contains an invalid structured record.",
                );
            }
        copied.set(table, rows);
      }
      this.checkpointBackup("restore");
      this.db.transaction(() => {
        this.db.pragma("defer_foreign_keys=ON");
        this.db.exec("DELETE FROM subject_search; DELETE FROM search_index;");
        for (const table of [...v21Tables].reverse())
          this.db.prepare(`DELETE FROM ${table}`).run();
        for (const table of [...subjectTables].reverse())
          this.db.prepare(`DELETE FROM ${table}`).run();
        for (const table of [...legacyTables].reverse())
          this.db.prepare(`DELETE FROM ${table}`).run();
        this.db.prepare("DELETE FROM document_assets").run();
        for (const [table, rows] of copied) {
          if (!rows.length) continue;
          const columns = Object.keys(rows[0]);
          const allowed = new Set(
            (
              this.db.prepare(`PRAGMA table_info(${table})`).all() as {
                name: string;
              }[]
            ).map((row) => row.name),
          );
          if (columns.some((column) => !allowed.has(column)))
            throw new Error("This backup schema is not supported.");
          const statement = this.db.prepare(
            `INSERT INTO ${table}(${columns.join(",")}) VALUES(${columns.map(() => "?").join(",")})`,
          );
          for (const row of rows)
            statement.run(...columns.map((column) => row[column]));
        }
        for (const table of ["lessons", "library"])
          for (const row of this.db
            .prepare(`SELECT id,value FROM ${table}`)
            .all() as { id: string; value: string }[]) {
            const value = JSON.parse(row.value);
            this.db
              .prepare(
                "INSERT INTO search_index(record_id,entity,title,body) VALUES(?,?,?,?)",
              )
              .run(
                row.id,
                table,
                value.title || "",
                value.content || value.objective || "",
              );
          }
        if (version >= 3) {
          for (const row of source.db
            .prepare(
              "SELECT rowid,subject_id,entity,record_id,title,body FROM subject_search",
            )
            .all() as Record<string, any>[])
            this.db
              .prepare(
                "INSERT INTO subject_search(rowid,subject_id,entity,record_id,title,body) VALUES(?,?,?,?,?,?)",
              )
              .run(
                row.rowid,
                row.subject_id,
                row.entity,
                row.record_id,
                row.title,
                row.body,
              );
        } else populateLegacySubjectState(this.db, this.load());
        reindexAnnotations(this.db);
        validateNormalizedSubjects(this.db);
        validateAnnotationData(this.db);
        validatePlanningData(this.db);
        for (const row of this.db
          .prepare("SELECT id FROM document_assets")
          .all() as { id: string }[])
          this.getDocumentAsset(row.id);
        if ((this.db.pragma("foreign_key_check") as unknown[]).length)
          throw new Error("The restored backup has invalid relationships.");
        const settings = this.db
          .prepare("SELECT value FROM settings WHERE id='state'")
          .get() as { value: string } | undefined;
        if (settings) {
          const state = JSON.parse(settings.value);
          if (state.settings) state.settings.backgroundConsent = false;
          for (const task of state.backgroundTasks || []) task.enabled = false;
          this.db
            .prepare("UPDATE settings SET value=? WHERE id='state'")
            .run(JSON.stringify(state));
        }
        this.load();
      })();
      return this.load();
    } finally {
      source.close();
    }
  }
  close() {
    this.db.close();
  }
}
