import { afterEach, describe, expect, it, vi } from "vitest";
import { writeFileSync } from "node:fs";
import { encode } from "gpt-tokenizer/encoding/o200k_base";
import { StudioStore } from "../electron/storage";
import { SubjectStore } from "../electron/subjects";
import type {
  Subject,
  SubjectOperation,
  SubjectSnapshot,
  SubjectRecord,
} from "../src/v2types";

const stores: StudioStore[] = [];
afterEach(() => {
  for (const store of stores.splice(0)) if (store.db.open) store.close();
});
function setup() {
  const store = new StudioStore(":memory:");
  stores.push(store);
  const service = new SubjectStore(store);
  const subject = service.create({
    name: "Mathematics",
    objective: "Explore broad mathematics",
    depth: "comprehensive",
  });
  return { store, service, subject };
}
function current(service: SubjectStore, subject: Subject) {
  return service.snapshot(subject.id).subject.revision;
}
function apply(
  service: SubjectStore,
  subject: Subject,
  operations: SubjectOperation[],
  label = "Manual edit",
) {
  return service.apply({
    subjectId: subject.id,
    baseRevision: current(service, subject),
    label,
    origin: "learner",
    operations,
  });
}
const put = (
  entity: SubjectOperation["entity"],
  id: string,
  value: Record<string, unknown>,
): SubjectOperation => ({ entity, id, op: "put", value });

describe("authoritative normalized subject memory", () => {
  it("stores a first conversation without requiring a previous legacy settings save", () => {
    const { store, service, subject } = setup();
    const lesson = service.conversationCreate({
      subjectId: subject.id,
      title: "A broad goal",
      mode: "Explore",
    });
    expect(store.load().lessons).toEqual([lesson]);
    expect(service.snapshot(subject.id).conversations[0].id).toBe(lesson.id);
    expect(service.list().map((item) => item.id)).toContain(subject.id);
  });
  it("applies validated row revisions atomically and protects manual nodes from unreviewed AI changes", () => {
    const { service, subject } = setup();
    apply(service, subject, [
      put("curriculum", "node", {
        kind: "topic",
        title: "Learner title",
        description: "My wording",
        status: "covered",
      }),
    ]);
    const before = service.snapshot(subject.id);
    expect(() =>
      service.apply({
        subjectId: subject.id,
        baseRevision: before.subject.revision,
        label: "Unexpected AI overwrite",
        origin: "ai",
        operations: [put("curriculum", "node", { title: "Replacement" })],
      }),
    ).toThrow("learner edits");
    expect(service.snapshot(subject.id)).toEqual(before);
    const proposal = service.propose({
      subjectId: subject.id,
      baseRevision: before.subject.revision,
      label: "Reviewed replacement",
      origin: "ai",
      operations: [put("curriculum", "node", { title: "Accepted title" })],
    });
    const revision = service.accept({
      subjectId: subject.id,
      proposalId: proposal.id,
    });
    expect(service.snapshot(subject.id).curriculum[0].title).toBe(
      "Accepted title",
    );
    service.rollback({ subjectId: subject.id, revisionId: revision.id });
    expect(service.snapshot(subject.id).curriculum[0].title).toBe(
      "Learner title",
    );
    expect(() =>
      service.apply({
        subjectId: subject.id,
        baseRevision: before.subject.revision,
        label: "Stale",
        origin: "learner",
        operations: [put("curriculum", "node", { title: "Stale" })],
      }),
    ).toThrow("revision conflict");
  });
  it("rebases an accepted proposal over unrelated visual saves but rejects changes to touched records", () => {
    const { service, subject } = setup();
    apply(service, subject, [
      put("curriculum", "node", { kind: "topic", title: "Original" }),
    ]);
    const proposal = service.propose({
      subjectId: subject.id,
      baseRevision: current(service, subject),
      label: "Planned title",
      origin: "ai",
      operations: [put("curriculum", "node", { title: "Reviewed title" })],
    });
    service.dispatch("subject:record-put", {
      subjectId: subject.id,
      id: "visual",
      recordType: "visual",
      title: "A separate visual",
      data: {
        block: {
          type: "diagram",
          spec: {
            title: "A diagram",
            nodes: [{ id: "a", label: "A" }],
            edges: [],
          },
        },
        state: { parameter: 2 },
      },
    });
    expect(() =>
      service.accept({ subjectId: subject.id, proposalId: proposal.id }),
    ).not.toThrow();
    expect(service.snapshot(subject.id).curriculum[0].title).toBe(
      "Reviewed title",
    );
    const conflict = service.propose({
      subjectId: subject.id,
      baseRevision: current(service, subject),
      label: "Later proposal",
      origin: "ai",
      operations: [put("curriculum", "node", { title: "Proposal title" })],
    });
    apply(service, subject, [
      put("curriculum", "node", { title: "New learner edit" }),
    ]);
    expect(() =>
      service.accept({ subjectId: subject.id, proposalId: conflict.id }),
    ).toThrow("Proposal conflict");
    expect(
      service
        .snapshot(subject.id)
        .revisions.some(
          (revision) =>
            revision.id === conflict.id && revision.status === "proposed",
        ),
    ).toBe(true);
    expect(service.snapshot(subject.id).curriculum[0].title).toBe(
      "New learner edit",
    );
  });
  it("includes newly added cascading relationships when checking a stale deletion proposal", () => {
    const { service, subject } = setup();
    apply(service, subject, [
      put("curriculum", "parent", { kind: "topic", title: "Parent" }),
      put("curriculum", "other", { kind: "topic", title: "Other" }),
    ]);
    const proposal = service.propose({
      subjectId: subject.id,
      baseRevision: current(service, subject),
      label: "Remove parent",
      origin: "ai",
      operations: [{ entity: "curriculum", id: "parent", op: "delete" }],
    });
    apply(service, subject, [
      put("edge", "new-edge", { nodeId: "other", prerequisiteId: "parent" }),
    ]);
    expect(() =>
      service.accept({ subjectId: subject.id, proposalId: proposal.id }),
    ).toThrow("Proposal conflict");
    expect(service.snapshot(subject.id).edges[0].id).toBe("new-edge");
  });
  it("rebases manual memory/topic saves over unrelated visual activity and rejects edits to the same row", () => {
    const { service, subject } = setup();
    apply(service, subject, [
      put("curriculum", "node", { kind: "topic", title: "Original title" }),
    ]);
    const base = current(service, subject);
    service.dispatch("subject:record-put", {
      subjectId: subject.id,
      id: "playing-visual",
      recordType: "visual",
      title: "Continuously playing diagram",
      data: {
        block: {
          type: "diagram",
          spec: {
            title: "A diagram",
            nodes: [{ id: "a", label: "A" }],
            edges: [],
          },
        },
        state: { frame: 2 },
      },
    });
    expect(() =>
      service.apply({
        subjectId: subject.id,
        baseRevision: base,
        label: "Save a manual finding",
        origin: "learner",
        operations: [
          put("memory", "manual-finding", {
            kind: "finding",
            title: "A manual insight",
            content: "Saved while a visual is playing.",
            conceptIds: [],
          }),
        ],
      }),
    ).not.toThrow();
    expect(() =>
      service.apply({
        subjectId: subject.id,
        baseRevision: base,
        label: "Rename topic",
        origin: "learner",
        operations: [
          put("curriculum", "node", { title: "First learner edit" }),
        ],
      }),
    ).not.toThrow();
    const before = service.snapshot(subject.id);
    expect(() =>
      service.apply({
        subjectId: subject.id,
        baseRevision: base,
        label: "Stale topic overwrite",
        origin: "learner",
        operations: [put("curriculum", "node", { title: "Old stale title" })],
      }),
    ).toThrow("revision conflict");
    expect(service.snapshot(subject.id)).toEqual(before);
    expect(() =>
      service.apply({
        subjectId: subject.id,
        baseRevision: current(service, subject) + 5,
        label: "Future version",
        origin: "learner",
        operations: [
          put("memory", "bad", {
            kind: "finding",
            title: "Invalid",
            content: "Invalid",
            conceptIds: [],
          }),
        ],
      }),
    ).toThrow("source version");
  });
  it("removes curriculum nodes, reparents children, and restores incident prerequisites with undo", () => {
    const { service, subject } = setup();
    apply(service, subject, [
      put("curriculum", "parent", { kind: "module", title: "Module" }),
      put("curriculum", "child", {
        kind: "topic",
        title: "Topic",
        parentId: "parent",
      }),
      put("curriculum", "prerequisite", {
        kind: "topic",
        title: "First principles",
      }),
      put("edge", "edge", { nodeId: "child", prerequisiteId: "parent" }),
    ]);
    const revision = apply(service, subject, [
      { entity: "curriculum", id: "parent", op: "delete" },
    ]);
    const removed = service.snapshot(subject.id);
    expect(removed.curriculum.map((node) => node.id)).not.toContain("parent");
    expect(
      removed.curriculum.find((node) => node.id === "child")?.parentId,
    ).toBeUndefined();
    expect(removed.edges).toEqual([]);
    service.rollback({ subjectId: subject.id, revisionId: revision.id });
    const restored = service.snapshot(subject.id);
    expect(
      restored.curriculum.find((node) => node.id === "child")?.parentId,
    ).toBe("parent");
    expect(restored.edges[0].prerequisiteId).toBe("parent");
  });
  it("rejects cyclic prerequisites, invalid cross-subject references, and mastery without evidence", () => {
    const { service, subject } = setup();
    const other = service.create({ name: "History" });
    apply(service, subject, [
      put("curriculum", "a", { kind: "topic", title: "A" }),
      put("curriculum", "b", { kind: "topic", title: "B" }),
    ]);
    const revision = current(service, subject);
    expect(() =>
      apply(service, subject, [
        put("edge", "a-b", { nodeId: "a", prerequisiteId: "b" }),
        put("edge", "b-a", { nodeId: "b", prerequisiteId: "a" }),
      ]),
    ).toThrow("cycle");
    expect(current(service, subject)).toBe(revision);
    expect(() =>
      apply(service, subject, [
        put("concept", "concept", {
          label: "Term appeared",
          status: "demonstrated",
          evidence: "",
        }),
      ]),
    ).toThrow("evidence");
    expect(() =>
      apply(service, subject, [
        put("curriculum", "a", { status: "demonstrated" }),
      ]),
    ).toThrow("linked subject concept");
    apply(service, subject, [
      put("concept", "concept", {
        label: "A concept",
        status: "demonstrated",
        evidence: "Learner independently justified each implication.",
      }),
      put("curriculum", "a", { conceptId: "concept", status: "demonstrated" }),
    ]);
    expect(service.snapshot(subject.id).concepts[0].coverage).toBe(
      "not-started",
    );
    expect(() =>
      apply(service, other, [put("concept", "concept", { label: "Same ID" })]),
    ).toThrow("another subject");
  });
  it("branches at a parent message without duplicating the ancestor transcript and guards stale saves", () => {
    const { store, service, subject } = setup();
    const parent = service.conversationCreate({
      subjectId: subject.id,
      title: "Original",
    });
    let data = store.load();
    data.lessons[0].messages = [
      { id: "m1", role: "user", text: "First", createdAt: "2026-10-28" },
      { id: "m2", role: "assistant", text: "Second", createdAt: "2026-10-28" },
      { id: "m3", role: "user", text: "Later", createdAt: "2026-10-28" },
    ];
    store.save(data);
    const stale = store.load();
    const branch = service.branch({
      subjectId: subject.id,
      conversationId: parent.id,
      messageId: "m2",
      title: "Alternative",
    });
    expect(branch.messages).toEqual([]);
    data = store.load();
    data.lessons
      .find((lesson) => lesson.id === branch.id)!
      .messages.push({
        id: "branch-message",
        role: "user",
        text: "Explore another route",
        createdAt: "2026-10-28",
      });
    store.save(data);
    expect(
      service
        .transcript({ conversationId: branch.id })
        .map((message) => message.id),
    ).toEqual(["m1", "m2", "branch-message"]);
    expect(
      store.db.prepare("SELECT COUNT(*) AS n FROM messages").get(),
    ).toEqual({ n: 4 });
    store.save(stale);
    expect(store.load().lessons.some((lesson) => lesson.id === branch.id)).toBe(
      true,
    );
    expect(
      service
        .transcript({ conversationId: branch.id })
        .map((message) => message.id),
    ).toEqual(["m1", "m2", "branch-message"]);
  });
  it("explicitly deletes a leaf conversation, prevents stale resurrection, and protects branch parent transcripts", () => {
    const { store, service, subject } = setup();
    const parent = service.conversationCreate({
      subjectId: subject.id,
      title: "Parent",
    });
    const data = store.load();
    data.lessons[0].messages.push({
      id: "parent-message",
      role: "user",
      text: "A source question",
      createdAt: "2026-10-28",
    });
    store.save(data);
    const branch = service.branch({
      subjectId: subject.id,
      conversationId: parent.id,
      messageId: "parent-message",
    });
    expect(() =>
      service.conversationDelete({ conversationId: parent.id }),
    ).toThrow("source of a branch");
    const stale = store.load();
    expect(service.conversationDelete({ conversationId: branch.id })).toBe(
      true,
    );
    store.save(stale);
    expect(store.load().lessons.map((lesson) => lesson.id)).toEqual([
      parent.id,
    ]);
    expect(service.conversationDelete({ conversationId: parent.id })).toBe(
      true,
    );
    expect(store.load().lessons).toEqual([]);
    expect(service.snapshot(subject.id).conversations).toEqual([]);
  });
  it("resolves a branch from an inherited message and preserves a source prefix during a stale save", () => {
    const { store, service, subject } = setup(),
      root = service.conversationCreate({
        subjectId: subject.id,
        title: "Root",
      });
    const old = store.load();
    old.lessons[0].messages = [
      { id: "root-a", role: "user", text: "A", createdAt: "2026-10-28" },
    ];
    store.save(old);
    const stale = store.load(),
      latest = store.load();
    latest.lessons[0].messages.push({
      id: "root-b",
      role: "assistant",
      text: "B",
      createdAt: "2026-10-28",
    });
    store.save(latest);
    const branch = service.branch({
      subjectId: subject.id,
      conversationId: root.id,
      messageId: "root-b",
    });
    store.save(stale);
    expect(
      service
        .transcript({ conversationId: branch.id })
        .map((message) => message.id),
    ).toEqual(["root-a", "root-b"]);
    const second = service.branch({
      subjectId: subject.id,
      conversationId: branch.id,
      messageId: "root-a",
    });
    expect(
      service.transcriptAll(second.id).map((message) => message.id),
    ).toEqual(["root-a"]);
  });
  it("returns source anchors for every searchable message, equation, figure, document, and chapter", () => {
    const { store, service, subject } = setup();
    const lesson = service.conversationCreate({
      subjectId: subject.id,
      title: "Spectral lesson",
    });
    const data = store.load();
    data.lessons[0].messages = [
      {
        id: "math-message",
        role: "assistant",
        text: "Spectral equations",
        createdAt: "2026-10-28",
        blocks: [
          { type: "equation", latex: "\\lambda x=Ax" },
          {
            type: "diagram",
            spec: {
              title: "Spectral process",
              nodes: [{ id: "a", label: "Spectral input" }],
              edges: [],
            },
          },
        ],
      },
    ];
    data.library.push({
      id: "source-document",
      subjectId: subject.id,
      kind: "document",
      subject: "Mathematics",
      title: "Spectral source",
      content: "Spectral evidence",
      createdAt: "2026-10-28",
    });
    store.save(data);
    service.dispatch("subject:record-put", {
      subjectId: subject.id,
      recordType: "chapter",
      id: "chapter",
      title: "Spectral chapter",
      data: { markdown: "Spectral decomposition" },
    });
    for (const kind of ["message", "equation", "figure"]) {
      const results = service.search({
        subjectId: subject.id,
        query: "Spectral",
        kind,
      });
      expect(results).toContainEqual(
        expect.objectContaining({
          kind,
          conversationId: lesson.id,
          messageId: "math-message",
        }),
      );
    }
    expect(
      service.search({
        subjectId: subject.id,
        query: "Spectral",
        kind: "document",
      }),
    ).toContainEqual(
      expect.objectContaining({ resourceId: "source-document" }),
    );
    expect(
      service.search({
        subjectId: subject.id,
        query: "Spectral",
        kind: "chapter",
      }),
    ).toContainEqual(expect.objectContaining({ recordId: "chapter" }));
  });
  it("removes moved/deleted source indexes and never materializes another subject through stale FTS rows", () => {
    const { store, service, subject } = setup(),
      other = service.create({ name: "History" }),
      lesson = service.conversationCreate({
        subjectId: subject.id,
        title: "Reclassified chat",
      });
    let data = store.load();
    data.lessons[0].messages = [
      {
        id: "moved-message",
        role: "assistant",
        text: "Scopecheck old mathematics text",
        createdAt: "2026-10-28",
        blocks: [
          { type: "equation", latex: "Scopecheck=x" },
          {
            type: "diagram",
            spec: {
              title: "Scopecheck diagram",
              nodes: [{ id: "a", label: "Scopecheck" }],
              edges: [],
            },
          },
        ],
      },
    ];
    data.library.push({
      id: "moved-source",
      kind: "document",
      subjectId: subject.id,
      subject: subject.name,
      title: "Scopecheck source",
      content: "Scopecheck old source text",
      createdAt: "2026-10-28",
    });
    store.save(data);
    data = store.load();
    data.lessons[0].subjectId = other.id;
    data.lessons[0].subject = other.name;
    data.lessons[0].messages[0].text = "Scopecheck new History content";
    data.library[0].subjectId = other.id;
    data.library[0].subject = other.name;
    store.save(data);
    expect(
      service.search({ subjectId: subject.id, query: "Scopecheck" }),
    ).toEqual([]);
    expect(
      JSON.stringify(
        service.context({ subjectId: subject.id, query: "Scopecheck" }),
      ),
    ).not.toContain("new History content");
    expect(
      service.search({
        subjectId: other.id,
        query: "Scopecheck",
        kind: "message",
      }),
    ).toContainEqual(
      expect.objectContaining({
        conversationId: lesson.id,
        messageId: "moved-message",
      }),
    );
    expect(
      service.search({
        subjectId: other.id,
        query: "Scopecheck",
        kind: "document",
      }),
    ).toContainEqual(expect.objectContaining({ resourceId: "moved-source" }));
    data = store.load();
    data.lessons[0].messages[0].blocks = [];
    data.library = [];
    store.save(data);
    for (const kind of ["equation", "figure", "document"])
      expect(
        service.search({ subjectId: other.id, query: "Scopecheck", kind }),
      ).toEqual([]);
    store.db
      .prepare(
        "INSERT INTO subject_search(subject_id,entity,record_id,title,body) VALUES(?,?,?,?,?)",
      )
      .run(
        subject.id,
        "message",
        "moved-message",
        "A stale index",
        "Scopecheck old mathematics preview",
      );
    expect(
      service.search({ subjectId: subject.id, query: "Scopecheck" }),
    ).toEqual([]);
    expect(
      JSON.stringify(
        service.context({ subjectId: subject.id, query: "Scopecheck" }),
      ),
    ).not.toContain("new History content");
  });
  it("rejects implicit concept ownership changes and stale duplicate-scope edits", () => {
    const { store, service, subject } = setup(),
      other = service.create({ name: "History" });
    apply(service, subject, [
      put("concept", "owned-concept", {
        label: "An owned concept",
        status: "partial",
        evidence: "An actual scoped explanation",
      }),
    ]);
    const original = store.load(),
      moved = structuredClone(original);
    moved.concepts[0].subjectId = other.id;
    expect(() => store.save(moved)).toThrow("cannot change subjects");
    expect(store.load()).toEqual(original);
    const scoped = service.snapshot(subject.id).concepts[0];
    store.db
      .prepare(
        "INSERT INTO subject_concepts(subject_id,concept_id,version,value,updated_at) VALUES(?,?,?,?,?)",
      )
      .run(
        other.id,
        scoped.id,
        scoped.revision,
        JSON.stringify({ ...scoped, subjectId: other.id }),
        scoped.updatedAt,
      );
    expect(() =>
      apply(service, other, [
        put("concept", scoped.id, { label: "Attempted overwrite" }),
      ]),
    ).toThrow("another subject");
    expect(store.load().concepts[0].subjectId).toBe(subject.id);
    expect(store.load().concepts[0].label).toBe("An owned concept");
  });
  it("guards reclassification of conversations with attached concept evidence", () => {
    const { store, service, subject } = setup(),
      other = service.create({ name: "History" }),
      lesson = service.conversationCreate({
        subjectId: subject.id,
        title: "Evidence source",
      });
    apply(service, subject, [
      put("concept", "dependent-concept", {
        label: "A scoped concept",
        status: "partial",
        evidence: "A learner explanation",
        lessonId: lesson.id,
      }),
    ]);
    const original = store.load(),
      moved = structuredClone(original);
    moved.lessons[0].subjectId = other.id;
    moved.lessons[0].subject = other.name;
    expect(() => store.save(moved)).toThrow("subject learning evidence");
    expect(store.load()).toEqual(original);
    expect(
      service.snapshot(subject.id).concepts.map((concept) => concept.id),
    ).toEqual(["dependent-concept"]);
    expect(service.snapshot(other.id).concepts).toEqual([]);
  });
  it("guards reclassification when visual state or textbook sources would be stranded in the old subject", () => {
    const { store, service, subject } = setup(),
      other = service.create({ name: "History" }),
      lesson = service.conversationCreate({
        subjectId: subject.id,
        title: "Visual source",
      }),
      data = store.load();
    data.lessons[0].messages = [
      {
        id: "stateful-origin",
        role: "assistant",
        text: "A saved visualization",
        createdAt: "2026-10-28",
      },
    ];
    store.save(data);
    service.dispatch("subject:record-put", {
      subjectId: subject.id,
      id: "stateful-origin:0",
      recordType: "visual",
      title: "A scientific figure",
      data: {
        originMessageId: "stateful-origin",
        block: {
          type: "diagram",
          spec: {
            title: "An explanation",
            nodes: [{ id: "a", label: "A" }],
            edges: [],
          },
        },
        state: { zoom: 2 },
      },
    });
    const before = store.load(),
      moved = structuredClone(before);
    moved.lessons.find((item) => item.id === lesson.id)!.subjectId = other.id;
    expect(() => store.save(moved)).toThrow("saved visuals");
    expect(store.load()).toEqual(before);
    expect(
      (
        service.dispatch("subject:record-get", {
          subjectId: subject.id,
          id: "stateful-origin:0",
        }) as SubjectRecord<any>
      ).data.state.zoom,
    ).toBe(2);
  });
  it("persists immutable original assets separately from editable visual state and returns metadata by default", () => {
    const { service, subject } = setup();
    const saved = service.dispatch("subject:record-put", {
      subjectId: subject.id,
      recordType: "asset",
      id: "asset",
      title: "Original coordinates",
      data: { format: "sdf", text: "An imported source" },
    }) as SubjectRecord;
    expect(service.snapshot(subject.id).records[0].data).toBeNull();
    expect(
      (
        service.dispatch("subject:get", {
          subjectId: subject.id,
          includeRecordData: true,
        }) as SubjectSnapshot
      ).records[0].data,
    ).toEqual(saved.data);
    expect(
      (
        service.dispatch("subject:record-get", {
          subjectId: subject.id,
          id: "asset",
          recordType: "asset",
        }) as SubjectRecord
      ).data,
    ).toEqual(saved.data);
    expect(() =>
      service.dispatch("subject:record-put", {
        subjectId: subject.id,
        recordType: "asset",
        id: "asset",
        title: "Changed",
        data: { text: "Other" },
      }),
    ).toThrow("immutable");
    expect(
      (
        service.dispatch("subject:record-put", {
          subjectId: subject.id,
          recordType: "asset",
          id: "asset",
          title: "Same",
          data: saved.data,
        }) as SubjectRecord
      ).revision,
    ).toBe(1);
    const storedRevision = service.db
      .prepare(
        "SELECT operations FROM subject_revisions WHERE subject_id=? ORDER BY version DESC LIMIT 1",
      )
      .get(subject.id) as { operations: string };
    expect(storedRevision.operations).not.toContain("An imported source");
    const original = service.snapshot(subject.id).subject.revision;
    service.dispatch("subject:record-delete", {
      subjectId: subject.id,
      id: "asset",
      expectedRevision: 1,
    });
    const deletion = service.db
      .prepare(
        "SELECT id FROM subject_revisions WHERE subject_id=? AND version=?",
      )
      .get(subject.id, original + 1) as { id: string };
    service.rollback({ subjectId: subject.id, revisionId: deletion.id });
    const restored = service.dispatch("subject:record-get", {
      subjectId: subject.id,
      id: "asset",
    }) as SubjectRecord;
    expect(restored.data).toEqual(saved.data);
    expect(restored.revision).toBeGreaterThan(saved.revision);
  });
  it("rejects malformed typed chapter and visual records without changing the subject", () => {
    const { service, subject } = setup(),
      revision = current(service, subject);
    expect(() =>
      service.dispatch("subject:record-put", {
        subjectId: subject.id,
        id: "bad-chapter",
        recordType: "chapter",
        title: "Bad chapter",
        data: {
          markdown: "Text",
          blocks: [{ type: "script", code: "arbitrary()" }],
        },
      }),
    ).toThrow("malformed");
    expect(() =>
      service.dispatch("subject:record-put", {
        subjectId: subject.id,
        id: "bad-visual",
        recordType: "visual",
        title: "Bad visual",
        data: { block: { type: "equation", latex: "x" }, state: {} },
      }),
    ).toThrow("visualization block");
    expect(() =>
      service.dispatch("subject:record-put", {
        subjectId: subject.id,
        id: "wrong-scope",
        recordType: "chapter",
        title: "Bad scope",
        data: { subjectId: "another-subject", markdown: "Text" },
      }),
    ).toThrow("identity and subject");
    expect(current(service, subject)).toBe(revision);
    const chapter = service.dispatch("subject:record-put", {
      subjectId: subject.id,
      id: "safe-chapter",
      recordType: "chapter",
      title: "Safe chapter",
      data: { markdown: "Editable text" },
    }) as SubjectRecord;
    expect(chapter.data).toEqual(
      expect.objectContaining({
        id: "safe-chapter",
        subjectId: subject.id,
        title: "Safe chapter",
        blocks: [],
        citations: [],
        originMessageIds: [],
      }),
    );
  });
  it("uses bounded relevant compact context across two conversations with a 3000-concept curriculum", () => {
    const { store, service, subject } = setup(),
      operations: SubjectOperation[] = [];
    for (let i = 0; i < 3000; i++)
      operations.push(
        put("concept", "concept-" + i, {
          label:
            i === 2500
              ? "Spectralradius distinctive target"
              : "General concept " + i,
          status: "unassessed",
          coverage: "introduced",
          evidence: "",
        }),
        put("curriculum", "node-" + i, {
          kind: "concept",
          title: "Topic " + i,
          conceptId: "concept-" + i,
          position: i,
        }),
      );
    const started = performance.now();
    apply(service, subject, operations, "Import broad pathway");
    const curriculumMs = performance.now() - started;
    const first = service.conversationCreate({
        subjectId: subject.id,
        title: "Earlier discussion",
      }),
      second = service.conversationCreate({
        subjectId: subject.id,
        title: "New discussion",
      });
    const data = store.load();
    data.lessons
      .find((lesson) => lesson.id === first.id)!
      .messages.push({
        id: "earlier-message",
        role: "assistant",
        text: "Spectralradius distinctive conclusion across chats.",
        createdAt: "2026-10-28",
      });
    store.save(data);
    apply(service, subject, [
      put("memory", "finding", {
        kind: "finding",
        title: "Spectralradius result",
        content: "Our earlier conclusion persists across chats.",
        conceptIds: ["concept-2500"],
        conversationId: first.id,
      }),
    ]);
    const before = (
      store.db.prepare("SELECT total_changes() AS n").get() as { n: number }
    ).n;
    apply(service, subject, [
      put("curriculum", "node-2500", { title: "Edited target" }),
    ]);
    const writes =
      (store.db.prepare("SELECT total_changes() AS n").get() as { n: number })
        .n - before;
    const retrieved = performance.now();
    const context = service.context({
      subjectId: subject.id,
      conversationId: second.id,
      query: "Spectralradius",
      tokenBudget: 1500,
    });
    const contextMs = performance.now() - retrieved;
    expect(context.concepts).toContainEqual(
      expect.objectContaining({
        id: "concept-2500",
        status: "unassessed",
        coverage: "introduced",
      }),
    );
    expect(context.findings).toContainEqual(
      expect.objectContaining({ id: "finding" }),
    );
    expect(context.messages).toContainEqual(
      expect.objectContaining({ id: "earlier-message" }),
    );
    expect(context.usage.estimatedTokens).toBeLessThanOrEqual(1500);
    expect(context.usage.fullHistoryIncluded).toBe(false);
    expect(context.concepts.length).toBeLessThan(30);
    expect(writes).toBeLessThan(50);
    const minimum = service.context({
      subjectId: subject.id,
      tokenBudget: 400,
    });
    expect(minimum.usage.estimatedTokens).toBeLessThanOrEqual(400);
    writeFileSync(
      "docs/v2-context-benchmark.json",
      JSON.stringify(
        {
          concepts: 3000,
          curriculumNodes: 3000,
          curriculumMs,
          contextMs,
          estimatedTokens: context.usage.estimatedTokens,
          budget: 1500,
          sqliteChangesForOneNode: writes,
          scope: "Synthetic deterministic SQLite benchmark on this machine.",
        },
        null,
        2,
      ),
    );
  }, 20000);
  it("finds an earlier source among 500 long conversations without retrieving their full transcripts", () => {
    const { store, service, subject } = setup();
    const data = store.load(),
      at = "2026-10-28";
    for (let i = 0; i < 500; i++)
      data.lessons.push({
        id: "long-chat-" + i,
        subjectId: subject.id,
        subject: subject.name,
        title: "Archived discussion " + i,
        mode: "Explore",
        objective: "A general discussion",
        position: "Saved position",
        notes: "",
        createdAt: at,
        updatedAt: at,
        messages: Array.from({ length: 4 }, (_, m) => ({
          id: `long-message-${i}-${m}`,
          role: m % 2 ? "assistant" : "user",
          text:
            i === 73 && m === 2
              ? "Harmonicboundary distinctive earlier source conclusion."
              : "Irrelevant background details ".repeat(120),
          createdAt: at,
        })),
      });
    store.save(data);
    const active = service.conversationCreate({
      subjectId: subject.id,
      title: "Returning learner",
    });
    expect(
      service.search({ subjectId: subject.id, query: "Harmonicboundary" }),
    ).toContainEqual(
      expect.objectContaining({ messageId: "long-message-73-2" }),
    );
    const fullHistory = vi
      .spyOn(service, "transcript")
      .mockImplementation(() => {
        throw new Error("Full-history retrieval was forbidden by this test.");
      });
    const started = performance.now();
    const context = service.context({
      subjectId: subject.id,
      conversationId: active.id,
      query: "Harmonicboundary",
      tokenBudget: 1200,
    });
    const contextMs = performance.now() - started;
    expect(context.messages).toContainEqual(
      expect.objectContaining({ id: "long-message-73-2" }),
    );
    expect(context.usage.estimatedTokens).toBeLessThanOrEqual(1200);
    expect(context.messages.length).toBeLessThanOrEqual(7);
    expect(fullHistory).not.toHaveBeenCalled();
    fullHistory.mockRestore();
    const plan = JSON.stringify(
      store.db
        .prepare(
          "EXPLAIN QUERY PLAN SELECT value FROM messages WHERE lesson_id=? ORDER BY ordinal DESC LIMIT 4",
        )
        .all(active.id),
    );
    expect(plan).toContain("messages_lesson_ordinal");
    service.dispatch("subject:update", {
      subjectId: subject.id,
      expectedRevision: current(service, subject),
      patch: { name: "A".repeat(500), objective: "B".repeat(20000) },
    });
    expect(
      service.context({
        subjectId: subject.id,
        conversationId: active.id,
        tokenBudget: 400,
      }).usage.estimatedTokens,
    ).toBeLessThanOrEqual(400);
    writeFileSync(
      "docs/v2-conversation-benchmark.json",
      JSON.stringify(
        {
          conversations: 501,
          messages: 2000,
          charactersPerIrrelevantMessage: 3480,
          contextMs,
          estimatedTokens: context.usage.estimatedTokens,
          budget: 1200,
          foundEarlierMessage: "long-message-73-2",
          fullHistoryRetrieved: false,
          queryPlan: JSON.parse(plan),
          scope:
            "Synthetic deterministic SQLite/FTS5 benchmark on this machine.",
        },
        null,
        2,
      ),
    );
  }, 20000);
  it("uses actual o200k encoding for multilingual and token-dense bounded context", () => {
    const { store, service, subject } = setup(),
      lesson = service.conversationCreate({
        subjectId: subject.id,
        title: "多言語の数学 · الرياضيات",
      });
    const data = store.load();
    data.lessons[0].messages = [
      {
        id: "multilingual",
        role: "assistant",
        createdAt: "2026-10-28",
        status: "complete",
        text: "量子力学と微分幾何学 🔬📚 数学证明 أمثلة رياضية ".repeat(120),
      },
    ];
    store.save(data);
    for (let i = 0; i < 6; i++)
      apply(service, subject, [
        put("memory", "multilingual-" + i, {
          kind: "finding",
          title: "多言語の数学 " + i,
          content: "数学证明与推导 العربية الإحصاء 🔬 ".repeat(100),
          conceptIds: [],
        }),
      ]);
    const context = service.context({
      subjectId: subject.id,
      conversationId: lesson.id,
      query: "数学",
      tokenBudget: 700,
    });
    const encoded = encode(JSON.stringify(context)).length;
    expect(context.usage.tokenizer).toBe("o200k_base");
    expect(context.usage.encodedTokens).toBe(encoded);
    expect(context.usage.estimatedTokens).toBe(encoded + 64);
    expect(encoded + 64).toBeLessThanOrEqual(700);
    expect(
      Buffer.byteLength(JSON.stringify(context), "utf8"),
    ).toBeLessThanOrEqual(700 * 8);
  });
});
