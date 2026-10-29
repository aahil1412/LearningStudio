import { afterEach, describe, expect, it } from "vitest";
import { StudioStore } from "../electron/storage";
import { SubjectStore } from "../electron/subjects";
import {
  AnnotationStore,
  reindexAnnotations,
  validateAnnotationData,
} from "../electron/annotations";
import { resolveHighlightAnchor } from "../src/lib/highlightAnchors";
import { layoutConnectedGraph } from "../src/lib/connectedGraph";
import { prepareOfflineBook } from "../electron/exporter";
import type { ReadingHighlight } from "../src/annotationTypes";
import { defaultAppearance } from "../src/lib/themes";
const stores: StudioStore[] = [];
afterEach(() => {
  for (const store of stores.splice(0)) if (store.db.open) store.close();
});
function setup() {
  const store = new StudioStore(":memory:");
  stores.push(store);
  const subjects = new SubjectStore(store),
    subject = subjects.create({
      name: "Biology",
      objective: "Understand living systems",
      depth: "comprehensive",
    });
  const lesson = subjects.conversationCreate({
    subjectId: subject.id,
    title: "Translation",
    mode: "Learn",
  });
  const data = store.load();
  data.lessons.find((item) => item.id === lesson.id)!.messages = [
    {
      id: "message-1",
      role: "assistant",
      text: "A codon is a group of three RNA bases. A ribosome reads each codon.",
      createdAt: new Date().toISOString(),
    },
  ];
  store.save(data);
  const service = new AnnotationStore(store);
  const draft = {
    subjectId: subject.id,
    sourceKind: "message" as const,
    sourceId: "message-1",
    conversationId: lesson.id,
    quote: "A codon is a group of three RNA bases.",
    prefix: "",
    suffix: " A ribosome reads each codon.",
    start: 0,
    end: 38,
    color: "yellow" as const,
    note: "Three bases, one coding unit",
    tags: ["translation"],
  };
  return { store, subjects, subject, lesson, service, draft };
}
describe("persistent reading annotations", () => {
  it("preserves original transcript, deduplicates anchored selections, edits with revision checks and restores deletion", () => {
    const { store, service, draft } = setup(),
      before = JSON.stringify(store.load().lessons);
    const first = service.create(draft);
    expect(service.create(draft).id).toBe(first.id);
    expect(service.list({ subjectId: draft.subjectId })).toHaveLength(1);
    const edited = service.update({
      id: first.id,
      subjectId: first.subjectId,
      expectedRevision: 1,
      patch: { color: "blue", note: "My annotation", tags: ["RNA"] },
    });
    expect(edited.revision).toBe(2);
    expect(() =>
      service.update({
        id: first.id,
        subjectId: first.subjectId,
        expectedRevision: 1,
        patch: { note: "stale" },
      }),
    ).toThrow(/changed/);
    const deleted = service.delete({
      id: first.id,
      subjectId: first.subjectId,
      expectedRevision: 2,
    });
    expect(service.list({ subjectId: first.subjectId })).toHaveLength(0);
    const restored = service.restore({
      id: first.id,
      subjectId: first.subjectId,
      revision: 2,
      expectedRevision: deleted.revision,
    });
    expect(restored.color).toBe("blue");
    expect(restored.revision).toBe(4);
    expect(JSON.stringify(store.load().lessons)).toBe(before);
    validateAnnotationData(store.db);
  });
  it("scopes sources to subjects and searches quotes, notes and tags through indexed subject FTS", () => {
    const { store, subjects, service, draft } = setup();
    const other = subjects.create({
      name: "Physics",
      objective: "Mechanics",
      depth: "overview",
    });
    expect(() => service.create({ ...draft, subjectId: other.id })).toThrow(
      /not part/,
    );
    const highlight = service.create(draft);
    expect(
      service.list({ subjectId: draft.subjectId, query: "coding unit" })[0].id,
    ).toBe(highlight.id);
    const rows = store.db
      .prepare(
        "SELECT record_id FROM subject_search WHERE subject_search MATCH ? AND subject_id=? AND entity='highlight'",
      )
      .all('"coding"', draft.subjectId);
    expect(rows).toEqual([{ record_id: highlight.id }]);
    reindexAnnotations(store.db);
    expect(service.list({ subjectId: other.id })).toHaveLength(0);
  });
  it("reanchors unique or contextual quotes and flags changed or ambiguous text", () => {
    expect(
      resolveHighlightAnchor("Prefix. Repeated. Middle. Repeated. End.", {
        quote: "Repeated.",
        prefix: "Middle. ",
        suffix: " End.",
      }),
    ).toEqual({ start: 26, end: 35, score: 4 });
    expect(
      resolveHighlightAnchor("Same Same", {
        quote: "Same",
        prefix: "",
        suffix: "",
        start: 0,
        end: 4,
      }),
    ).toBeNull();
    expect(
      resolveHighlightAnchor("Edited source", {
        quote: "Original source",
        prefix: "",
        suffix: "",
      }),
    ).toBeNull();
    expect(
      resolveHighlightAnchor("New prefix. Unique quote.", {
        quote: "Unique quote.",
        prefix: "",
        suffix: "",
      }),
    ).toMatchObject({ start: 12, end: 25 });
  });
});
describe("evidence linked graph", () => {
  it("connects the same concept across chats without duplicating nodes or changing understanding", () => {
    const { store, subjects, subject, lesson, service } = setup();
    subjects.apply({
      subjectId: subject.id,
      baseRevision: subjects.snapshot(subject.id).subject.revision,
      label: "Explicit unassessed concept",
      origin: "learner",
      operations: [
        {
          entity: "concept",
          op: "put",
          id: "codon",
          value: {
            label: "codon",
            status: "unassessed",
            coverage: "introduced",
            evidence: "Mentioned, never assessed",
            lessonId: lesson.id,
          },
        },
      ],
    });
    const second = subjects.conversationCreate({
      subjectId: subject.id,
      title: "Genetics",
      mode: "Explore",
    });
    const data = store.load();
    data.lessons.find((item) => item.id === second.id)!.messages = [
      {
        id: "message-2",
        role: "assistant",
        text: "A codon contains three RNA bases. The codon is read during translation.",
        createdAt: new Date().toISOString(),
      },
    ];
    data.library.push({
      id: "note1",
      kind: "note",
      title: "My codon note",
      subject: "Biology",
      subjectId: subject.id,
      content: "A codon has three bases.",
      createdAt: new Date().toISOString(),
    });
    store.save(data);
    const graph = service.graph({ subjectId: subject.id });
    expect(graph.nodes.filter((node) => node.kind === "concept")).toHaveLength(
      1,
    );
    expect(
      graph.links.filter((link) => link.kind === "explained-in"),
    ).toHaveLength(2);
    expect(graph.nodes.find((node) => node.kind === "concept")!.messageId).toBe(
      "message-1",
    );
    expect(subjects.snapshot(subject.id).concepts[0].status).toBe("unassessed");
    const suggested = service.dispatch("graph:suggest", {
      subjectId: subject.id,
    }) as { id: string }[];
    expect(suggested).toHaveLength(1);
    service.dispatch("graph:review", {
      subjectId: subject.id,
      id: suggested[0].id,
      state: "rejected",
    });
    service.dispatch("graph:suggest", { subjectId: subject.id });
    expect(
      service
        .graph({ subjectId: subject.id })
        .links.filter((link) => link.kind === "mentioned-in"),
    ).toHaveLength(0);
    const concept = graph.nodes.find((node) => node.kind === "concept")!;
    service.dispatch("graph:position", {
      subjectId: subject.id,
      nodeId: concept.id,
      x: 900,
      y: 500,
      pinned: true,
    });
    const updated = service.graph({ subjectId: subject.id });
    expect(layoutConnectedGraph(updated)[concept.id]).toEqual({
      x: 900,
      y: 500,
    });
    expect(() =>
      service.dispatch("graph:link", {
        subjectId: subject.id,
        source: concept.id,
        target: "lesson:invented",
        kind: "related",
      }),
    ).toThrow(/existing/);
  });
});
describe("portable reading highlights", () => {
  it("exports only selected-source highlights, preserves ordered blocks and omits private notes when excluded", async () => {
    const { store, subject, lesson, service, draft } = setup();
    const first = service.create(draft);
    const selected = store
      .load()
      .lessons.find((item) => item.id === lesson.id)!;
    selected.messages[0].content = [
      { type: "text", text: "A codon is a group of three RNA bases." },
      { type: "equation", latex: "x=1" },
      { type: "text", text: "A ribosome reads each codon." },
    ];
    const unrelated = {
      ...first,
      id: "hidden",
      sourceId: "not-selected",
      note: "secret private note",
    } as ReadingHighlight;
    const appearance = defaultAppearance();
    appearance.light.typography.readingFont = "Consolas, monospace";
    appearance.light.typography.size = 23;
    appearance.light.presetId = "PRIVATE_PRESET_NAME";
    const book = await prepareOfflineBook(
      {
        title: "Translation",
        subject,
        lessons: [selected],
        chapters: [],
        resources: [],
        visuals: [],
        includeNotes: false,
        includeUserMessages: false,
        exportedAt: new Date().toISOString(),
      },
      { embedResources: false, highlights: [first, unrelated], appearance },
    );
    const chapter = book.chapters.find(
      (item) => item.id === "lesson:" + lesson.id,
    )!;
    expect(chapter.blocks.map((block) => block.type)).toEqual([
      "text",
      "equation",
      "text",
    ]);
    expect(chapter.highlights).toHaveLength(1);
    expect(chapter.highlights![0].note).toBe("");
    expect(JSON.stringify(book)).not.toContain("secret private note");
    expect(chapter.blockSources![0].id).toBe("message-1");
    expect(book.appearance?.light.typography.readingFont).toBe(
      "Consolas, monospace",
    );
    expect(book.appearance?.light.typography.size).toBe(23);
    expect(JSON.stringify(book)).not.toContain("PRIVATE_PRESET_NAME");
  });
});
