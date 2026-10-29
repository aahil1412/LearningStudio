import { randomUUID } from "node:crypto";
import { z } from "zod";
import { StudioStore, validateStudioData } from "./storage";
import { defaultData } from "../src/lib/defaults";
import { removeLessonReferences } from "../src/lib/learning";
import { validateContentBlock } from "../src/lib/visualSpecs";
import { encode } from "gpt-tokenizer/encoding/o200k_base";
import type {
  Subject,
  SubjectSnapshot,
  CurriculumNode,
  CurriculumEdge,
  SubjectConcept,
  SubjectMemory,
  SubjectRecord,
  SubjectRevision,
  SubjectOperation,
  ConversationMeta,
  SubjectContext,
  SubjectSearchResult,
} from "../src/v2types";
import type { Lesson, Message, Concept } from "../src/types";
import {
  indexSubjectEntity,
  normalizeSubjectName,
  syncLegacySubjects,
  normalizedSubjectTables,
  validateNormalizedSubjects,
} from "./subject-schema";
import { validatePlanningData } from "./planning";
import {
  annotationTables,
  validateAnnotationData,
  reindexAnnotations,
} from "./annotations";

const id = z.string().min(1).max(200),
  short = z.string().trim().min(1).max(500),
  text = z.string().max(20000);
const status = z.enum([
  "encountered",
  "unassessed",
  "partial",
  "demonstrated",
  "misconception",
  "review",
  "unresolved",
]);
const coverage = z.enum(["not-started", "introduced", "covered"]);
const nodeStatus = z.enum([
  "not-started",
  "introduced",
  "covered",
  "partial",
  "demonstrated",
  "review",
  "gap",
]);
const recordType = z.enum([
  "visual",
  "chapter",
  "canvas",
  "note",
  "finding",
  "asset",
]);
const entity = z.enum([
  "subject",
  "curriculum",
  "edge",
  "concept",
  "evidence",
  "memory",
  "summary",
  "record",
]);
const operationSchema = z.object({
  entity,
  op: z.enum(["put", "delete"]),
  id,
  value: z.record(z.string(), z.unknown()).optional(),
});
type Entity = z.infer<typeof entity>;
type Snapshot = Record<string, unknown> | null;
type Change = { entity: Entity; id: string; before: Snapshot; after: Snapshot };
type DbRow = Record<string, any>;
const now = () => new Date().toISOString();
const parse = <T>(value: string): T => JSON.parse(value) as T;
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const revisionValue = (value: Snapshot): Snapshot =>
  value?.recordType === "asset"
    ? { ...value, data: undefined, assetId: value.id }
    : value;
const serialized = (value: unknown, max = 24_000_000) => {
  const result = JSON.stringify(value);
  if (!result || Buffer.byteLength(result, "utf8") > max)
    throw new Error(
      `This record exceeds the ${Math.floor(max / 1_000_000)} MB limit or is not JSON data.`,
    );
  return result;
};
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Expected a structured object.");
  return value as Record<string, unknown>;
}
function validatedRecordData(
  kind: string,
  input: unknown,
  wrapper: { id: string; subjectId: string; title: string },
): unknown {
  if (!["chapter", "visual"].includes(kind)) return input;
  const raw = object(input);
  if (
    (raw.id !== undefined && raw.id !== wrapper.id) ||
    (raw.subjectId !== undefined && raw.subjectId !== wrapper.subjectId)
  )
    throw new Error(
      "Saved content identity and subject must match its record.",
    );
  const at = now();
  if (kind === "chapter") {
    const parsed = z
      .object({
        markdown: z.string().max(2_000_000),
        blocks: z.array(z.unknown()).max(1000).default([]),
        citations: z
          .array(
            z.object({
              label: z.string().max(2000),
              url: z.string().max(3000).optional(),
              documentId: id.optional(),
              page: z.number().int().min(1).optional(),
            }),
          )
          .max(2000)
          .default([]),
        originMessageIds: z.array(id).max(10000).default([]),
        revision: z.number().int().min(0).default(0),
        createdAt: z.string().max(100).default(at),
        updatedAt: z.string().max(100).default(at),
        position: z.number().finite().min(-100000).max(100000).optional(),
        userEdited: z.boolean().optional(),
        curriculumNodeId: id.optional(),
      })
      .parse(raw);
    const blocks = parsed.blocks.map(validateContentBlock);
    if (blocks.some((block) => block === null))
      throw new Error(
        "A chapter contains a malformed scientific or learning block.",
      );
    for (const citation of parsed.citations)
      if (citation.url) {
        let url: URL;
        try {
          url = new URL(citation.url);
        } catch {
          throw new Error("Chapter source links must be valid HTTPS URLs.");
        }
        if (url.protocol !== "https:" || url.username || url.password)
          throw new Error("Chapter source links must be valid HTTPS URLs.");
      }
    return { ...parsed, ...wrapper, blocks };
  }
  const parsed = z
    .object({
      block: z.unknown(),
      state: z.record(z.string(), z.unknown()).default({}),
      placement: z
        .enum(["auto", "inline", "side", "split", "fullscreen", "collapsed"])
        .default("auto"),
      originMessageId: id.optional(),
      tags: z.array(z.string().max(200)).max(100).default([]),
      annotations: z
        .array(
          z.object({
            id,
            text: z.string().max(20000),
            createdAt: z.string().max(100),
          }),
        )
        .max(1000)
        .default([]),
      createdAt: z.string().max(100).default(at),
      updatedAt: z.string().max(100).default(at),
    })
    .parse(raw);
  const block = validateContentBlock(parsed.block);
  if (!block || ["text", "equation", "exercise"].includes(block.type))
    throw new Error(
      "A visual record requires a valid scientific visualization block.",
    );
  return { ...parsed, ...wrapper, block };
}

export class SubjectStore {
  readonly db: StudioStore["db"];
  constructor(private store: StudioStore) {
    this.db = store.db;
    if (Number(this.db.pragma("user_version", { simple: true })) < 3)
      throw new Error("The subject store requires the additive v3 migration.");
  }
  private subject(subjectId: string): Subject {
    const row = this.db
      .prepare("SELECT * FROM subjects WHERE id=?")
      .get(id.parse(subjectId)) as DbRow | undefined;
    if (!row)
      throw new Error(
        "This subject no longer exists. Refresh the subject list.",
      );
    return {
      id: row.id,
      name: row.name,
      objective: row.objective,
      depth: row.depth,
      archived: !!row.archived,
      currentNodeId: row.current_node_id || undefined,
      revision: row.version,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
  private checkRevision(subjectId: string, expected: unknown) {
    const subject = this.subject(subjectId);
    if (
      expected !== undefined &&
      (!Number.isInteger(expected) || expected !== subject.revision)
    )
      throw new Error(
        `Subject revision conflict: expected ${String(expected)}, current ${subject.revision}. Refresh before applying changes.`,
      );
    return subject;
  }
  list(includeArchived = false): Subject[] {
    return (
      this.db
        .prepare(
          `SELECT id FROM subjects ${includeArchived ? "" : "WHERE archived=0"} ORDER BY name COLLATE NOCASE,id`,
        )
        .all() as { id: string }[]
    ).map((row) => this.subject(row.id));
  }
  private conversation(row: DbRow): ConversationMeta {
    const value = parse<DbRow>(row.value);
    return {
      id: row.id,
      subjectId: row.subject_id,
      curriculumNodeId: row.curriculum_node_id || value.curriculumNodeId,
      parentConversationId: row.parent_id || undefined,
      branchMessageId: row.branch_message_id || undefined,
      title: row.title,
      archived: !!row.archived,
      resumeSummary: value.resumeSummary,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
  private rows<T>(table: string, subjectId: string, limit = 10000): T[] {
    return (
      this.db
        .prepare(`SELECT value FROM ${table} WHERE subject_id=? LIMIT ?`)
        .all(subjectId, limit) as { value: string }[]
    ).map((row) => parse<T>(row.value));
  }
  private records(
    subjectId: string,
    kind?: string,
    includeData = true,
    limit = 200,
  ): SubjectRecord[] {
    this.subject(subjectId);
    if (kind) recordType.parse(kind);
    const rows = this.db
      .prepare(
        `SELECT * FROM subject_records WHERE subject_id=? AND archived=0 ${kind ? "AND kind=?" : ""} ORDER BY updated_at DESC,id LIMIT ?`,
      )
      .all(
        ...(kind
          ? [subjectId, kind, Math.min(2000, Math.max(1, limit))]
          : [subjectId, Math.min(2000, Math.max(1, limit))]),
      ) as DbRow[];
    return rows.map((row) => ({
      id: row.id,
      subjectId: row.subject_id,
      recordType: row.kind,
      title: row.title,
      data: includeData ? parse(row.value) : null,
      revision: row.version,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }
  private record(
    subjectId: string,
    recordId: string,
    kind?: string,
  ): SubjectRecord | null {
    this.subject(subjectId);
    const row = this.db
      .prepare(
        "SELECT * FROM subject_records WHERE id=? AND subject_id=? AND archived=0",
      )
      .get(id.parse(recordId), subjectId) as DbRow | undefined;
    if (!row || (kind && row.kind !== kind)) return null;
    return {
      id: row.id,
      subjectId: row.subject_id,
      recordType: row.kind,
      title: row.title,
      data: parse(row.value),
      revision: row.version,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
  private revisions(subjectId: string, limit = 40): SubjectRevision[] {
    return (
      this.db
        .prepare(
          "SELECT * FROM subject_revisions WHERE subject_id=? ORDER BY version DESC LIMIT ?",
        )
        .all(subjectId, Math.min(200, limit)) as DbRow[]
    ).map((row) => ({
      id: row.id,
      subjectId,
      baseRevision: row.version - 1,
      revision: row.version,
      label: row.reason,
      origin: row.actor,
      status: row.kind === "rollback" ? "rolled-back" : "applied",
      operations: parse<Change[]>(row.operations).map((change) => ({
        entity: change.entity,
        id: change.id,
        op: change.after ? "put" : "delete",
        value: change.after
          ? change.entity === "record"
            ? { ...change.after, data: undefined }
            : change.after
          : undefined,
      })),
      sourceConversationId: row.source_conversation_id || undefined,
      sourceMessageId: row.source_message_id || undefined,
      createdAt: row.created_at,
    }));
  }
  snapshot(subjectId: string, includeRecordData = false): SubjectSnapshot {
    const subject = this.subject(subjectId);
    return {
      subject,
      conversations: (
        this.db
          .prepare(
            "SELECT * FROM conversations WHERE subject_id=? ORDER BY updated_at DESC",
          )
          .all(subjectId) as DbRow[]
      ).map((row) => this.conversation(row)),
      curriculum: this.rows<CurriculumNode>("curriculum_nodes", subjectId).sort(
        (a, b) => a.position - b.position,
      ),
      edges: this.rows("curriculum_edges", subjectId),
      concepts: this.rows("subject_concepts", subjectId),
      evidence: (
        this.db
          .prepare(
            "SELECT * FROM learning_evidence WHERE subject_id=? ORDER BY created_at DESC LIMIT 10000",
          )
          .all(subjectId) as DbRow[]
      ).map((row) => ({
        id: row.id,
        subjectId,
        conceptId: row.concept_id,
        kind: row.kind,
        content: row.claim,
        conversationId: row.conversation_id || undefined,
        messageId: row.message_id || undefined,
        createdAt: row.created_at,
        ...parse<DbRow>(row.value),
      })),
      memory: this.rows("subject_memory", subjectId),
      records: this.records(subjectId, undefined, includeRecordData, 2000),
      revisions: [
        ...this.revisions(subjectId),
        ...(
          this.db
            .prepare(
              "SELECT value FROM memory_proposals WHERE subject_id=? AND state='proposed' ORDER BY created_at DESC LIMIT 30",
            )
            .all(subjectId) as { value: string }[]
        ).map((row) => parse<SubjectRevision>(row.value)),
      ],
    };
  }
  create(input: unknown): Subject {
    const value = z
      .object({
        name: short,
        objective: text.default(""),
        depth: z
          .enum(["overview", "comprehensive", "advanced"])
          .default("comprehensive"),
      })
      .parse(input);
    const subjectId = randomUUID(),
      at = now();
    const alias = normalizeSubjectName(value.name);
    if (
      this.db.prepare("SELECT 1 FROM subject_aliases WHERE alias=?").get(alias)
    )
      throw new Error(
        "A subject with this name already exists. Open it or choose a distinct name.",
      );
    this.db.transaction(() => {
      this.db
        .prepare(
          "INSERT INTO subjects(id,name,objective,depth,created_at,updated_at) VALUES(?,?,?,?,?,?)",
        )
        .run(
          subjectId,
          value.name.trim(),
          value.objective,
          value.depth,
          at,
          at,
        );
      this.db
        .prepare("INSERT INTO subject_aliases(alias,subject_id) VALUES(?,?)")
        .run(alias, subjectId);
      indexSubjectEntity(
        this.db,
        subjectId,
        "subject",
        subjectId,
        value.name,
        value.objective,
      );
    })();
    return this.subject(subjectId);
  }
  private readEntity(
    subjectId: string,
    kind: Entity,
    entityId: string,
  ): Snapshot {
    if (kind === "subject") {
      const value = this.subject(subjectId);
      return entityId === subjectId ? (value as unknown as Snapshot) : null;
    }
    if (kind === "record")
      return this.record(subjectId, entityId) as unknown as Snapshot;
    const table = {
      curriculum: "curriculum_nodes",
      edge: "curriculum_edges",
      concept: "subject_concepts",
      evidence: "learning_evidence",
      memory: "subject_memory",
      summary: "conversation_summaries",
    }[kind];
    const key = kind === "concept" ? "concept_id" : "id";
    const row = this.db
      .prepare(`SELECT * FROM ${table} WHERE subject_id=? AND ${key}=?`)
      .get(subjectId, entityId) as DbRow | undefined;
    if (!row) return null;
    if (kind === "evidence")
      return {
        id: row.id,
        subjectId,
        conceptId: row.concept_id,
        kind: row.kind,
        content: row.claim,
        conversationId: row.conversation_id || undefined,
        messageId: row.message_id || undefined,
        createdAt: row.created_at,
        ...parse<DbRow>(row.value),
      };
    return parse<Snapshot>(row.value);
  }
  private ownNode(subjectId: string, nodeId: string) {
    const node = this.readEntity(subjectId, "curriculum", nodeId);
    if (!node)
      throw new Error(
        "A curriculum relationship refers to a missing node in this subject.",
      );
    return node;
  }
  private validateGraph(subjectId: string) {
    const nodes = this.rows<CurriculumNode>(
      "curriculum_nodes",
      subjectId,
      30000,
    );
    const ids = new Set(nodes.map((node) => node.id));
    const assertAcyclic = (pairs: [string, string][], label: string) => {
      const degree = new Map(nodes.map((node) => [node.id, 0]));
      const outgoing = new Map<string, string[]>();
      for (const [from, to] of pairs) {
        degree.set(to, (degree.get(to) || 0) + 1);
        const list = outgoing.get(from) || [];
        list.push(to);
        outgoing.set(from, list);
      }
      const queue = nodes
        .filter((node) => !degree.get(node.id))
        .map((node) => node.id);
      for (let head = 0; head < queue.length; head++)
        for (const next of outgoing.get(queue[head]) || []) {
          degree.set(next, degree.get(next)! - 1);
          if (!degree.get(next)) queue.push(next);
        }
      if (queue.length !== nodes.length)
        throw new Error(label + " would contain a cycle.");
    };
    for (const node of nodes) {
      if (node.parentId && !ids.has(node.parentId))
        throw new Error(
          "A curriculum parent belongs to a different subject or is missing.",
        );
      if (
        node.conceptId &&
        !this.readEntity(subjectId, "concept", node.conceptId)
      )
        throw new Error(
          "A curriculum node refers to a missing subject concept.",
        );
    }
    assertAcyclic(
      nodes
        .filter((node) => node.parentId)
        .map((node) => [node.parentId!, node.id]),
      "Curriculum hierarchy",
    );
    const edges = this.rows<CurriculumEdge>("curriculum_edges", subjectId);
    const graph = new Map<string, string[]>();
    for (const edge of edges) {
      if (
        !ids.has(edge.nodeId) ||
        !ids.has(edge.prerequisiteId) ||
        edge.nodeId === edge.prerequisiteId
      )
        throw new Error(
          "A prerequisite must connect two existing, distinct nodes in the same subject.",
        );
      const list = graph.get(edge.nodeId) || [];
      list.push(edge.prerequisiteId);
      graph.set(edge.nodeId, list);
    }
    assertAcyclic(
      [...graph.entries()].flatMap(([from, targets]) =>
        targets.map((to) => [from, to] as [string, string]),
      ),
      "Prerequisite relationships",
    );
  }
  private putEntity(
    subjectId: string,
    kind: Entity,
    entityId: string,
    raw: Record<string, unknown>,
    options: { origin: string; accepted: boolean; preserveRevision?: boolean },
  ) {
    const previous = this.readEntity(subjectId, kind, entityId);
    const at = now();
    if (kind === "subject") {
      if (entityId !== subjectId)
        throw new Error("Subject updates cannot change identity.");
      const subject = this.subject(subjectId);
      const value = z
        .object({
          name: short,
          objective: text,
          depth: z.enum(["overview", "comprehensive", "advanced"]),
          archived: z.boolean(),
          currentNodeId: id.optional(),
        })
        .parse({ ...subject, ...raw, id: subjectId });
      if (value.currentNodeId) this.ownNode(subjectId, value.currentNodeId);
      const alias = normalizeSubjectName(value.name);
      const owner = this.db
        .prepare("SELECT subject_id FROM subject_aliases WHERE alias=?")
        .get(alias) as DbRow | undefined;
      if (owner && owner.subject_id !== subjectId)
        throw new Error("Another subject already uses this name.");
      this.db
        .prepare(
          "UPDATE subjects SET name=?,objective=?,depth=?,archived=?,current_node_id=?,updated_at=? WHERE id=?",
        )
        .run(
          value.name.trim(),
          value.objective,
          value.depth,
          Number(value.archived),
          value.currentNodeId || null,
          at,
          subjectId,
        );
      this.db
        .prepare(
          "INSERT OR IGNORE INTO subject_aliases(alias,subject_id) VALUES(?,?)",
        )
        .run(alias, subjectId);
      indexSubjectEntity(
        this.db,
        subjectId,
        "subject",
        subjectId,
        value.name,
        value.objective,
      );
      return;
    }
    if (kind === "curriculum") {
      if (previous?.userEdited && options.origin === "ai" && !options.accepted)
        throw new Error(
          "This curriculum node contains learner edits. Review and explicitly accept its proposed replacement.",
        );
      const value = z
        .object({
          parentId: id.optional(),
          kind: z.enum(["module", "topic", "lesson", "concept"]),
          title: short,
          description: text.default(""),
          position: z.number().finite().min(-100000).max(100000).default(0),
          status: nodeStatus.default("not-started"),
          conceptId: id.optional(),
          userEdited: z.boolean().default(options.origin !== "ai"),
          skipped: z.boolean().default(false),
          sourceMessageId: id.optional(),
        })
        .parse({ ...previous, ...raw });
      if (previous?.userEdited && options.origin === "ai")
        value.userEdited = true;
      if (
        value.conceptId &&
        !this.db
          .prepare(
            "SELECT 1 FROM subject_concepts WHERE subject_id=? AND concept_id=?",
          )
          .get(subjectId, value.conceptId)
      )
        throw new Error("A curriculum concept must belong to this subject.");
      if (value.status === "demonstrated") {
        const concept = value.conceptId
          ? this.readEntity(subjectId, "concept", value.conceptId)
          : null;
        if (
          !concept ||
          concept.status !== "demonstrated" ||
          !String(concept.evidence || "").trim()
        )
          throw new Error(
            "Demonstrated curriculum understanding requires a linked subject concept with demonstrated understanding and explicit evidence.",
          );
        if (
          options.origin === "ai" &&
          !options.accepted &&
          previous?.status !== "demonstrated"
        )
          throw new Error(
            "Review and explicitly accept AI proposals that mark understanding as demonstrated.",
          );
      }
      const record = {
        ...value,
        id: entityId,
        subjectId,
        revision: options.preserveRevision
          ? Number(raw.revision) || 1
          : Number(previous?.revision || 0) + 1,
        createdAt: String(previous?.createdAt || raw.createdAt || at),
        updatedAt: at,
      };
      this.db
        .prepare(
          "INSERT INTO curriculum_nodes(id,subject_id,parent_id,kind,title,status,ordinal,concept_id,version,value,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET parent_id=excluded.parent_id,kind=excluded.kind,title=excluded.title,status=excluded.status,ordinal=excluded.ordinal,concept_id=excluded.concept_id,version=excluded.version,value=excluded.value,updated_at=excluded.updated_at",
        )
        .run(
          entityId,
          subjectId,
          value.parentId || null,
          value.kind,
          value.title,
          value.status,
          value.position,
          value.conceptId || null,
          record.revision,
          serialized(record, 100000),
          record.createdAt,
          at,
        );
      indexSubjectEntity(
        this.db,
        subjectId,
        "curriculum",
        entityId,
        value.title,
        value.description,
      );
      return;
    }
    if (kind === "edge") {
      const value = z.object({ nodeId: id, prerequisiteId: id }).parse(raw);
      this.ownNode(subjectId, value.nodeId);
      this.ownNode(subjectId, value.prerequisiteId);
      const record = { id: entityId, subjectId, ...value };
      this.db
        .prepare(
          "INSERT INTO curriculum_edges(id,subject_id,source_id,target_id,kind,value) VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET source_id=excluded.source_id,target_id=excluded.target_id,value=excluded.value",
        )
        .run(
          entityId,
          subjectId,
          value.prerequisiteId,
          value.nodeId,
          "prerequisite",
          serialized(record),
        );
      return;
    }
    if (kind === "concept") {
      const value = z
        .object({
          label: short,
          status: status.default("unassessed"),
          coverage: coverage.default("not-started"),
          evidence: z.string().max(2_000_000).default(""),
          lessonId: id.optional(),
        })
        .parse({ ...previous, ...raw });
      if (
        value.status === "demonstrated" &&
        !value.evidence.trim() &&
        !this.db
          .prepare(
            "SELECT 1 FROM learning_evidence WHERE subject_id=? AND concept_id=? LIMIT 1",
          )
          .get(subjectId, entityId)
      )
        throw new Error(
          "Demonstrated understanding requires explicit supporting evidence. Coverage alone is not mastery.",
        );
      if (
        value.status === "demonstrated" &&
        options.origin === "ai" &&
        !options.accepted
      )
        throw new Error(
          "An AI assessment of demonstrated understanding requires explicit proposal review.",
        );
      if (
        value.lessonId &&
        !this.db
          .prepare("SELECT 1 FROM conversations WHERE id=? AND subject_id=?")
          .get(value.lessonId, subjectId)
      )
        throw new Error(
          "Concept evidence cannot silently link a different subject conversation.",
        );
      const old = this.db
        .prepare("SELECT value FROM concepts WHERE id=?")
        .get(entityId) as { value: string } | undefined;
      const canonicalOwner = old
        ? parse<Concept>(old.value).subjectId
        : undefined;
      if (
        (canonicalOwner && canonicalOwner !== subjectId) ||
        (old &&
          this.db
            .prepare(
              "SELECT 1 FROM subject_concepts WHERE concept_id=? AND subject_id<>? LIMIT 1",
            )
            .get(entityId, subjectId))
      )
        throw new Error(
          "This concept ID belongs to another subject. Use a distinct scoped concept ID.",
        );
      const canonical = {
        ...(old ? parse<Concept>(old.value) : {}),
        id: entityId,
        subjectId,
        subjectRevision: Number(previous?.revision || 0) + 1,
        updatedAt: at,
        label: value.label,
        status: value.status,
        evidence: value.evidence,
        lessonId: value.lessonId,
      };
      this.db
        .prepare(
          "INSERT INTO concepts(id,value) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value",
        )
        .run(entityId, serialized(canonical));
      const record = {
        ...value,
        id: entityId,
        subjectId,
        revision: options.preserveRevision
          ? Number(raw.revision) || 1
          : Number(previous?.revision || 0) + 1,
        createdAt: String(previous?.createdAt || raw.createdAt || at),
        updatedAt: at,
      };
      this.db
        .prepare(
          "INSERT INTO subject_concepts(subject_id,concept_id,version,value,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(subject_id,concept_id) DO UPDATE SET version=excluded.version,value=excluded.value,updated_at=excluded.updated_at",
        )
        .run(subjectId, entityId, record.revision, serialized(record), at);
      indexSubjectEntity(
        this.db,
        subjectId,
        "concept",
        entityId,
        value.label,
        value.evidence,
      );
      return;
    }
    if (kind === "evidence") {
      const value = z
        .object({
          conceptId: id,
          kind: z.enum(["learner-statement", "assessment", "manual", "review"]),
          content: z.string().min(1).max(20000),
          conversationId: id.optional(),
          messageId: id.optional(),
          reviewAttemptId: id.optional(),
        })
        .parse(raw);
      if (!this.readEntity(subjectId, "concept", value.conceptId))
        throw new Error("Evidence must refer to an existing subject concept.");
      if (
        value.conversationId &&
        !this.db
          .prepare("SELECT 1 FROM conversations WHERE id=? AND subject_id=?")
          .get(value.conversationId, subjectId)
      )
        throw new Error(
          "Evidence conversation belongs to a different subject.",
        );
      if (
        value.messageId &&
        !this.transcript({
          conversationId: value.conversationId || "",
          limit: 10000,
        }).some((message) => message.id === value.messageId)
      )
        throw new Error("Evidence refers to a missing source message.");
      const record = {
        ...value,
        id: entityId,
        subjectId,
        createdAt: String(previous?.createdAt || raw.createdAt || at),
      };
      this.db
        .prepare(
          "INSERT INTO learning_evidence(id,subject_id,concept_id,conversation_id,message_id,kind,claim,value,created_at) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET claim=excluded.claim,value=excluded.value",
        )
        .run(
          entityId,
          subjectId,
          value.conceptId,
          value.conversationId || null,
          value.messageId || null,
          value.kind,
          value.content,
          serialized(record),
          record.createdAt,
        );
      return;
    }
    if (kind === "memory") {
      const value = z
        .object({
          kind: z.enum([
            "objective",
            "position",
            "finding",
            "explanation",
            "question",
            "misconception",
            "coverage",
            "summary",
          ]),
          title: short,
          content: text,
          conceptIds: z.array(id).max(50).default([]),
          conversationId: id.optional(),
          messageId: id.optional(),
          resourceId: id.optional(),
        })
        .parse({ ...previous, ...raw });
      if (
        value.conceptIds.some(
          (conceptId) => !this.readEntity(subjectId, "concept", conceptId),
        )
      )
        throw new Error("Memory references a missing subject concept.");
      if (
        value.conversationId &&
        !this.db
          .prepare("SELECT 1 FROM conversations WHERE id=? AND subject_id=?")
          .get(value.conversationId, subjectId)
      )
        throw new Error("Memory cannot point into a different subject.");
      const record = {
        ...value,
        id: entityId,
        subjectId,
        revision: options.preserveRevision
          ? Number(raw.revision) || 1
          : Number(previous?.revision || 0) + 1,
        createdAt: String(previous?.createdAt || raw.createdAt || at),
        updatedAt: at,
      };
      this.db
        .prepare(
          "INSERT INTO subject_memory(id,subject_id,kind,memory_key,value,version,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET kind=excluded.kind,value=excluded.value,version=excluded.version,updated_at=excluded.updated_at",
        )
        .run(
          entityId,
          subjectId,
          value.kind,
          entityId,
          serialized(record, 100000),
          record.revision,
          record.createdAt,
          at,
        );
      indexSubjectEntity(
        this.db,
        subjectId,
        "memory",
        entityId,
        value.title,
        value.content,
      );
      return;
    }
    if (kind === "summary") {
      const value = z
        .object({
          conversationId: id,
          throughMessageId: id.optional(),
          title: short.default("Conversation summary"),
          content: text,
          conceptIds: z.array(id).max(50).default([]),
        })
        .parse({ ...previous, ...raw });
      if (
        !this.db
          .prepare("SELECT 1 FROM conversations WHERE id=? AND subject_id=?")
          .get(value.conversationId, subjectId)
      )
        throw new Error("A summary must refer to this subject conversation.");
      if (
        value.throughMessageId &&
        !this.transcript({
          conversationId: value.conversationId,
          limit: 10000,
        }).some((message) => message.id === value.throughMessageId)
      )
        throw new Error("Summary position refers to a missing message.");
      const record = {
        ...value,
        id: entityId,
        subjectId,
        revision: Number(previous?.revision || 0) + 1,
        createdAt: String(previous?.createdAt || at),
        updatedAt: at,
      };
      this.db
        .prepare(
          "INSERT INTO conversation_summaries(id,subject_id,conversation_id,through_message_id,version,value,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET through_message_id=excluded.through_message_id,version=excluded.version,value=excluded.value,updated_at=excluded.updated_at",
        )
        .run(
          entityId,
          subjectId,
          value.conversationId,
          value.throughMessageId || null,
          record.revision,
          serialized(record, 100000),
          record.createdAt,
          at,
        );
      indexSubjectEntity(
        this.db,
        subjectId,
        "summary",
        entityId,
        value.title,
        value.content,
      );
      return;
    }
    const persisted = this.db
      .prepare("SELECT * FROM subject_records WHERE id=? AND subject_id=?")
      .get(entityId, subjectId) as DbRow | undefined;
    const restoreAsset =
      persisted?.kind === "asset" &&
      raw.recordType === "asset" &&
      raw.data === undefined;
    const value = z
      .object({ recordType, title: short, data: z.unknown() })
      .parse({
        ...previous,
        ...raw,
        ...(restoreAsset ? { data: parse(persisted!.value) } : {}),
      });
    value.data = validatedRecordData(value.recordType, value.data, {
      id: entityId,
      subjectId,
      title: value.title,
    });
    if (persisted && persisted.kind !== value.recordType)
      throw new Error(
        "A saved record cannot change content type. Save a new record instead.",
      );
    const data = serialized(value.data);
    if (persisted?.kind === "asset" && persisted.value !== data)
      throw new Error(
        "Original asset records are immutable. Store a new asset ID instead.",
      );
    const revision = options.preserveRevision
      ? Number(raw.revision) || 1
      : Number(previous?.revision || persisted?.version || 0) + 1;
    this.db
      .prepare(
        "INSERT INTO subject_records(id,subject_id,kind,title,version,value,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET title=excluded.title,version=excluded.version,value=excluded.value,archived=0,updated_at=excluded.updated_at",
      )
      .run(
        entityId,
        subjectId,
        value.recordType,
        value.title,
        revision,
        data,
        String(
          previous?.createdAt || persisted?.created_at || raw.createdAt || at,
        ),
        at,
      );
    this.db
      .prepare(
        "INSERT OR IGNORE INTO record_revisions(id,record_id,subject_id,version,value,reason,created_at) VALUES(?,?,?,?,?,?,?)",
      )
      .run(
        randomUUID(),
        entityId,
        subjectId,
        revision,
        serialized({
          id: entityId,
          subjectId,
          ...value,
          data: value.recordType === "asset" ? undefined : value.data,
          ...(value.recordType === "asset" ? { assetId: entityId } : {}),
          revision,
        }),
        options.origin,
        at,
      );
    indexSubjectEntity(
      this.db,
      subjectId,
      value.recordType,
      entityId,
      value.title,
      value.recordType === "asset" ? "" : this.recordText(value.data),
    );
  }
  private recordText(data: unknown): string {
    const obj = data && typeof data === "object" ? (data as DbRow) : {};
    return [
      obj.markdown,
      obj.text,
      obj.caption,
      Array.isArray(obj.tags) ? obj.tags.join(" ") : "",
    ]
      .filter((value) => typeof value === "string")
      .join(" ")
      .slice(0, 60000);
  }
  private deleteEntity(subjectId: string, kind: Entity, entityId: string) {
    if (kind === "subject")
      throw new Error(
        "Archive a subject instead of deleting its learning history.",
      );
    if (kind === "concept") {
      if (
        this.db
          .prepare(
            "SELECT 1 FROM curriculum_nodes WHERE subject_id=? AND concept_id=? LIMIT 1",
          )
          .get(subjectId, entityId)
      )
        throw new Error(
          "Unlink curriculum nodes before removing their concept. Learning evidence is preserved until the removal is explicit.",
        );
      if (
        this.db
          .prepare(
            "SELECT 1 FROM relations WHERE json_extract(value,'$.source')=? OR json_extract(value,'$.target')=? LIMIT 1",
          )
          .get(entityId, entityId)
      )
        throw new Error(
          "Remove this concept’s knowledge-graph connections before removing the concept.",
        );
      if (
        (this.store.load().reviewCards || []).some(
          (card) => card.conceptId === entityId,
        )
      )
        throw new Error(
          "This concept has saved practice cards. Keep or relink their learning evidence before removing it.",
        );
      if (
        this.db
          .prepare(
            "SELECT 1 FROM learning_evidence WHERE subject_id=? AND concept_id=? LIMIT 1",
          )
          .get(subjectId, entityId)
      )
        throw new Error(
          "This concept has recorded assessment evidence. Retain the concept or explicitly resolve its evidence before removing it.",
        );
      this.db
        .prepare(
          "DELETE FROM subject_concepts WHERE subject_id=? AND concept_id=?",
        )
        .run(subjectId, entityId);
      if (
        !this.db
          .prepare("SELECT 1 FROM subject_concepts WHERE concept_id=? LIMIT 1")
          .get(entityId)
      )
        this.db.prepare("DELETE FROM concepts WHERE id=?").run(entityId);
    } else if (kind === "record") {
      this.db
        .prepare(
          "UPDATE subject_records SET archived=1,version=version+1,updated_at=? WHERE id=? AND subject_id=?",
        )
        .run(now(), entityId, subjectId);
    } else {
      const table = {
        curriculum: "curriculum_nodes",
        edge: "curriculum_edges",
        evidence: "learning_evidence",
        memory: "subject_memory",
        summary: "conversation_summaries",
      }[kind];
      this.db
        .prepare(`DELETE FROM ${table} WHERE subject_id=? AND id=?`)
        .run(subjectId, entityId);
    }
    this.db
      .prepare("DELETE FROM subject_search WHERE subject_id=? AND record_id=?")
      .run(subjectId, entityId);
  }
  private applyInternal(
    input: {
      subjectId: string;
      baseRevision: number;
      label: string;
      origin: "ai" | "learner" | "migration";
      operations: SubjectOperation[];
      sourceConversationId?: string;
      sourceMessageId?: string;
    },
    accepted = false,
    reversesId?: string,
  ): SubjectRevision {
    const subject = this.checkRevision(input.subjectId, input.baseRevision);
    const operations = z
      .array(operationSchema)
      .min(1)
      .max(10000)
      .parse(input.operations);
    // A node removal reparents surviving children and removes incident edges in the same reversible revision.
    const removing = new Set(
      operations
        .filter((op) => op.entity === "curriculum" && op.op === "delete")
        .map((op) => op.id),
    );
    const explicit = new Set(operations.map((op) => op.entity + "|" + op.id));
    const survivingParent = (nodeId: string): string | undefined => {
      let node = this.readEntity(input.subjectId, "curriculum", nodeId);
      const visited = new Set<string>();
      while (node?.parentId && removing.has(String(node.parentId))) {
        if (visited.has(String(node.parentId)))
          throw new Error("Curriculum parents contain a cycle.");
        visited.add(String(node.parentId));
        node = this.readEntity(
          input.subjectId,
          "curriculum",
          String(node.parentId),
        );
      }
      return node?.parentId ? String(node.parentId) : undefined;
    };
    for (const nodeId of removing) {
      for (const row of this.db
        .prepare(
          "SELECT id FROM curriculum_edges WHERE subject_id=? AND (source_id=? OR target_id=?)",
        )
        .all(input.subjectId, nodeId, nodeId) as { id: string }[])
        if (!explicit.has("edge|" + row.id)) {
          operations.push({ entity: "edge", op: "delete", id: row.id });
          explicit.add("edge|" + row.id);
        }
      for (const row of this.db
        .prepare(
          "SELECT id FROM curriculum_nodes WHERE subject_id=? AND parent_id=?",
        )
        .all(input.subjectId, nodeId) as { id: string }[])
        if (!removing.has(row.id) && !explicit.has("curriculum|" + row.id)) {
          operations.push({
            entity: "curriculum",
            op: "put",
            id: row.id,
            value: { parentId: survivingParent(row.id) },
          });
          explicit.add("curriculum|" + row.id);
        }
    }
    const seen = new Set<string>();
    for (const op of operations) {
      const identity = op.entity + "|" + op.id;
      if (seen.has(identity))
        throw new Error("A revision cannot write the same entity twice.");
      seen.add(identity);
      if (op.op === "put" && !op.value)
        throw new Error("A put operation requires validated content.");
    }
    if (
      input.sourceConversationId &&
      !this.db
        .prepare("SELECT 1 FROM conversations WHERE id=? AND subject_id=?")
        .get(input.sourceConversationId, input.subjectId)
    )
      throw new Error("Revision provenance points into another subject.");
    if (
      input.sourceMessageId &&
      (!input.sourceConversationId ||
        !this.transcript({
          conversationId: input.sourceConversationId,
          limit: 10000,
        }).some((message) => message.id === input.sourceMessageId))
    )
      throw new Error(
        "Revision provenance refers to a missing source message.",
      );
    const changes: Change[] = [];
    const at = now(),
      revisionId = randomUUID();
    this.db.transaction(() => {
      this.db.pragma("defer_foreign_keys=ON");
      this.checkRevision(input.subjectId, input.baseRevision);
      const puts = operations.filter((op) => op.op === "put");
      const deletes = operations.filter((op) => op.op === "delete");
      const sorted: typeof puts = [];
      const remaining = [...puts];
      while (remaining.length) {
        let progressed = false;
        for (let i = remaining.length - 1; i >= 0; i--) {
          const op = remaining[i];
          if (
            op.entity === "curriculum" &&
            op.value?.parentId &&
            !this.readEntity(
              input.subjectId,
              "curriculum",
              String(op.value.parentId),
            ) &&
            !sorted.some(
              (before) =>
                before.entity === "curriculum" &&
                before.id === op.value!.parentId,
            )
          )
            continue;
          sorted.push(op);
          remaining.splice(i, 1);
          progressed = true;
        }
        if (!progressed)
          throw new Error("Curriculum parents are missing or cyclic.");
      }
      const rank: Record<Entity, number> = {
        subject: 7,
        concept: 2,
        curriculum: 3,
        memory: 4,
        summary: 4,
        evidence: 5,
        record: 5,
        edge: 6,
      };
      sorted.sort((a, b) => rank[a.entity] - rank[b.entity]);
      for (const op of [
        ...deletes.filter((op) => op.entity === "edge"),
        ...deletes.filter((op) => op.entity !== "edge"),
        ...sorted,
      ]) {
        const before = this.readEntity(input.subjectId, op.entity, op.id);
        if (op.op === "put") {
          const table =
            op.entity === "curriculum"
              ? "curriculum_nodes"
              : op.entity === "record"
                ? "subject_records"
                : op.entity === "memory"
                  ? "subject_memory"
                  : op.entity === "evidence"
                    ? "learning_evidence"
                    : op.entity === "edge"
                      ? "curriculum_edges"
                      : op.entity === "summary"
                        ? "conversation_summaries"
                        : undefined;
          if (table) {
            const owner = this.db
              .prepare(`SELECT subject_id FROM ${table} WHERE id=?`)
              .get(op.id) as { subject_id: string } | undefined;
            if (owner && owner.subject_id !== input.subjectId)
              throw new Error(
                "An entity ID already belongs to a different subject.",
              );
          }
          this.putEntity(input.subjectId, op.entity, op.id, op.value!, {
            origin: input.origin,
            accepted,
          });
        } else {
          if (
            op.entity === "curriculum" &&
            before?.userEdited &&
            input.origin === "ai" &&
            !accepted
          )
            throw new Error(
              "A learner-edited curriculum node can only be removed after explicit proposal review.",
            );
          this.deleteEntity(input.subjectId, op.entity, op.id);
        }
        const after = this.readEntity(input.subjectId, op.entity, op.id);
        if (JSON.stringify(before) !== JSON.stringify(after))
          changes.push({
            entity: op.entity,
            id: op.id,
            before: revisionValue(before),
            after: revisionValue(after),
          });
        if (
          !reversesId &&
          op.op === "put" &&
          op.entity === "concept" &&
          after?.evidence &&
          (before?.evidence !== after.evidence ||
            before?.status !== after.status)
        ) {
          const evidenceId =
            "assessment-" + revisionId + "-" + op.id.slice(0, 80);
          const evidence = {
            conceptId: op.id,
            kind: input.origin === "ai" ? "assessment" : "manual",
            content: String(after.evidence).slice(0, 20000),
            conversationId: input.sourceConversationId || after.lessonId,
            messageId: input.sourceMessageId,
          };
          this.putEntity(input.subjectId, "evidence", evidenceId, evidence, {
            origin: input.origin,
            accepted,
          });
          changes.push({
            entity: "evidence",
            id: evidenceId,
            before: null,
            after: this.readEntity(input.subjectId, "evidence", evidenceId),
          });
        }
      }
      this.validateGraph(input.subjectId);
      const revision = subject.revision + 1;
      this.db
        .prepare("UPDATE subjects SET version=?,updated_at=? WHERE id=?")
        .run(revision, at, input.subjectId);
      const parent = this.db
        .prepare(
          "SELECT id FROM subject_revisions WHERE subject_id=? ORDER BY version DESC LIMIT 1",
        )
        .get(input.subjectId) as { id: string } | undefined;
      this.db
        .prepare(
          "INSERT INTO subject_revisions(id,subject_id,version,parent_id,kind,actor,reason,source_conversation_id,source_message_id,operations,reverses_id,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
        )
        .run(
          revisionId,
          input.subjectId,
          revision,
          parent?.id || null,
          reversesId ? "rollback" : "apply",
          input.origin,
          input.label.slice(0, 1000),
          input.sourceConversationId || null,
          input.sourceMessageId || null,
          serialized(changes, 50_000_000),
          reversesId || null,
          at,
        );
    })();
    return {
      id: revisionId,
      subjectId: input.subjectId,
      baseRevision: subject.revision,
      revision: subject.revision + 1,
      label: input.label,
      origin: input.origin,
      status: reversesId ? "rolled-back" : "applied",
      operations: clone(input.operations),
      sourceConversationId: input.sourceConversationId,
      sourceMessageId: input.sourceMessageId,
      createdAt: at,
    };
  }
  propose(input: unknown): SubjectRevision {
    const value = z
      .object({
        subjectId: id,
        baseRevision: z.number().int().min(1),
        label: z.string().min(1).max(1000),
        origin: z.enum(["ai", "learner", "migration"]).default("ai"),
        operations: z.array(operationSchema).min(1).max(10000),
        sourceConversationId: id.optional(),
        sourceMessageId: id.optional(),
      })
      .parse(input);
    this.checkRevision(value.subjectId, value.baseRevision);
    serialized(value.operations, 30_000_000);
    const validationComplete = Symbol("proposal-validation-complete");
    try {
      this.db.transaction(() => {
        this.applyInternal(value, true);
        throw validationComplete;
      })();
    } catch (error) {
      if (error !== validationComplete) throw error;
    }
    const proposal: SubjectRevision = {
      ...value,
      id: randomUUID(),
      status: "proposed",
      createdAt: now(),
    };
    this.db
      .prepare(
        "INSERT INTO memory_proposals(id,subject_id,base_version,state,value,created_at) VALUES(?,?,?,?,?,?)",
      )
      .run(
        proposal.id,
        proposal.subjectId,
        proposal.baseRevision,
        "proposed",
        serialized(proposal, 30_000_000),
        proposal.createdAt,
      );
    return proposal;
  }
  apply(input: unknown, accepted = false): SubjectRevision {
    const value = z
      .object({
        subjectId: id,
        baseRevision: z.number().int().min(1),
        label: z.string().min(1).max(1000),
        origin: z.enum(["ai", "learner", "migration"]).default("learner"),
        operations: z.array(operationSchema).min(1).max(10000),
        sourceConversationId: id.optional(),
        sourceMessageId: id.optional(),
      })
      .parse(input);
    return this.db.transaction(() => {
      const baseRevision =
        value.origin === "learner"
          ? this.safeRebase(value, accepted)
          : value.baseRevision;
      return this.applyInternal({ ...value, baseRevision }, accepted);
    })();
  }
  private safeRebase(
    input: {
      subjectId: string;
      baseRevision: number;
      label: string;
      origin: "ai" | "learner" | "migration";
      operations: SubjectOperation[];
      sourceConversationId?: string;
      sourceMessageId?: string;
    },
    accepted: boolean,
  ): number {
    const current = this.subject(input.subjectId);
    if (input.baseRevision === current.revision) return current.revision;
    if (input.baseRevision > current.revision)
      throw new Error(
        "Subject revision conflict: the supplied source version does not exist. Refresh before applying changes.",
      );
    let touched = new Set(
      input.operations.map(
        (operation) => operation.entity + "|" + operation.id,
      ),
    );
    const previewComplete = Symbol("rebase-preview");
    try {
      this.db.transaction(() => {
        const preview = this.applyInternal(
          { ...input, baseRevision: current.revision },
          accepted,
        );
        const changed = this.db
          .prepare("SELECT operations FROM subject_revisions WHERE id=?")
          .get(preview.id) as { operations: string };
        touched = new Set([
          ...touched,
          ...parse<Change[]>(changed.operations).map(
            (change) => change.entity + "|" + change.id,
          ),
        ]);
        throw previewComplete;
      })();
    } catch (error) {
      if (error !== previewComplete) throw error;
    }
    const intervening = this.db
      .prepare(
        "SELECT operations FROM subject_revisions WHERE subject_id=? AND version>? ORDER BY version",
      )
      .all(input.subjectId, input.baseRevision) as { operations: string }[];
    if (
      intervening.length !== current.revision - input.baseRevision ||
      intervening.some((revision) =>
        parse<Change[]>(revision.operations).some((change) =>
          touched.has(change.entity + "|" + change.id),
        ),
      )
    )
      throw new Error(
        "Subject revision conflict: an affected record was edited after this draft. Your content is preserved; refresh the newer record before applying it.",
      );
    return current.revision;
  }
  accept(input: { subjectId: string; proposalId: string }) {
    this.subject(input.subjectId);
    const row = this.db
      .prepare(
        "SELECT value FROM memory_proposals WHERE id=? AND subject_id=? AND state='proposed'",
      )
      .get(input.proposalId, input.subjectId) as { value: string } | undefined;
    if (!row)
      throw new Error("This proposal is missing or was already handled.");
    return this.db.transaction(() => {
      const proposal = parse<SubjectRevision>(row.value),
        current = this.subject(input.subjectId);
      if (proposal.baseRevision !== current.revision) {
        try {
          this.safeRebase(proposal, true);
        } catch (error) {
          if (
            error instanceof Error &&
            error.message.includes("revision conflict")
          )
            throw new Error(
              "Proposal conflict: an affected record was edited after this proposal. Your draft is preserved; regenerate or review the newer record before accepting.",
            );
          throw error;
        }
      }
      const revision = this.applyInternal(
        { ...proposal, baseRevision: current.revision },
        true,
      );
      this.db
        .prepare(
          "UPDATE memory_proposals SET state='applied',applied_revision_id=? WHERE id=?",
        )
        .run(revision.id, input.proposalId);
      return revision;
    })();
  }
  rollback(input: {
    subjectId: string;
    revisionId: string;
    expectedRevision?: number;
  }): SubjectRevision {
    const subject = this.checkRevision(input.subjectId, input.expectedRevision);
    const row = this.db
      .prepare("SELECT * FROM subject_revisions WHERE id=? AND subject_id=?")
      .get(input.revisionId, input.subjectId) as DbRow | undefined;
    if (!row) throw new Error("This revision is not part of the subject.");
    const changes = parse<Change[]>(row.operations);
    for (const change of changes) {
      const current = this.readEntity(
        input.subjectId,
        change.entity,
        change.id,
      );
      const comparable = (value: Snapshot) => {
        if (!value) return value;
        const copy = { ...revisionValue(value) };
        delete copy.updatedAt;
        delete copy.revision;
        return copy;
      };
      if (
        JSON.stringify(comparable(current)) !==
        JSON.stringify(comparable(change.after))
      )
        throw new Error(
          "Rollback conflict: an affected record was edited later. Undo the later edit first.",
        );
    }
    return this.applyInternal(
      {
        subjectId: input.subjectId,
        baseRevision: subject.revision,
        label: "Undo: " + row.reason,
        origin: "learner",
        operations: changes
          .slice()
          .reverse()
          .map((change) => ({
            entity: change.entity,
            id: change.id,
            op: change.before ? "put" : "delete",
            value: change.before || undefined,
          })),
      },
      true,
      input.revisionId,
    );
  }
  conversationCreate(input: unknown): Lesson {
    const value = z
      .object({
        subjectId: id,
        title: short,
        objective: text.optional(),
        mode: z
          .enum(["Learn", "Explore", "Deep Dive", "Practice", "Review"])
          .default("Learn"),
        curriculumNodeId: id.optional(),
      })
      .parse(input);
    const subject = this.subject(value.subjectId);
    if (value.curriculumNodeId)
      this.ownNode(value.subjectId, value.curriculumNodeId);
    const at = now();
    const lesson: Lesson = {
      id: randomUUID(),
      subject: subject.name,
      subjectId: subject.id,
      title: value.title,
      objective: value.objective || subject.objective || value.title,
      mode: value.mode,
      position: "Beginning",
      messages: [],
      notes: "",
      createdAt: at,
      updatedAt: at,
      curriculumNodeId: value.curriculumNodeId,
    };
    this.db.transaction(() => {
      const { messages: _messages, ...rest } = lesson;
      this.db
        .prepare("INSERT INTO lessons(id,value) VALUES(?,?)")
        .run(lesson.id, serialized(rest));
      syncLegacySubjects(
        this.db,
        { lessons: [lesson], concepts: [], library: [], relations: [] } as any,
        { partial: true },
      );
      indexSubjectEntity(
        this.db,
        subject.id,
        "conversation",
        lesson.id,
        lesson.title,
        lesson.objective,
      );
    })();
    return lesson;
  }
  private resolvedTranscript(
    conversationId: string,
    limit?: number,
  ): Message[] {
    const path: DbRow[] = [],
      seen = new Set<string>();
    let cursor: string | undefined = id.parse(conversationId);
    while (cursor) {
      if (seen.has(cursor) || seen.size >= 40)
        throw new Error("Conversation branch ancestry is cyclic or too deep.");
      seen.add(cursor);
      const row = this.db
        .prepare("SELECT * FROM conversations WHERE id=?")
        .get(cursor) as DbRow | undefined;
      if (!row) throw new Error("The conversation is missing.");
      path.unshift(row);
      cursor = row.parent_id || undefined;
    }
    const levels = new Map(
        path.map((row, index) => [row.legacy_lesson_id, index]),
      ),
      cutoffs = path.map(() => Number.MAX_SAFE_INTEGER);
    for (let level = 1; level < path.length; level++) {
      const row = path[level],
        boundary = this.db
          .prepare("SELECT lesson_id,ordinal FROM messages WHERE id=?")
          .get(row.branch_message_id) as
          { lesson_id: string; ordinal: number } | undefined,
        owner = boundary ? levels.get(boundary.lesson_id) : undefined;
      if (
        !boundary ||
        owner === undefined ||
        owner >= level ||
        boundary.ordinal > cutoffs[owner] ||
        path[owner].subject_id !== row.subject_id
      )
        throw new Error(
          "The original branch message is no longer available. Restore its parent conversation to recover this branch.",
        );
      cutoffs[owner] = boundary.ordinal;
      for (let skipped = owner + 1; skipped < level; skipped++)
        cutoffs[skipped] = -1;
    }
    let remaining = limit ?? Number.MAX_SAFE_INTEGER;
    const result: Message[] = [];
    for (let level = path.length - 1; level >= 0 && remaining > 0; level--) {
      if (cutoffs[level] < 0) continue;
      const rows = this.db
        .prepare(
          "SELECT value FROM messages WHERE lesson_id=? AND ordinal<=? ORDER BY ordinal DESC LIMIT ?",
        )
        .all(path[level].legacy_lesson_id, cutoffs[level], remaining) as {
        value: string;
      }[];
      const messages = rows.reverse().map((row) => parse<Message>(row.value));
      result.unshift(...messages);
      remaining -= messages.length;
    }
    return result;
  }
  transcript(input: { conversationId: string; limit?: number }): Message[] {
    return this.resolvedTranscript(
      input.conversationId,
      Math.max(1, Math.min(10000, input.limit || 200)),
    );
  }
  /** Explicit local export path: no model/IPC request receives an unbounded transcript. */
  transcriptAll(conversationId: string): Message[] {
    return this.resolvedTranscript(conversationId);
  }
  branch(input: unknown): Lesson {
    const value = z
      .object({
        subjectId: id,
        conversationId: id,
        messageId: id,
        title: short.optional(),
      })
      .parse(input);
    const subject = this.subject(value.subjectId);
    const source = this.db
      .prepare("SELECT * FROM conversations WHERE id=? AND subject_id=?")
      .get(value.conversationId, value.subjectId) as DbRow | undefined;
    if (!source)
      throw new Error("Choose a source conversation in this subject.");
    if (
      !this.transcript({ conversationId: source.id, limit: 10000 }).some(
        (message) => message.id === value.messageId,
      )
    )
      throw new Error("Choose an existing source message for the branch.");
    const lesson = this.conversationCreate({
      subjectId: subject.id,
      title: value.title || source.title + " · branch",
      objective: parse<DbRow>(source.value).objective || subject.objective,
      mode: parse<DbRow>(source.value).mode || "Explore",
      curriculumNodeId: source.curriculum_node_id || undefined,
    });
    this.db.transaction(() => {
      this.db
        .prepare(
          "UPDATE conversations SET parent_id=?,branch_message_id=? WHERE id=?",
        )
        .run(source.id, value.messageId, lesson.id);
      const row = this.db
        .prepare("SELECT value FROM lessons WHERE id=?")
        .get(lesson.id) as { value: string };
      this.db.prepare("UPDATE lessons SET value=? WHERE id=?").run(
        serialized({
          ...parse<DbRow>(row.value),
          parentConversationId: source.id,
          branchMessageId: value.messageId,
        }),
        lesson.id,
      );
    })();
    return {
      ...lesson,
      parentConversationId: source.id,
      branchMessageId: value.messageId,
    };
  }
  conversationDelete(input: unknown): boolean {
    const value = z.object({ conversationId: id }).parse(input),
      row = this.db
        .prepare("SELECT * FROM conversations WHERE id=?")
        .get(value.conversationId) as DbRow | undefined;
    if (!row) return false;
    if (
      this.db
        .prepare("SELECT 1 FROM conversations WHERE parent_id=? LIMIT 1")
        .get(row.id)
    )
      throw new Error(
        "This conversation is the source of a branch. Delete its branches first, or archive the conversation to preserve their shared transcript.",
      );
    const data = removeLessonReferences(
      this.store.load(),
      row.legacy_lesson_id,
    );
    this.store.checkpointBackup("conversation-delete");
    this.db.transaction(() => {
      const summaryIds = this.db
        .prepare(
          "SELECT id FROM conversation_summaries WHERE conversation_id=?",
        )
        .all(row.id) as { id: string }[];
      for (const summary of summaryIds)
        this.db
          .prepare(
            "DELETE FROM subject_search WHERE entity='summary' AND record_id=?",
          )
          .run(summary.id);
      this.db
        .prepare("DELETE FROM conversation_summaries WHERE conversation_id=?")
        .run(row.id);
      const messageIds = this.db
        .prepare("SELECT id FROM messages WHERE lesson_id=?")
        .all(row.legacy_lesson_id) as { id: string }[];
      for (const message of messageIds)
        this.db
          .prepare(
            "DELETE FROM subject_search WHERE record_id=? AND entity IN ('message','equation','figure')",
          )
          .run(message.id);
      this.db
        .prepare(
          "DELETE FROM subject_search WHERE entity='conversation' AND record_id=?",
        )
        .run(row.id);
      this.db.prepare("DELETE FROM conversations WHERE id=?").run(row.id);
      this.db
        .prepare("DELETE FROM lessons WHERE id=?")
        .run(row.legacy_lesson_id);
      this.db
        .prepare(
          "INSERT OR REPLACE INTO conversation_tombstones(id,subject_id,deleted_at) VALUES(?,?,?)",
        )
        .run(row.id, row.subject_id, now());
      for (const evidence of this.db
        .prepare(
          "SELECT id,value FROM learning_evidence WHERE conversation_id=?",
        )
        .all(row.id) as { id: string; value: string }[]) {
        const old = parse<DbRow>(evidence.value);
        delete old.conversationId;
        delete old.messageId;
        this.db
          .prepare(
            "UPDATE learning_evidence SET conversation_id=NULL,message_id=NULL,value=? WHERE id=?",
          )
          .run(
            serialized({
              ...old,
              sourceDeleted: true,
              originalConversationId: row.id,
            }),
            evidence.id,
          );
      }
      for (const memory of this.db
        .prepare("SELECT id,value FROM subject_memory WHERE subject_id=?")
        .all(row.subject_id) as { id: string; value: string }[]) {
        const old = parse<DbRow>(memory.value);
        if (old.conversationId !== row.id) continue;
        delete old.conversationId;
        delete old.messageId;
        this.db
          .prepare(
            "UPDATE subject_memory SET value=?,version=version+1,updated_at=? WHERE id=?",
          )
          .run(
            serialized({
              ...old,
              revision: Number(old.revision || 0) + 1,
              updatedAt: now(),
            }),
            now(),
            memory.id,
          );
      }
      this.store.save(data);
    })();
    return true;
  }
  search(input: {
    subjectId: string;
    query: string;
    kind?: string;
    kinds?: string[];
    limit?: number;
  }): SubjectSearchResult[] {
    this.subject(input.subjectId);
    const terms =
      String(input.query || "")
        .match(/[\p{L}\p{N}_]+/gu)
        ?.slice(0, 12) || [];
    if (!terms.length) return [];
    const mapping: Record<string, SubjectSearchResult["kind"]> = {
      subject: "curriculum",
      memory: "note",
      summary: "conversation",
      asset: "document",
      finding: "note",
      canvas: "note",
    };
    const wanted = input.kinds?.length
      ? input.kinds
      : input.kind && input.kind !== "all"
        ? [input.kind]
        : undefined;
    const sourceKinds = wanted
      ? [
          ...new Set([
            ...wanted,
            ...Object.keys(mapping).filter((kind) =>
              wanted.includes(mapping[kind]),
            ),
          ]),
        ].slice(0, 30)
      : undefined;
    const match = terms.map((term) => '"' + term + '"*').join(" OR ");
    const rows = this.db
      .prepare(
        `SELECT record_id,entity,title,snippet(subject_search,4,'','','…',32) AS preview FROM subject_search WHERE subject_id=? AND subject_search MATCH ? ${sourceKinds?.length ? "AND entity IN (" + sourceKinds.map(() => "?").join(",") + ")" : ""} ORDER BY bm25(subject_search) LIMIT ?`,
      )
      .all(
        input.subjectId,
        match,
        ...(sourceKinds || []),
        Math.min(100, Math.max(1, input.limit || 30)),
      ) as DbRow[];
    return rows
      .filter(
        (row) => !wanted || wanted.includes(mapping[row.entity] || row.entity),
      )
      .flatMap((row) => {
        const result: SubjectSearchResult = {
          id: row.record_id,
          subjectId: input.subjectId,
          kind: mapping[row.entity] || row.entity,
          title: row.title,
          preview: row.preview,
        };
        if (row.entity === "highlight") {
          const stored = this.db
            .prepare(
              "SELECT value FROM annotation_highlights WHERE id=? AND subject_id=? AND deleted=0",
            )
            .get(row.record_id, input.subjectId) as
            { value: string } | undefined;
          if (!stored) return [];
          const highlight = JSON.parse(stored.value) as {
            sourceKind: string;
            sourceId: string;
            conversationId?: string;
          };
          if (highlight.sourceKind === "message") {
            result.conversationId = highlight.conversationId;
            result.messageId = highlight.sourceId;
          } else if (highlight.sourceKind === "chapter")
            result.recordId = highlight.sourceId;
          else if (highlight.sourceKind === "document")
            result.resourceId = highlight.sourceId;
        } else if (["message", "equation", "figure"].includes(row.entity)) {
          const source = this.db
            .prepare(
              "SELECT m.lesson_id FROM messages m JOIN conversations c ON c.legacy_lesson_id=m.lesson_id WHERE m.id=? AND c.subject_id=?",
            )
            .get(row.record_id, input.subjectId) as
            { lesson_id: string } | undefined;
          if (!source) return [];
          result.conversationId = source.lesson_id;
          result.messageId = row.record_id;
        } else if (row.entity === "summary") {
          const summary = this.db
            .prepare(
              "SELECT conversation_id FROM conversation_summaries WHERE id=? AND subject_id=?",
            )
            .get(row.record_id, input.subjectId) as
            { conversation_id: string } | undefined;
          if (!summary) return [];
          result.conversationId = summary.conversation_id;
        } else if (row.entity === "conversation") {
          if (
            !this.db
              .prepare(
                "SELECT 1 FROM conversations WHERE id=? AND subject_id=?",
              )
              .get(row.record_id, input.subjectId)
          )
            return [];
          result.conversationId = row.record_id;
        } else if (row.entity === "curriculum") {
          if (!this.readEntity(input.subjectId, "curriculum", row.record_id))
            return [];
          result.nodeId = row.record_id;
        } else if (
          this.db
            .prepare(
              "SELECT 1 FROM subject_records WHERE id=? AND subject_id=? AND archived=0",
            )
            .get(row.record_id, input.subjectId)
        )
          result.recordId = row.record_id;
        else if (["document", "reference", "note"].includes(row.entity)) {
          const source = this.db
            .prepare("SELECT value FROM library WHERE id=?")
            .get(row.record_id) as { value: string } | undefined;
          if (!source) return [];
          const item = parse<DbRow>(source.value);
          const alias = this.db
            .prepare("SELECT subject_id FROM subject_aliases WHERE alias=?")
            .get(
              normalizeSubjectName(
                item.kind === "subject"
                  ? item.title
                  : item.subject || "General",
              ),
            ) as { subject_id: string } | undefined;
          if ((item.subjectId || alias?.subject_id) !== input.subjectId)
            return [];
          result.resourceId = row.record_id;
        } else if (
          row.entity === "concept" &&
          !this.readEntity(input.subjectId, "concept", row.record_id)
        )
          return [];
        else if (
          row.entity === "memory" &&
          !this.readEntity(input.subjectId, "memory", row.record_id)
        )
          return [];
        return [result];
      });
  }
  context(input: {
    subjectId: string;
    conversationId?: string;
    query?: string;
    tokenBudget?: number;
  }): SubjectContext {
    const subject = this.subject(input.subjectId),
      budget = Math.max(
        400,
        Math.min(12000, Math.floor(input.tokenBudget || 2500)),
      );
    const relevant = this.search({
      subjectId: input.subjectId,
      query: input.query || "",
      limit: 20,
    });
    const conceptIds = relevant
      .filter((row) => row.kind === "concept")
      .map((row) => row.id);
    const concepts = conceptIds.length
      ? conceptIds
          .slice(0, 16)
          .map((conceptId) =>
            this.readEntity(input.subjectId, "concept", conceptId),
          )
          .filter(Boolean)
      : this.rows<SubjectConcept>("subject_concepts", input.subjectId, 16);
    const matchedMemory = relevant.flatMap((result) => {
      const row = this.db
        .prepare("SELECT value FROM subject_memory WHERE subject_id=? AND id=?")
        .get(subject.id, result.id) as { value: string } | undefined;
      return row ? [parse<SubjectMemory>(row.value)] : [];
    });
    const recentMemory = (
      this.db
        .prepare(
          "SELECT value FROM subject_memory WHERE subject_id=? ORDER BY updated_at DESC LIMIT 20",
        )
        .all(input.subjectId) as { value: string }[]
    ).map((row) => parse<SubjectMemory>(row.value));
    const memory = [
      ...matchedMemory,
      ...recentMemory.filter(
        (row) => !matchedMemory.some((match) => match.id === row.id),
      ),
    ];
    const currentPosition = subject.currentNodeId
      ? this.readEntity(input.subjectId, "curriculum", subject.currentNodeId)
      : undefined;
    let position: unknown = currentPosition
      ? {
          id: currentPosition.id,
          title: String(currentPosition.title).slice(0, 200),
          status: currentPosition.status,
          conceptId: currentPosition.conceptId,
          skipped: currentPosition.skipped,
        }
      : undefined;
    let messages: Message[] = [];
    if (input.conversationId) {
      const conversation = this.db
        .prepare("SELECT * FROM conversations WHERE id=? AND subject_id=?")
        .get(input.conversationId, input.subjectId) as DbRow | undefined;
      if (!conversation)
        throw new Error("The active conversation is outside this subject.");
      position = {
        conversationId: conversation.id,
        title: String(conversation.title).slice(0, 160),
        position: String(conversation.position).slice(0, 500),
        curriculumNodeId: conversation.curriculum_node_id || undefined,
      };
      messages = (
        this.db
          .prepare(
            "SELECT value FROM messages WHERE lesson_id=? ORDER BY ordinal DESC LIMIT 4",
          )
          .all(conversation.legacy_lesson_id) as { value: string }[]
      )
        .reverse()
        .map((row) => parse<Message>(row.value));
      if (messages.length < 4 && conversation.parent_id)
        messages = this.transcript({
          conversationId: conversation.id,
          limit: 4,
        });
    }
    const matchedMessages: Message[] = [];
    for (const result of relevant
      .filter(
        (result) =>
          result.kind === "message" &&
          result.conversationId !== input.conversationId,
      )
      .slice(0, 3)) {
      const row = this.db
        .prepare(
          "SELECT m.value FROM messages m JOIN conversations c ON c.legacy_lesson_id=m.lesson_id WHERE m.id=? AND c.subject_id=? AND (json_extract(m.value,'$.status') IS NULL OR json_extract(m.value,'$.status')='complete')",
        )
        .get(result.messageId, input.subjectId) as
        { value: string } | undefined;
      if (row) matchedMessages.push(parse<Message>(row.value));
    }
    messages = [
      ...matchedMessages,
      ...messages.filter(
        (message) => !matchedMessages.some((match) => match.id === message.id),
      ),
    ];
    const sourceExcerpts = relevant
      .filter((result) =>
        ["note", "chapter", "document", "reference"].includes(result.kind),
      )
      .slice(0, 5)
      .map((result) => ({
        id: result.id,
        kind: result.kind,
        title: result.title,
        text: result.preview.slice(0, 500),
        resourceId: result.resourceId,
        recordId: result.recordId,
        verified: false as const,
      }));
    const currentNode =
      subject.currentNodeId || (position as DbRow)?.curriculumNodeId;
    const prerequisiteIds = currentNode
      ? (
          this.db
            .prepare(
              "SELECT source_id FROM curriculum_edges WHERE subject_id=? AND target_id=? LIMIT 20",
            )
            .all(input.subjectId, currentNode) as { source_id: string }[]
        ).map((row) => row.source_id)
      : [];
    const summaries = (
      this.db
        .prepare(
          "SELECT value FROM conversation_summaries WHERE subject_id=? ORDER BY updated_at DESC LIMIT 4",
        )
        .all(input.subjectId) as { value: string }[]
    ).map((row) => parse<DbRow>(row.value));
    const evidence = (
      this.db
        .prepare(
          "SELECT concept_id,kind,claim,conversation_id,message_id FROM learning_evidence WHERE subject_id=? ORDER BY created_at DESC LIMIT 8",
        )
        .all(input.subjectId) as DbRow[]
    ).map((row) => ({
      conceptId: row.concept_id,
      kind: row.kind,
      content: row.claim.slice(0, 600),
      conversationId: row.conversation_id,
      messageId: row.message_id,
    }));
    const context: SubjectContext & {
      sourceExcerpts: typeof sourceExcerpts;
      usage: SubjectContext["usage"] & {
        tokenizer: string;
        overheadTokens: number;
        encodedTokens: number;
      };
    } = {
      schema: "learning-studio.subject-context.v2",
      subject: {
        id: subject.id,
        name: subject.name.slice(0, 200),
        objective: subject.objective.slice(
          0,
          Math.min(1500, Math.floor(budget * 0.6)),
        ),
        depth: subject.depth,
      },
      position,
      concepts: concepts.map((value) => {
        const row = value as DbRow;
        return {
          id: row.id,
          label: row.label,
          status: row.status,
          coverage: row.coverage,
          evidence: String(row.evidence || "").slice(0, 600),
        };
      }),
      prerequisites: prerequisiteIds
        .map((nodeId) => this.readEntity(subject.id, "curriculum", nodeId))
        .filter(Boolean)
        .map((value) => {
          const node = value as DbRow;
          return { id: node.id, title: node.title, status: node.status };
        }),
      findings: memory
        .filter((row) =>
          ["finding", "explanation", "objective", "coverage"].includes(
            row.kind,
          ),
        )
        .slice(0, 6)
        .map((row) => ({
          id: row.id,
          title: row.title,
          content: row.content.slice(0, 900),
          conceptIds: row.conceptIds,
        })),
      questions: memory
        .filter((row) => ["question", "misconception"].includes(row.kind))
        .slice(0, 6)
        .map((row) => ({
          id: row.id,
          title: row.title,
          content: row.content.slice(0, 600),
        })),
      messages: messages.map((message) => ({
        id: message.id,
        messageId: message.id,
        conversationId: (
          this.db
            .prepare("SELECT lesson_id FROM messages WHERE id=?")
            .get(message.id) as { lesson_id: string } | undefined
        )?.lesson_id,
        role: message.role,
        text: message.text.slice(0, 1500),
        status: message.status,
      })),
      summaries: summaries.map((row) => ({
        id: row.id,
        conversationId: row.conversationId,
        content: String(row.content || "").slice(0, 1000),
      })),
      evidence,
      sourceExcerpts,
      usage: {
        estimatedTokens: 0,
        budget,
        recordCount: 0,
        fullHistoryIncluded: false,
        tokenizer: "o200k_base",
        overheadTokens: 64,
        encodedTokens: 0,
      },
    };
    const arrays = [
      "messages",
      "sourceExcerpts",
      "evidence",
      "summaries",
      "concepts",
      "findings",
      "questions",
      "prerequisites",
    ] as const;
    let serializedContext = JSON.stringify(context),
      tokens = encode(serializedContext).length + 64;
    while (
      tokens > budget - 24 ||
      Buffer.byteLength(serializedContext, "utf8") > budget * 8
    ) {
      const key =
        arrays.find((name) => context[name].length > 1) ||
        arrays.find((name) => context[name].length > 0);
      if (!key) {
        if (context.position) {
          delete context.position;
        } else if (context.subject.objective.length) {
          context.subject.objective = context.subject.objective.slice(
            0,
            Math.max(0, context.subject.objective.length - 100),
          );
        } else if (context.subject.name.length > 40) {
          context.subject.name = context.subject.name.slice(0, 40);
        } else break;
      } else context[key].pop();
      serializedContext = JSON.stringify(context);
      tokens = encode(serializedContext).length + 64;
    }
    context.usage.recordCount = arrays.reduce(
      (sum, key) => sum + context[key].length,
      0,
    );
    for (let pass = 0; pass < 4; pass++) {
      const encodedTokens = encode(JSON.stringify(context)).length;
      context.usage.encodedTokens = encodedTokens;
      context.usage.estimatedTokens = encodedTokens + 64;
    }
    if (
      encode(JSON.stringify(context)).length + 64 > budget ||
      Buffer.byteLength(JSON.stringify(context), "utf8") > budget * 8
    )
      throw new Error(
        "The subject identity alone exceeds this context budget. Increase the requested budget to retrieve it safely.",
      );
    return context;
  }
  exportArchive(subjectId: string) {
    const snapshot = this.snapshot(subjectId),
      all = this.store.load(),
      lessonIds = new Set(
        snapshot.conversations.map((conversation) => conversation.id),
      ),
      conceptIds = new Set(snapshot.concepts.map((concept) => concept.id));
    const libraryIds = new Set(
      all.library
        .filter(
          (item) =>
            item.subjectId === subjectId ||
            (!item.subjectId &&
              normalizeSubjectName(
                item.subject ||
                  (item.kind === "subject" && item.title) ||
                  "General",
              ) === normalizeSubjectName(snapshot.subject.name)) ||
            (item.lessonIds || []).some((lessonId) => lessonIds.has(lessonId)),
        )
        .map((item) => item.id),
    );
    // Include hierarchy ancestors so document/topic provenance survives a standalone import.
    for (const item of all.library.filter((item) => libraryIds.has(item.id))) {
      let parent = item.parentId;
      const seen = new Set<string>();
      while (parent && !seen.has(parent)) {
        seen.add(parent);
        libraryIds.add(parent);
        parent = all.library.find(
          (candidate) => candidate.id === parent,
        )?.parentId;
      }
    }
    const reviewCards = (all.reviewCards || []).filter(
      (card) =>
        card.subjectId === subjectId ||
        (card.lessonId && lessonIds.has(card.lessonId)) ||
        (card.conceptId && conceptIds.has(card.conceptId)),
    );
    const cardIds = new Set(reviewCards.map((card) => card.id));
    const legacy = validateStudioData({
      ...defaultData(),
      lessons: all.lessons.filter((lesson) => lessonIds.has(lesson.id)),
      concepts: all.concepts.filter((concept) => conceptIds.has(concept.id)),
      relations: all.relations.filter(
        (relation) =>
          conceptIds.has(relation.source) && conceptIds.has(relation.target),
      ),
      library: all.library
        .filter((item) => libraryIds.has(item.id))
        .map((item) => ({
          ...item,
          lessonIds: item.lessonIds?.filter((lessonId) =>
            lessonIds.has(lessonId),
          ),
        })),
      reviewCards,
      reviewHistory: (all.reviewHistory || []).filter((attempt) =>
        cardIds.has(attempt.cardId),
      ),
      knowledgeSuggestions: (all.knowledgeSuggestions || []).filter(
        (suggestion) =>
          suggestion.subjectId === subjectId ||
          (suggestion.lessonId && lessonIds.has(suggestion.lessonId)),
      ),
    });
    const tables: Record<string, DbRow[]> = {};
    for (const table of [
      ...normalizedSubjectTables,
      "subject_intakes",
      ...annotationTables,
    ].filter((table) => table !== "subject_search_entries"))
      tables[table] = this.db
        .prepare(
          `SELECT * FROM ${table} WHERE ${table === "subjects" ? "id" : "subject_id"}=?`,
        )
        .all(subjectId) as DbRow[];
    const search = this.db
      .prepare(
        "SELECT subject_id,entity,record_id,title,body FROM subject_search WHERE subject_id=?",
      )
      .all(subjectId);
    const documentAssets = [
      ...new Set(
        legacy.library.flatMap((item) =>
          item.sourceAssetId ? [item.sourceAssetId] : [],
        ),
      ),
    ].map((assetId) => {
      const bytes = this.store.getDocumentAsset(assetId);
      if (!bytes)
        throw new Error(
          "An original PDF is missing from this library. Reimport it before exporting a complete subject archive.",
        );
      return {
        id: assetId,
        mime: "application/pdf",
        base64: bytes.toString("base64"),
      };
    });
    return {
      format: "LearningStudioSubject",
      version: 2,
      exportedAt: now(),
      snapshot,
      lessons: legacy.lessons,
      legacy,
      tables,
      search,
      documentAssets,
    };
  }
  restore(input: unknown): Subject {
    const value = z.object({ archive: z.unknown() }).parse(input),
      archive = object(value.archive);
    if (archive.format !== "LearningStudioSubject" || archive.version !== 2)
      throw new Error("Choose a supported Learning Studio subject archive.");
    serialized(archive, 300_000_000);
    const tables = object(archive.tables),
      legacy = validateStudioData(archive.legacy),
      subjectRows = z
        .array(z.record(z.string(), z.unknown()))
        .length(1)
        .parse(tables.subjects),
      subjectId = id.parse(subjectRows[0].id);
    if (this.db.prepare("SELECT 1 FROM subjects WHERE id=?").get(subjectId))
      throw new Error(
        "This subject ID already exists. Unarchive the existing subject to continue, or restore the archive into a different library. Existing work was preserved.",
      );
    const allowed = [
      ...normalizedSubjectTables,
      "subject_intakes",
      ...annotationTables,
    ].filter((table) => table !== "subject_search_entries");
    if (
      Object.keys(tables).some(
        (table) => !allowed.includes(table as (typeof allowed)[number]),
      )
    )
      throw new Error("The subject archive contains an unsupported table.");
    const validated = new Map<string, DbRow[]>();
    for (const table of allowed) {
      const columns = new Set(
        (
          this.db.prepare(`PRAGMA table_info(${table})`).all() as {
            name: string;
          }[]
        ).map((row) => row.name),
      );
      const rows = z
        .array(z.record(z.string(), z.unknown()))
        .max(100000)
        .parse(tables[table] || []);
      for (const row of rows) {
        if (
          Object.keys(row).some((column) => !columns.has(column)) ||
          (table === "subjects" ? row.id : row.subject_id) !== subjectId
        )
          throw new Error(
            "An archive record has invalid columns or belongs to another subject.",
          );
      }
      validated.set(table, rows);
    }
    const legacyLessonIds = new Set(legacy.lessons.map((lesson) => lesson.id));
    if (
      (validated.get("conversations") || []).some(
        (row) => !legacyLessonIds.has(row.legacy_lesson_id),
      )
    )
      throw new Error("An archived conversation has no lesson transcript.");
    const documentAssets = z
      .array(
        z.object({
          id: z.string().regex(/^[a-f0-9]{64}$/),
          mime: z.literal("application/pdf"),
          base64: z
            .string()
            .max(140_000_000)
            .regex(/^[A-Za-z0-9+/]*={0,2}$/),
        }),
      )
      .max(10000)
      .parse(archive.documentAssets || []);
    const requiredAssets = new Set(
      legacy.library.flatMap((item) =>
        item.sourceAssetId ? [item.sourceAssetId] : [],
      ),
    );
    if (
      documentAssets.some((asset) => !requiredAssets.has(asset.id)) ||
      [...requiredAssets].some(
        (assetId) => !documentAssets.some((asset) => asset.id === assetId),
      )
    )
      throw new Error(
        "The archive is missing a referenced original PDF or contains an unrelated document asset.",
      );
    const insert = (
      db: StudioStore["db"],
      table: string,
      rows: DbRow[],
      ignore = false,
    ) => {
      if (!rows.length) return;
      const columns = Object.keys(rows[0]);
      if (
        rows.some(
          (row) =>
            Object.keys(row).length !== columns.length ||
            columns.some((column) => !(column in row)),
        )
      )
        throw new Error("Archive rows have inconsistent columns.");
      const stmt = db.prepare(
        `INSERT ${ignore ? "OR IGNORE " : ""}INTO ${table}(${columns.join(",")}) VALUES(${columns.map(() => "?").join(",")})`,
      );
      for (const row of rows) stmt.run(...columns.map((column) => row[column]));
    };
    const importInto = (store: StudioStore) => {
      const db = store.db;
      db.pragma("defer_foreign_keys=ON");
      for (const asset of documentAssets) {
        const actual = store.putDocumentAsset(
          Buffer.from(asset.base64, "base64"),
        );
        if (actual !== asset.id)
          throw new Error(
            "An original PDF hash does not match its archive identity.",
          );
      }
      for (const table of [
        "lessons",
        "concepts",
        "relations",
        "library",
      ] as const) {
        for (const record of legacy[table]) {
          const existing = db
            .prepare(`SELECT value FROM ${table} WHERE id=?`)
            .get(record.id) as { value: string } | undefined;
          const { messages: _messages, ...rest } = record as DbRow;
          const json = serialized(
            table === "lessons" ? rest : record,
            50_000_000,
          );
          if (existing && existing.value !== json)
            throw new Error(
              "An imported record ID conflicts with existing work. Import into a separate library to preserve both versions.",
            );
          if (!existing)
            db.prepare(`INSERT INTO ${table}(id,value) VALUES(?,?)`).run(
              record.id,
              json,
            );
        }
      }
      for (const lesson of legacy.lessons)
        for (const [ordinal, message] of lesson.messages.entries()) {
          if (db.prepare("SELECT 1 FROM messages WHERE id=?").get(message.id))
            throw new Error(
              "An imported message ID already exists in this library.",
            );
          db.prepare(
            "INSERT INTO messages(id,lesson_id,ordinal,value) VALUES(?,?,?,?)",
          ).run(message.id, lesson.id, ordinal, serialized(message));
        }
      for (const [table, rows] of validated) insert(db, table, rows);
      const search = z
        .array(
          z.object({
            subject_id: id,
            entity: z.string().max(40),
            record_id: id,
            title: z.string().max(1000),
            body: z.string().max(2_000_000),
          }),
        )
        .max(200000)
        .parse(archive.search || []);
      for (const row of search) {
        if (row.subject_id !== subjectId)
          throw new Error(
            "An archive search entry belongs to another subject.",
          );
        indexSubjectEntity(
          db,
          subjectId,
          row.entity,
          row.record_id,
          row.title,
          row.body,
        );
      }
      const current = store.load();
      const merged = {
        ...current,
        reviewCards: [
          ...(current.reviewCards || []),
          ...(legacy.reviewCards || []),
        ],
        reviewHistory: [
          ...(current.reviewHistory || []),
          ...(legacy.reviewHistory || []),
        ],
        knowledgeSuggestions: [
          ...(current.knowledgeSuggestions || []),
          ...(legacy.knowledgeSuggestions || []),
        ],
      };
      const checked = validateStudioData(merged);
      const {
        lessons: _lessons,
        concepts: _concepts,
        relations: _relations,
        library: _library,
        ...settings
      } = checked;
      db.prepare(
        "INSERT OR REPLACE INTO settings(id,value) VALUES('state',?)",
      ).run(serialized(settings, 50_000_000));
      validateNormalizedSubjects(db);
      validatePlanningData(db);
      validateAnnotationData(db);
      reindexAnnotations(db);
      for (const record of validated.get("subject_records") || []) {
        const content = validatedRecordData(record.kind, parse(record.value), {
          id: record.id,
          subjectId,
          title: record.title,
        });
        if (["chapter", "visual"].includes(record.kind))
          db.prepare("UPDATE subject_records SET value=? WHERE id=?").run(
            serialized(content),
            record.id,
          );
      }
      const service = new SubjectStore(store);
      service.validateGraph(subjectId);
      for (const row of validated.get("conversations") || [])
        service.transcript({ conversationId: row.id, limit: 1 });
      if ((db.pragma("foreign_key_check") as unknown[]).length)
        throw new Error("The archive contains invalid relationships.");
    };
    // Validate on an isolated database before touching a user's existing library.
    const scratch = new StudioStore(":memory:");
    try {
      scratch.db.transaction(() => importInto(scratch))();
    } finally {
      scratch.close();
    }
    this.store.checkpointBackup("subject-import");
    this.db.transaction(() => importInto(this.store))();
    return this.subject(subjectId);
  }
  dispatch(action: string, payload: any = {}): unknown {
    switch (action) {
      case "subject:list":
        return this.list(!!payload.includeArchived);
      case "subject:create":
        return this.create(payload);
      case "subject:get":
        return this.snapshot(
          id.parse(payload.subjectId),
          payload.includeRecordData === true,
        );
      case "subject:update":
      case "subject:archive": {
        const subject = this.checkRevision(
          payload.subjectId,
          payload.expectedRevision,
        );
        this.apply({
          subjectId: subject.id,
          baseRevision: subject.revision,
          label:
            action === "subject:archive" ? "Archive subject" : "Edit subject",
          origin: "learner",
          operations: [
            {
              entity: "subject",
              op: "put",
              id: subject.id,
              value: {
                ...object(payload.patch || {}),
                ...(action === "subject:archive"
                  ? { archived: payload.archived !== false }
                  : {}),
              },
            },
          ],
        });
        return this.subject(subject.id);
      }
      case "subject:conversation-create":
        return this.conversationCreate(payload);
      case "subject:conversation-get": {
        const row = this.db
          .prepare("SELECT * FROM conversations WHERE id=?")
          .get(id.parse(payload.conversationId)) as DbRow | undefined;
        return row ? this.conversation(row) : null;
      }
      case "subject:branch":
        return this.branch(payload);
      case "subject:conversation-delete":
        return this.conversationDelete(payload);
      case "subject:conversation-archive": {
        const row = this.db
          .prepare("SELECT subject_id FROM conversations WHERE id=?")
          .get(id.parse(payload.conversationId)) as
          { subject_id: string } | undefined;
        if (!row) throw new Error("The conversation is missing.");
        this.db
          .prepare(
            "UPDATE conversations SET archived=?,updated_at=? WHERE id=?",
          )
          .run(
            Number(payload.archived !== false),
            now(),
            payload.conversationId,
          );
        return true;
      }
      case "subject:transcript":
        return this.transcript(payload);
      case "subject:search":
        return this.search(payload);
      case "subject:context":
        return this.context(payload);
      case "subject:propose":
        return this.propose(payload);
      case "subject:apply":
        return this.apply(payload);
      case "subject:accept":
        return this.accept(payload);
      case "subject:rollback":
        return this.rollback(payload);
      case "subject:reject": {
        this.subject(payload.subjectId);
        this.db
          .prepare(
            "UPDATE memory_proposals SET state='rejected' WHERE id=? AND subject_id=? AND state='proposed'",
          )
          .run(payload.proposalId, payload.subjectId);
        return true;
      }
      case "subject:curriculum":
        return {
          nodes: this.rows<CurriculumNode>(
            "curriculum_nodes",
            payload.subjectId,
          ),
          edges: this.rows<CurriculumEdge>(
            "curriculum_edges",
            payload.subjectId,
          ),
        };
      case "subject:record-get":
        return this.record(payload.subjectId, payload.id, payload.recordType);
      case "subject:record-list":
        return this.records(
          payload.subjectId,
          payload.recordType,
          payload.includeData !== false && payload.includeData === true,
          payload.limit || 200,
        );
      case "subject:record-put": {
        const subject = this.subject(payload.subjectId),
          previous = this.record(subject.id, payload.id, payload.recordType);
        if (
          payload.expectedRevision !== undefined &&
          payload.expectedRevision !== (previous?.revision || 0)
        )
          throw new Error(
            "Record revision conflict. Refresh the saved content before replacing it.",
          );
        if (
          previous?.recordType === "asset" &&
          JSON.stringify(previous.data) === JSON.stringify(payload.data)
        )
          return previous;
        this.apply({
          subjectId: subject.id,
          baseRevision: subject.revision,
          label: "Save " + recordType.parse(payload.recordType),
          origin: "learner",
          operations: [
            {
              entity: "record",
              op: "put",
              id: id.parse(payload.id),
              value: {
                recordType: payload.recordType,
                title: payload.title,
                data: payload.data,
              },
            },
          ],
        });
        return this.record(subject.id, payload.id);
      }
      case "subject:record-delete": {
        const subject = this.subject(payload.subjectId),
          record = this.record(subject.id, payload.id);
        if (!record) return false;
        if (
          payload.expectedRevision !== undefined &&
          payload.expectedRevision !== record.revision
        )
          throw new Error("Record revision conflict.");
        this.apply({
          subjectId: subject.id,
          baseRevision: subject.revision,
          label: "Archive " + record.recordType,
          origin: "learner",
          operations: [{ entity: "record", op: "delete", id: record.id }],
        });
        return true;
      }
      case "subject:record-revise": {
        const subject = this.subject(payload.subjectId),
          current = this.record(subject.id, payload.id);
        if (!current) throw new Error("The record is missing.");
        if (payload.expectedRevision !== current.revision)
          throw new Error("Record revision conflict.");
        const row = this.db
          .prepare(
            "SELECT value FROM record_revisions WHERE record_id=? AND subject_id=? AND version=?",
          )
          .get(payload.id, subject.id, payload.revision) as
          { value: string } | undefined;
        if (!row) throw new Error("The requested record revision is missing.");
        const old = parse<SubjectRecord>(row.value);
        if (current.recordType === "asset") return current;
        return this.dispatch("subject:record-put", {
          ...old,
          expectedRevision: current.revision,
        });
      }
      case "subject:dashboard": {
        const snapshot = this.snapshot(payload.subjectId);
        return {
          ...snapshot,
          counts: {
            conversations: snapshot.conversations.length,
            concepts: snapshot.concepts.length,
            curriculum: snapshot.curriculum.length,
            demonstrated: snapshot.concepts.filter(
              (concept) => concept.status === "demonstrated",
            ).length,
            covered: snapshot.concepts.filter(
              (concept) => concept.coverage === "covered",
            ).length,
            unresolved: snapshot.memory.filter(
              (memory) => memory.kind === "question",
            ).length,
          },
        };
      }
      case "subject:export":
        return this.exportArchive(id.parse(payload.subjectId));
      case "subject:restore":
        return this.restore(payload);
      default:
        throw new Error("Unknown subject operation.");
    }
  }
}
