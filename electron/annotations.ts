import type Database from "better-sqlite3";
import type { StudioStore } from "./storage";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import type {
  ReadingHighlight,
  ConnectedGraph,
  ConnectedGraphNode,
  ConnectedGraphLink,
} from "../src/annotationTypes";
import { indexSubjectEntity } from "./subject-schema";
import { selectConnectedGraph } from "../src/lib/connectedGraph";

export const annotationTables = [
  "annotation_highlights",
  "annotation_revisions",
  "graph_links",
  "graph_positions",
] as const;
export function migrateAnnotationSchema(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS annotation_highlights(id TEXT PRIMARY KEY,subject_id TEXT NOT NULL REFERENCES subjects(id),source_kind TEXT NOT NULL,source_id TEXT NOT NULL,conversation_id TEXT,page INTEGER,quote TEXT NOT NULL,note TEXT NOT NULL DEFAULT '',color TEXT NOT NULL,version INTEGER NOT NULL,value TEXT NOT NULL,deleted INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS annotation_source ON annotation_highlights(subject_id,source_kind,source_id,deleted);
    CREATE INDEX IF NOT EXISTS annotation_recent ON annotation_highlights(subject_id,updated_at DESC);
    CREATE TABLE IF NOT EXISTS annotation_revisions(id TEXT PRIMARY KEY,highlight_id TEXT NOT NULL REFERENCES annotation_highlights(id),subject_id TEXT NOT NULL REFERENCES subjects(id),version INTEGER NOT NULL,value TEXT NOT NULL,reason TEXT NOT NULL,created_at TEXT NOT NULL,UNIQUE(highlight_id,version));
    CREATE TABLE IF NOT EXISTS graph_links(id TEXT PRIMARY KEY,subject_id TEXT NOT NULL REFERENCES subjects(id),source TEXT NOT NULL,target TEXT NOT NULL,kind TEXT NOT NULL,state TEXT NOT NULL,value TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,UNIQUE(subject_id,source,target,kind));
    CREATE TABLE IF NOT EXISTS graph_positions(subject_id TEXT NOT NULL REFERENCES subjects(id),node_id TEXT NOT NULL,x REAL NOT NULL,y REAL NOT NULL,pinned INTEGER NOT NULL DEFAULT 1,updated_at TEXT NOT NULL,PRIMARY KEY(subject_id,node_id));
  `);
}
const id = z.string().min(1).max(200),
  text = z.string().max(20000);
const draftSchema = z.object({
  subjectId: id,
  sourceKind: z.enum(["message", "chapter", "document"]),
  sourceId: id,
  conversationId: id.optional(),
  page: z.number().int().min(1).max(100000).optional(),
  quote: text.min(1),
  prefix: z.string().max(200).default(""),
  suffix: z.string().max(200).default(""),
  start: z.number().int().min(0).max(10000000).optional(),
  end: z.number().int().min(0).max(10000000).optional(),
  color: z
    .enum(["yellow", "green", "blue", "pink", "purple"])
    .default("yellow"),
  note: text.default(""),
  tags: z.array(z.string().trim().min(1).max(100)).max(40).default([]),
});
const storedSchema = draftSchema.extend({
  id,
  revision: z.number().int().min(1),
  anchorState: z.enum(["anchored", "orphaned"]),
  createdAt: z.string().max(100),
  updatedAt: z.string().max(100),
});
export function validateAnnotationData(db: Database.Database) {
  for (const row of db
    .prepare("SELECT * FROM annotation_highlights")
    .all() as Record<string, any>[]) {
    const value = storedSchema.parse(JSON.parse(row.value));
    if (
      value.subjectId !== row.subject_id ||
      value.sourceKind !== row.source_kind ||
      value.sourceId !== row.source_id ||
      value.revision !== row.version ||
      value.id !== row.id ||
      value.quote !== row.quote ||
      value.note !== row.note ||
      value.color !== row.color ||
      ![0, 1].includes(row.deleted)
    )
      throw new Error("A highlight has inconsistent identity or revision.");
  }
  for (const row of db
    .prepare(
      "SELECT highlight_id,subject_id,version,value FROM annotation_revisions",
    )
    .all() as {
    highlight_id: string;
    subject_id: string;
    version: number;
    value: string;
  }[]) {
    const value = storedSchema.parse(JSON.parse(row.value));
    if (
      value.id !== row.highlight_id ||
      value.subjectId !== row.subject_id ||
      value.revision !== row.version
    )
      throw new Error("A highlight revision has inconsistent identity.");
  }
  const linkSchema = z.object({
    id,
    source: z.string().min(1).max(600),
    target: z.string().min(1).max(600),
    kind: z.enum([
      "prerequisite",
      "related",
      "application",
      "analogy",
      "cross-disciplinary",
      "mentioned-in",
      "explained-in",
      "co-mentioned",
      "same-label",
      "saved-from",
    ]),
    state: z.enum(["accepted", "suggested", "rejected"]),
    reason: z.string().max(2000),
    ownerSubjectId: id.optional(),
    sourceReferences: z
      .array(z.object({ conversationId: id, messageId: id }))
      .max(20)
      .optional(),
  });
  for (const row of db.prepare("SELECT * FROM graph_links").all() as Record<
    string,
    any
  >[]) {
    const value = linkSchema.parse(JSON.parse(row.value));
    if (
      value.id !== row.id ||
      value.source !== row.source ||
      value.target !== row.target ||
      value.kind !== row.kind ||
      value.source === value.target ||
      (value.ownerSubjectId && value.ownerSubjectId !== row.subject_id) ||
      !["accepted", "suggested", "rejected"].includes(row.state)
    )
      throw new Error("A graph connection is invalid.");
  }
  for (const row of db.prepare("SELECT x,y FROM graph_positions").all() as {
    x: number;
    y: number;
  }[])
    if (
      !Number.isFinite(row.x) ||
      !Number.isFinite(row.y) ||
      Math.abs(row.x) > 1000000 ||
      Math.abs(row.y) > 1000000
    )
      throw new Error("A saved graph position is invalid.");
}
export function reindexAnnotations(db: Database.Database) {
  db.prepare("DELETE FROM subject_search WHERE entity='highlight'").run();
  for (const row of db
    .prepare("SELECT value FROM annotation_highlights WHERE deleted=0")
    .all() as { value: string }[]) {
    const item = storedSchema.parse(JSON.parse(row.value));
    indexSubjectEntity(
      db,
      item.subjectId,
      "highlight",
      item.id,
      item.quote.slice(0, 120),
      [item.quote, item.note, ...item.tags].join("\n"),
    );
  }
}
const now = () => new Date().toISOString();
const normalize = (value: string) =>
  value.normalize("NFKC").trim().toLocaleLowerCase().replace(/\s+/g, " ");
const stableId = (...values: string[]) =>
  createHash("sha256").update(values.join("\u0000")).digest("hex").slice(0, 32);
const words = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
function mentions(text: string, label: string) {
  if (label.trim().length < 2) return false;
  return new RegExp(
    "(?<![\\p{L}\\p{N}_])" + words(label.trim()) + "(?![\\p{L}\\p{N}_])",
    "iu",
  ).test(text);
}
export class AnnotationStore {
  readonly db: StudioStore["db"];
  constructor(private store: StudioStore) {
    this.db = store.db;
  }
  private assertSubject(subjectId: string) {
    if (
      !this.db
        .prepare("SELECT id FROM subjects WHERE id=?")
        .get(id.parse(subjectId))
    )
      throw new Error("This subject does not exist.");
  }
  private assertSource(value: z.infer<typeof draftSchema>) {
    this.assertSubject(value.subjectId);
    if (value.sourceKind === "message") {
      const source = this.db
        .prepare(
          "SELECT m.lesson_id,c.id,c.subject_id FROM messages m JOIN conversations c ON c.legacy_lesson_id=m.lesson_id WHERE m.id=?",
        )
        .get(value.sourceId) as
        { lesson_id: string; id: string; subject_id: string } | undefined;
      if (
        !source ||
        source.subject_id !== value.subjectId ||
        (value.conversationId &&
          value.conversationId !== source.id &&
          value.conversationId !== source.lesson_id)
      )
        throw new Error("The selected message is not part of this subject.");
      value.conversationId = source.id;
    } else if (value.sourceKind === "chapter") {
      if (
        !this.db
          .prepare(
            "SELECT id FROM subject_records WHERE id=? AND subject_id=? AND kind='chapter' AND archived=0",
          )
          .get(value.sourceId, value.subjectId)
      )
        throw new Error("The selected chapter is unavailable in this subject.");
    } else {
      const source = this.store
        .load()
        .library.find(
          (item) => item.id === value.sourceId && item.kind === "document",
        );
      const subject = this.db
        .prepare("SELECT name FROM subjects WHERE id=?")
        .get(value.subjectId) as { name: string };
      if (
        !source ||
        (source.subjectId
          ? source.subjectId !== value.subjectId
          : normalize(source.subject) !== normalize(subject.name))
      )
        throw new Error("The selected document is not part of this subject.");
      if (
        value.page &&
        source.pages?.length &&
        !source.pages.some((page) => page.page === value.page)
      )
        throw new Error("This document page does not exist.");
    }
  }
  list(input: unknown): ReadingHighlight[] {
    const value = z
      .object({
        subjectId: id,
        sourceId: id.optional(),
        includeDeleted: z.boolean().optional(),
        query: z.string().max(1000).optional(),
        limit: z.number().int().min(1).max(10000).optional(),
      })
      .parse(input);
    this.assertSubject(value.subjectId);
    const rows = this.db
      .prepare(
        "SELECT value FROM annotation_highlights WHERE subject_id=? AND (? OR deleted=0) AND (? IS NULL OR source_id=?) ORDER BY updated_at DESC LIMIT ?",
      )
      .all(
        value.subjectId,
        value.includeDeleted ? 1 : 0,
        value.sourceId || null,
        value.sourceId || null,
        value.limit || 2000,
      ) as { value: string }[];
    const result = rows.map((row) => JSON.parse(row.value) as ReadingHighlight);
    const query = value.query?.toLocaleLowerCase().trim();
    return query
      ? result.filter((item) =>
          [item.quote, item.note, ...item.tags]
            .join(" ")
            .toLocaleLowerCase()
            .includes(query),
        )
      : result;
  }
  private save(value: ReadingHighlight, reason: string, deleted = false) {
    const json = JSON.stringify(value);
    this.db
      .prepare(
        "INSERT INTO annotation_highlights(id,subject_id,source_kind,source_id,conversation_id,page,quote,note,color,version,value,deleted,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET quote=excluded.quote,note=excluded.note,color=excluded.color,version=excluded.version,value=excluded.value,deleted=excluded.deleted,updated_at=excluded.updated_at",
      )
      .run(
        value.id,
        value.subjectId,
        value.sourceKind,
        value.sourceId,
        value.conversationId || null,
        value.page || null,
        value.quote,
        value.note,
        value.color,
        value.revision,
        json,
        deleted ? 1 : 0,
        value.createdAt,
        value.updatedAt,
      );
    this.db
      .prepare(
        "INSERT INTO annotation_revisions(id,highlight_id,subject_id,version,value,reason,created_at) VALUES(?,?,?,?,?,?,?)",
      )
      .run(
        randomUUID(),
        value.id,
        value.subjectId,
        value.revision,
        json,
        reason,
        now(),
      );
    if (deleted)
      this.db
        .prepare(
          "DELETE FROM subject_search WHERE entity='highlight' AND record_id=?",
        )
        .run(value.id);
    else
      indexSubjectEntity(
        this.db,
        value.subjectId,
        "highlight",
        value.id,
        value.quote.slice(0, 120),
        [value.quote, value.note, ...value.tags].join("\n"),
      );
    return value;
  }
  create(input: unknown) {
    const value = draftSchema.parse(input);
    this.assertSource(value);
    if (
      value.start !== undefined &&
      value.end !== undefined &&
      value.end <= value.start
    )
      throw new Error("Choose a non-empty passage.");
    const duplicate = this.list({
      subjectId: value.subjectId,
      sourceId: value.sourceId,
    }).find(
      (item) =>
        item.quote === value.quote &&
        item.prefix === value.prefix &&
        item.suffix === value.suffix &&
        item.page === value.page,
    );
    if (duplicate) {
      const note = value.note || duplicate.note;
      if (duplicate.color === value.color && duplicate.note === note)
        return duplicate;
      return this.db.transaction(() =>
        this.save(
          {
            ...duplicate,
            color: value.color,
            note,
            revision: duplicate.revision + 1,
            updatedAt: now(),
          },
          "Updated existing highlight",
        ),
      )();
    }
    const at = now();
    return this.db.transaction(() =>
      this.save(
        {
          ...value,
          tags: [...new Set(value.tags)],
          id: randomUUID(),
          revision: 1,
          anchorState: "anchored",
          createdAt: at,
          updatedAt: at,
        },
        "Created highlight",
      ),
    )();
  }
  update(input: unknown) {
    const value = z
      .object({
        id,
        subjectId: id,
        expectedRevision: z.number().int().min(1),
        patch: z.object({
          color: draftSchema.shape.color.optional(),
          note: text.optional(),
          tags: draftSchema.shape.tags.optional(),
          anchorState: z.enum(["anchored", "orphaned"]).optional(),
          start: draftSchema.shape.start,
          end: draftSchema.shape.end,
          prefix: draftSchema.shape.prefix.optional(),
          suffix: draftSchema.shape.suffix.optional(),
        }),
      })
      .parse(input);
    const row = this.db
      .prepare(
        "SELECT value FROM annotation_highlights WHERE id=? AND subject_id=? AND deleted=0",
      )
      .get(value.id, value.subjectId) as { value: string } | undefined;
    if (!row) throw new Error("This highlight is unavailable.");
    const old = JSON.parse(row.value) as ReadingHighlight;
    if (old.revision !== value.expectedRevision)
      throw new Error(
        "This highlight changed. Reload its latest revision before editing.",
      );
    return this.db.transaction(() =>
      this.save(
        {
          ...old,
          ...value.patch,
          revision: old.revision + 1,
          updatedAt: now(),
        },
        "Edited highlight",
      ),
    )();
  }
  delete(input: unknown) {
    const value = z
      .object({ id, subjectId: id, expectedRevision: z.number().int().min(1) })
      .parse(input);
    const old = this.list({ subjectId: value.subjectId }).find(
      (item) => item.id === value.id,
    );
    if (!old || old.revision !== value.expectedRevision)
      throw new Error("This highlight changed or was already deleted.");
    return this.db.transaction(() =>
      this.save(
        { ...old, revision: old.revision + 1, updatedAt: now() },
        "Deleted highlight",
        true,
      ),
    )();
  }
  restore(input: unknown) {
    const value = z
      .object({
        id,
        subjectId: id,
        revision: z.number().int().min(1),
        expectedRevision: z.number().int().min(1),
      })
      .parse(input);
    const row = this.db
      .prepare(
        "SELECT value FROM annotation_revisions WHERE highlight_id=? AND subject_id=? AND version=?",
      )
      .get(value.id, value.subjectId, value.revision) as
      { value: string } | undefined;
    const current = this.db
      .prepare(
        "SELECT version FROM annotation_highlights WHERE id=? AND subject_id=?",
      )
      .get(value.id, value.subjectId) as { version: number } | undefined;
    if (!row || !current || current.version !== value.expectedRevision)
      throw new Error("The annotation revision is unavailable or changed.");
    const old = storedSchema.parse(JSON.parse(row.value));
    this.assertSource(old);
    return this.db.transaction(() =>
      this.save(
        { ...old, revision: current.version + 1, updatedAt: now() },
        "Restored revision " + value.revision,
      ),
    )();
  }
  private graphSources(subjectId?: string, includeLinks = true) {
    if (subjectId) this.assertSubject(subjectId);
    const data = this.store.load(),
      nodes: ConnectedGraphNode[] = [],
      links: ConnectedGraphLink[] = [];
    const canonical = new Map<string, string>();
    const subjectNames = new Map(
      (
        this.db
          .prepare("SELECT id,name FROM subjects WHERE archived=0")
          .all() as {
          id: string;
          name: string;
        }[]
      ).map((row) => [row.id, row.name]),
    );
    const scopedConcepts = new Map<string, string[]>();
    for (const row of this.db
      .prepare("SELECT concept_id,subject_id FROM subject_concepts")
      .all() as { concept_id: string; subject_id: string }[])
      scopedConcepts.set(row.concept_id, [
        ...(scopedConcepts.get(row.concept_id) || []),
        row.subject_id,
      ]);
    const conversations = this.db
      .prepare(
        "SELECT id,legacy_lesson_id,subject_id FROM conversations WHERE archived=0",
      )
      .all() as { id: string; legacy_lesson_id: string; subject_id: string }[];
    const owner = new Map(
      conversations.map((row) => [row.legacy_lesson_id, row]),
    );
    for (const concept of data.concepts) {
      const scopes = concept.subjectId
        ? [concept.subjectId]
        : scopedConcepts.get(concept.id) || [];
      for (const scope of scopes) {
        if (!subjectNames.has(scope) || (subjectId && scope !== subjectId))
          continue;
        const key = scope + ":" + normalize(concept.label);
        if (canonical.has(key)) {
          canonical.set(scope + ":id:" + concept.id, canonical.get(key)!);
          continue;
        }
        const nodeId = "concept:" + scope + ":" + concept.id;
        canonical.set(key, nodeId);
        canonical.set(scope + ":id:" + concept.id, nodeId);
        nodes.push({
          id: nodeId,
          sourceId: concept.id,
          subjectId: scope,
          kind: "concept",
          label: concept.label,
          definition: concept.notes || "",
          evidence: concept.evidence,
          conversationId: concept.lessonId,
          subjectName: subjectNames.get(scope),
          updatedAt: concept.updatedAt,
          status: concept.status,
        });
      }
    }
    const definitionSources: {
      conceptId: string;
      lessonId: string;
      messageId: string;
    }[] = [];
    const nodeByCanonical = new Map(
      nodes
        .filter((node) => node.kind === "concept")
        .map((node) => [
          (node.subjectId || "") + ":" + normalize(node.label),
          node,
        ]),
    );
    const termSchema = z.object({
      term: z.string().trim().min(2).max(120),
      definition: z.string().trim().min(1).max(3000),
    });
    for (const lesson of data.lessons) {
      const row = owner.get(lesson.id),
        scope = row?.subject_id || lesson.subjectId;
      if (
        !row ||
        !subjectNames.has(scope || "") ||
        (subjectId && scope !== subjectId)
      )
        continue;
      nodes.push({
        id: "lesson:" + lesson.id,
        sourceId: lesson.id,
        subjectId: scope,
        kind: "lesson",
        label: lesson.title,
        definition: lesson.objective,
        conversationId: row.id,
        subjectName: scope ? subjectNames.get(scope) : undefined,
        updatedAt: lesson.updatedAt,
      });
      for (const message of lesson.messages) {
        if (message.role !== "assistant" || message.status === "failed")
          continue;
        const content = message.content || message.blocks || [];
        const defined = new Set<string>();
        for (const block of content.slice(0, 64)) {
          const candidates: unknown[] =
            block?.type === "terms" && Array.isArray(block.items)
              ? block.items.slice(0, 24)
              : block?.type === "concept" &&
                  typeof block.title === "string" &&
                  typeof block.objective === "string" &&
                  block.objective &&
                  !/^(?:overview|introduction|the central idea|central concept|learning objective|next steps)$/i.test(
                    block.title.trim(),
                  )
                ? [{ term: block.title, definition: block.objective }]
                : [];
          for (const candidate of candidates) {
            const parsed = termSchema.safeParse(candidate);
            if (!parsed.success) continue;
            const label = parsed.data.term,
              key = (scope || "") + ":" + normalize(label);
            let node = nodeByCanonical.get(key);
            if (!node) {
              const conceptId =
                "encountered-" + stableId(scope || "general", normalize(label));
              node = {
                id: "concept:" + scope + ":" + conceptId,
                sourceId: conceptId,
                subjectId: scope,
                subjectName: scope ? subjectNames.get(scope) : undefined,
                kind: "concept",
                label,
                definition: parsed.data.definition,
                evidence:
                  "Encountered in saved teaching. No learner assessment or demonstrated understanding is recorded.",
                status: "encountered",
                derived: true,
                conversationId: lesson.id,
                messageId: message.id,
                updatedAt: message.createdAt,
              };
              nodeByCanonical.set(key, node);
              canonical.set(key, node.id);
              canonical.set(scope + ":id:" + conceptId, node.id);
              nodes.push(node);
            }
            // Saved learner notes always win. A source definition can fill a
            // display-only gap without changing the canonical knowledge row.
            if (!node.definition) node.definition = parsed.data.definition;
            if (!defined.has(node.id)) {
              defined.add(node.id);
              definitionSources.push({
                conceptId: node.id,
                lessonId: lesson.id,
                messageId: message.id,
              });
            }
          }
        }
      }
    }
    for (const item of data.library.filter((item) => item.kind === "note")) {
      const scope =
        item.subjectId ||
        (
          this.db
            .prepare(
              "SELECT id FROM subjects WHERE lower(trim(name))=lower(trim(?))",
            )
            .get(item.subject) as { id: string } | undefined
        )?.id;
      if (
        !scope ||
        !subjectNames.has(scope) ||
        (subjectId && scope !== subjectId)
      )
        continue;
      nodes.push({
        id: "note:" + item.id,
        sourceId: item.id,
        subjectId: scope,
        kind: "note",
        label: item.title,
        definition: item.content,
        conversationId: item.lessonIds?.[0],
        subjectName: subjectNames.get(scope),
        updatedAt: item.createdAt,
      });
    }
    for (const row of this.db
      .prepare(
        "SELECT id,subject_id,title,value FROM subject_records WHERE kind='note' AND archived=0",
      )
      .all() as {
      id: string;
      subject_id: string;
      title: string;
      value: string;
    }[]) {
      if (
        !subjectNames.has(row.subject_id) ||
        (subjectId && row.subject_id !== subjectId)
      )
        continue;
      const value = JSON.parse(row.value) as Record<string, unknown>;
      nodes.push({
        id: "note:" + row.id,
        sourceId: row.id,
        subjectId: row.subject_id,
        kind: "note",
        label: row.title,
        definition: String(value.content || value.text || value.markdown || ""),
        subjectName: subjectNames.get(row.subject_id),
        updatedAt:
          typeof value.updatedAt === "string" ? value.updatedAt : undefined,
      });
    }
    if (!includeLinks)
      return {
        nodes: [...new Map(nodes.map((node) => [node.id, node])).values()],
        links,
      };
    const graphNodeById = new Map(nodes.map((node) => [node.id, node]));
    const linkIndex = new Map<string, ConnectedGraphLink>();
    const messageOwners = new Map(
      data.lessons.flatMap((lesson) =>
        lesson.messages.map((message) => [message.id, lesson.id] as const),
      ),
    );
    const push = (
      source: string,
      target: string,
      kind: string,
      reason: string,
      state: ConnectedGraphLink["state"] = "accepted",
      sourceMessageId?: string,
    ) => {
      if (source === target) return;
      const linkId = stableId(source, target, kind),
        existing = linkIndex.get(linkId);
      const owner = sourceMessageId
        ? messageOwners.get(sourceMessageId)
        : undefined;
      const references = existing?.sourceReferences || [];
      if (
        owner &&
        sourceMessageId &&
        !references.some(
          (reference) =>
            reference.conversationId === owner &&
            reference.messageId === sourceMessageId,
        ) &&
        references.length < 20
      )
        references.push({ conversationId: owner, messageId: sourceMessageId });
      if (existing) {
        existing.sourceMessageId ||= sourceMessageId;
        existing.sourceReferences = references;
        return;
      }
      const link: ConnectedGraphLink = {
        id: linkId,
        source,
        target,
        kind,
        state,
        reason,
        sourceMessageId,
        ownerSubjectId: graphNodeById.get(source)?.subjectId,
        sourceReferences: references.length ? references : undefined,
      };
      links.push(link);
      linkIndex.set(linkId, link);
    };
    for (const source of definitionSources) {
      const node = graphNodeById.get(source.conceptId);
      if (node) {
        node.conversationId ||= source.lessonId;
        node.messageId ||= source.messageId;
      }
      push(
        source.conceptId,
        "lesson:" + source.lessonId,
        "explained-in",
        "Defined in this saved assistant explanation. Encountering a term does not demonstrate understanding.",
        "accepted",
        source.messageId,
      );
    }
    const lessonById = new Map(
      nodes
        .filter((node) => node.kind === "lesson")
        .map((node) => [node.sourceId, node]),
    );
    for (const item of data.library.filter((item) => item.kind === "note")) {
      const note = nodes.find((node) => node.id === "note:" + item.id);
      if (!note) continue;
      for (const lessonId of [...new Set(item.lessonIds || [])].slice(0, 50)) {
        const lesson = lessonById.get(lessonId);
        if (lesson && lesson.subjectId === note.subjectId)
          push(
            note.id,
            lesson.id,
            "saved-from",
            "This note explicitly references the original lesson.",
          );
      }
    }
    for (const relation of data.relations) {
      const sources = new Set(
        [...canonical]
          .filter(([key]) => key.endsWith(":id:" + relation.source))
          .map(([, value]) => value),
      );
      const targets = new Set(
        [...canonical]
          .filter(([key]) => key.endsWith(":id:" + relation.target))
          .map(([, value]) => value),
      );
      for (const sourceId of sources)
        for (const targetId of targets) {
          const source = nodes.find((node) => node.id === sourceId)!,
            target = nodes.find((node) => node.id === targetId)!;
          if (
            source.subjectId === target.subjectId ||
            relation.kind === "cross-disciplinary"
          )
            push(
              sourceId,
              targetId,
              relation.kind,
              "Learner-reviewed concept relationship",
            );
        }
    }
    for (const concept of nodes.filter(
      (node) => node.kind === "concept" && node.conversationId,
    )) {
      const lesson = nodes.find(
        (node) =>
          node.kind === "lesson" &&
          node.subjectId === concept.subjectId &&
          (node.sourceId === concept.conversationId ||
            node.conversationId === concept.conversationId),
      );
      if (lesson)
        push(
          concept.id,
          lesson.id,
          "explained-in",
          "The concept record references this source lesson.",
        );
    }
    // Scan each source once, using a scoped first-word index rather than a
    // concept × chat × transcript traversal for large subject libraries.
    const conceptIndex = new Map<string, ConnectedGraphNode[]>();
    for (const concept of nodes.filter((node) => node.kind === "concept")) {
      const first = concept.label
        .toLocaleLowerCase()
        .match(/[\p{L}\p{N}_]+/u)?.[0];
      if (!first) continue;
      const key = (concept.subjectId || "") + "\u0000" + first;
      conceptIndex.set(key, [...(conceptIndex.get(key) || []), concept]);
    }
    const lessonsById = new Map(
      data.lessons.map((lesson) => [lesson.id, lesson]),
    );
    for (const source of nodes.filter((node) => node.kind !== "concept")) {
      const seen = new Set<string>();
      const passages =
        source.kind === "lesson"
          ? (lessonsById.get(source.sourceId)?.messages || [])
              .filter((message) => message.role === "assistant")
              .map((message) => ({
                text:
                  message.text +
                  " " +
                  JSON.stringify(message.content || message.blocks || []),
                id: message.id,
              }))
          : [{ text: source.definition, id: undefined }];
      for (const passage of passages) {
        const tokens = new Set(
          passage.text.toLocaleLowerCase().match(/[\p{L}\p{N}_]+/gu) || [],
        );
        const candidates = new Map<string, ConnectedGraphNode>();
        for (const token of tokens)
          for (const concept of conceptIndex.get(
            (source.subjectId || "") + "\u0000" + token,
          ) || [])
            candidates.set(concept.id, concept);
        // Automatically connect concepts only where a real source passage
        // supports their association. Long lists and large cliques are omitted.
        if (source.kind === "lesson") {
          const concepts = [...candidates.values()];
          let added = 0;
          for (const paragraph of passage.text
            .split(/\n\s*\n/)
            .filter((text) => text.length <= 1500)) {
            const together = concepts.filter((concept) =>
              mentions(paragraph, concept.label),
            );
            if (together.length < 2 || together.length > 8) continue;
            for (let a = 0; a < together.length; a++)
              for (let b = a + 1; b < together.length; b++) {
                if (added >= 18) break;
                const [left, right] = [together[a].id, together[b].id].sort();
                push(
                  left,
                  right,
                  "co-mentioned",
                  "These concepts occur together in this source passage. This is a source association, not a claim of mastery or a causal relationship. " +
                    paragraph.slice(0, 240),
                  "accepted",
                  passage.id,
                );
                added++;
              }
            if (added >= 18) break;
          }
        }
        for (const concept of candidates.values()) {
          if (seen.has(concept.id) || !mentions(passage.text, concept.label))
            continue;
          seen.add(concept.id);
          if (source.kind === "lesson") {
            if (!concept.conversationId)
              concept.conversationId = source.conversationId;
            if (!concept.messageId) concept.messageId = passage.id;
            push(
              concept.id,
              source.id,
              "explained-in",
              "Original explanation: " + passage.id,
              "accepted",
              passage.id,
            );
          } else
            push(
              concept.id,
              source.id,
              "mentioned-in",
              "Exact concept name occurs in this note; confirm the connection.",
              "suggested",
            );
        }
      }
    }
    if (!subjectId) {
      const labels = new Map<string, ConnectedGraphNode[]>();
      for (const node of nodes.filter((node) => node.kind === "concept")) {
        const key = normalize(node.label);
        labels.set(key, [...(labels.get(key) || []), node]);
      }
      for (const same of labels.values()) {
        // Avoid a quadratic clique when many subjects share a common term.
        // These bounded, reviewable name matches never merge scoped concepts.
        const candidates = same
          .slice()
          .sort((a, b) => a.id.localeCompare(b.id))
          .slice(0, 12);
        for (let index = 1; index < candidates.length; index++) {
          const [a, b] = [candidates[0], candidates[index]];
          if (a.subjectId === b.subjectId) continue;
          const [left, right] = [a.id, b.id].sort();
          push(
            left,
            right,
            "same-label",
            "The same concept name appears in two subjects. Review whether the meanings are related; identical wording alone is not proof.",
            "suggested",
          );
        }
      }
    }
    return {
      nodes: [...new Map(nodes.map((node) => [node.id, node])).values()],
      links,
    };
  }
  graph(input: unknown): ConnectedGraph {
    const value = z
      .object({
        subjectId: id.optional(),
        query: z.string().max(500).optional(),
        keywords: z.array(z.string().min(1).max(80)).max(12).optional(),
        keywordMode: z.enum(["any", "all"]).default("any"),
        nodeKinds: z
          .array(z.enum(["concept", "lesson", "note"]))
          .max(3)
          .optional(),
        linkKinds: z.array(z.string().max(80)).max(20).optional(),
        includeSuggested: z.boolean().default(true),
        sort: z
          .enum([
            "connections",
            "recent",
            "alphabetical",
            "subject",
            "type",
            "relevance",
          ])
          .default("connections"),
        hops: z.number().int().min(1).max(2).default(1),
        hideIsolated: z.boolean().default(false),
        focusId: z.string().max(600).optional(),
        limit: z.number().int().min(10).max(600).default(160),
      })
      .parse(input || {});
    const all = this.graphSources(value.subjectId),
      byId = new Map(all.nodes.map((node) => [node.id, node]));
    const persisted = this.db
      .prepare(
        "SELECT value,state FROM graph_links WHERE (? IS NULL OR subject_id=?)",
      )
      .all(value.subjectId || null, value.subjectId || null) as {
      value: string;
      state: ConnectedGraphLink["state"];
    }[];
    const map = new Map(all.links.map((link) => [link.id, link]));
    for (const row of persisted) {
      const link = JSON.parse(row.value) as ConnectedGraphLink;
      if (byId.has(link.source) && byId.has(link.target))
        map.set(link.id, { ...link, state: row.state });
    }
    const positions: ConnectedGraph["positions"] = {};
    for (const row of this.db
      .prepare(
        "SELECT * FROM graph_positions WHERE (? IS NULL OR subject_id=?)",
      )
      .all(value.subjectId || null, value.subjectId || null) as {
      node_id: string;
      x: number;
      y: number;
      pinned: number;
    }[])
      if (byId.has(row.node_id))
        positions[row.node_id] = { x: row.x, y: row.y, pinned: !!row.pinned };
    return selectConnectedGraph(
      {
        nodes: all.nodes,
        links: [...map.values()].map((link) => ({
          ...link,
          ownerSubjectId:
            link.ownerSubjectId || byId.get(link.source)?.subjectId,
        })),
        positions,
        totalNodes: all.nodes.length,
        truncated: false,
      },
      value,
    );
  }
  graphLink(input: unknown, suggested = false) {
    const value = z
      .object({
        subjectId: id,
        source: z.string().min(1).max(600),
        target: z.string().min(1).max(600),
        kind: z.enum([
          "prerequisite",
          "related",
          "application",
          "analogy",
          "cross-disciplinary",
          "mentioned-in",
          "explained-in",
          "co-mentioned",
          "same-label",
          "saved-from",
        ]),
        reason: z.string().max(2000).default(""),
      })
      .parse(input);
    this.assertSubject(value.subjectId);
    const sources = this.graphSources(undefined, false),
      source = sources.nodes.find((node) => node.id === value.source),
      target = sources.nodes.find((node) => node.id === value.target);
    if (
      !source ||
      !target ||
      source.id === target.id ||
      source.subjectId !== value.subjectId ||
      (source.subjectId !== target.subjectId &&
        !["cross-disciplinary", "same-label"].includes(value.kind))
    )
      throw new Error(
        "Choose existing graph nodes and a valid scoped relationship.",
      );
    const link: ConnectedGraphLink = {
      id: stableId(value.source, value.target, value.kind),
      source: value.source,
      target: value.target,
      kind: value.kind,
      state: suggested ? "suggested" : "accepted",
      reason: value.reason,
    };
    return this.writeGraphLink(value.subjectId, link);
  }
  private writeGraphLink(subjectId: string, link: ConnectedGraphLink) {
    const at = now();
    this.db
      .prepare(
        "INSERT INTO graph_links(id,subject_id,source,target,kind,state,value,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET state=CASE WHEN graph_links.state IN ('accepted','rejected') AND excluded.state='suggested' THEN graph_links.state ELSE excluded.state END,value=excluded.value,updated_at=excluded.updated_at",
      )
      .run(
        link.id,
        subjectId,
        link.source,
        link.target,
        link.kind,
        link.state,
        JSON.stringify(link),
        at,
        at,
      );
    return link;
  }
  dispatch(action: string, input: unknown = {}) {
    const value = input as Record<string, unknown>;
    switch (action) {
      case "annotations:list":
      case "annotations:search":
        return this.list(input);
      case "annotations:create":
        return this.create(input);
      case "annotations:update":
        return this.update(input);
      case "annotations:delete":
        return this.delete(input);
      case "annotations:restore":
        return this.restore(input);
      case "annotations:revisions": {
        const payload = z.object({ id, subjectId: id }).parse(input);
        return this.db
          .prepare(
            "SELECT version,value,reason,created_at AS createdAt FROM annotation_revisions WHERE highlight_id=? AND subject_id=? ORDER BY version DESC",
          )
          .all(payload.id, payload.subjectId);
      }
      case "graph:get":
        return this.graph(input);
      case "graph:link":
        return this.graphLink(input);
      case "graph:suggest": {
        const subjectId = id.optional().parse(value.subjectId);
        if (subjectId) this.assertSubject(subjectId);
        const sources = this.graphSources(subjectId);
        return this.db.transaction(() =>
          sources.links
            .filter((link) => link.state === "suggested")
            .map((link) => {
              const owner =
                link.ownerSubjectId ||
                sources.nodes.find((node) => node.id === link.source)
                  ?.subjectId;
              if (!owner)
                throw new Error(
                  "A suggested connection needs an existing subject owner.",
                );
              return this.writeGraphLink(owner, link);
            }),
        )();
      }
      case "graph:review": {
        const payload = z
          .object({
            subjectId: id,
            id,
            state: z.enum(["accepted", "rejected"]),
          })
          .parse(input);
        const result = this.db
          .prepare(
            "UPDATE graph_links SET state=?,updated_at=? WHERE id=? AND subject_id=?",
          )
          .run(payload.state, now(), payload.id, payload.subjectId);
        if (!result.changes)
          throw new Error(
            "This connection suggestion is unavailable in the selected subject.",
          );
        return true;
      }
      case "graph:position": {
        const payload = z
          .object({
            subjectId: id,
            nodeId: z.string().max(600),
            x: z.number().finite().min(-1000000).max(1000000),
            y: z.number().finite().min(-1000000).max(1000000),
            pinned: z.boolean().default(true),
          })
          .parse(input);
        this.assertSubject(payload.subjectId);
        if (
          !this.graphSources(payload.subjectId, false).nodes.some(
            (node) => node.id === payload.nodeId,
          )
        )
          throw new Error("This graph node is unavailable in the subject.");
        this.db
          .prepare(
            "INSERT INTO graph_positions(subject_id,node_id,x,y,pinned,updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(subject_id,node_id) DO UPDATE SET x=excluded.x,y=excluded.y,pinned=excluded.pinned,updated_at=excluded.updated_at",
          )
          .run(
            payload.subjectId,
            payload.nodeId,
            payload.x,
            payload.y,
            payload.pinned ? 1 : 0,
            now(),
          );
        return true;
      }
      default:
        throw new Error("Unknown annotation or graph operation.");
    }
  }
}
