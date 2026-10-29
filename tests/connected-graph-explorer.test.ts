import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { StudioStore } from "../electron/storage";
import { SubjectStore } from "../electron/subjects";
import {
  AnnotationStore,
  validateAnnotationData,
} from "../electron/annotations";
import {
  layoutConnectedGraph,
  connectedGraphViewport,
  graphKeywordTokens,
  selectConnectedGraph,
  sortGraphNodes,
} from "../src/lib/connectedGraph";
import type { ConnectedGraph } from "../src/annotationTypes";
const stores: StudioStore[] = [];
afterEach(() => {
  for (const store of stores.splice(0)) store.close();
});
function setup() {
  const store = new StudioStore(":memory:");
  stores.push(store);
  const subjects = new SubjectStore(store),
    subject = subjects.create({
      name: "Molecular systems",
      objective: "Understand mechanisms",
      depth: "overview",
    }),
    lesson = subjects.conversationCreate({
      subjectId: subject.id,
      title: "Original source",
      mode: "Learn",
    });
  return {
    store,
    subjects,
    subject,
    lesson,
    service: new AnnotationStore(store),
  };
}
function sourceGraph(count = 1000): ConnectedGraph {
  return {
    nodes: Array.from({ length: count }, (_, i) => ({
      id: `node-${i}`,
      sourceId: `source-${i}`,
      kind: "concept" as const,
      label: i === 999 ? "Rare codon boundary" : "Concept " + i,
      definition:
        i % 2 ? "RNA translation mechanisms" : "Protein folding mechanisms",
      subjectId: i < 500 ? "biology" : "physics",
      subjectName: i < 500 ? "Biology" : "Physics",
      updatedAt: new Date(2026, 0, 1 + (i % 28)).toISOString(),
    })),
    links: Array.from({ length: count - 1 }, (_, i) => ({
      id: `link-${i}`,
      source: `node-${i}`,
      target: `node-${i + 1}`,
      kind: "related",
      state: "accepted" as const,
      reason: "Explicit synthetic relation",
    })),
    positions: { "node-999": { x: 800, y: 450, pinned: true } },
    totalNodes: count,
    truncated: false,
  };
}
describe("bounded connected exploration", () => {
  it("keeps a thousand-node library bounded, retains low-degree direct matches and never returns dangling edges", () => {
    const graph = sourceGraph(),
      all = selectConnectedGraph(graph, { limit: 120 }),
      search = selectConnectedGraph(graph, { query: "Rare codon", limit: 10 });
    expect(all.availableNodes).toBe(1000);
    expect(all.nodes).toHaveLength(120);
    expect(all.truncated).toBe(true);
    expect(search.matchedNodes).toBe(1);
    expect(search.nodes.some((node) => node.id === "node-999")).toBe(true);
    expect(search.nodes).toHaveLength(2);
    for (const edge of all.links) {
      expect(all.nodes.some((node) => node.id === edge.source)).toBe(true);
      expect(all.nodes.some((node) => node.id === edge.target)).toBe(true);
    }
    expect(all.keywords?.some((item) => item.keyword === "concept")).toBe(
      false,
    );
    expect(all.keywords?.some((item) => /^\p{N}+$/u.test(item.keyword))).toBe(
      false,
    );
    expect(all.clusters).toEqual([
      { id: "biology", label: "Biology", count: 500 },
      { id: "physics", label: "Physics", count: 500 },
    ]);
  });
  it("supports multiple keywords, types, relation visibility, recent/name sorting and two-hop focus without changing source records", () => {
    const graph = sourceGraph(30),
      before = JSON.stringify(graph);
    const both = selectConnectedGraph(graph, {
      keywords: ["protein", "folding"],
      keywordMode: "all",
    });
    const either = selectConnectedGraph(graph, {
      keywords: ["protein", "RNA"],
      keywordMode: "any",
    });
    expect(both.matchedNodes).toBe(15);
    expect(either.matchedNodes).toBe(30);
    const focus = selectConnectedGraph(graph, { focusId: "node-10", hops: 2 });
    expect(focus.nodes.map((node) => node.id).sort()).toEqual(
      ["node-8", "node-9", "node-10", "node-11", "node-12"].sort(),
    );
    expect(sortGraphNodes(graph.nodes, graph, "recent")[0].updatedAt).toBe(
      new Date(2026, 0, 28).toISOString(),
    );
    expect(sortGraphNodes(graph.nodes, graph, "alphabetical")[0].label).toBe(
      "Concept 0",
    );
    expect(JSON.stringify(graph)).toBe(before);
  });
  it("keeps original source backlinks when lesson nodes or lines are hidden from the drawing", () => {
    const graph = sourceGraph(3);
    graph.nodes.push({
      id: "lesson",
      sourceId: "lesson",
      kind: "lesson",
      label: "Source lesson",
      definition: "Original explanation",
      conversationId: "lesson",
    });
    graph.links.push({
      id: "source-link",
      source: "node-0",
      target: "lesson",
      kind: "explained-in",
      state: "accepted",
      reason: "Actual source",
    });
    const selected = selectConnectedGraph(graph, {
      nodeKinds: ["concept"],
      linkKinds: ["related"],
    });
    expect(selected.nodes.every((node) => node.kind === "concept")).toBe(true);
    expect(selected.links.some((link) => link.id === "source-link")).toBe(
      false,
    );
    expect(
      selected.backlinks?.["node-0"].some(
        (entry) => entry.node.id === "lesson",
      ),
    ).toBe(true);
  });
  it("lays out the bounded result deterministically, with finite positions and exact immutable pins", () => {
    const graph = selectConnectedGraph(sourceGraph(), {
      query: "codon",
      limit: 120,
    });
    const a = layoutConnectedGraph(graph),
      b = layoutConnectedGraph(graph);
    expect(a).toEqual(b);
    expect(a["node-999"]).toEqual({ x: 800, y: 450 });
    expect(
      Object.values(a).every(
        (value) => Number.isFinite(value.x) && Number.isFinite(value.y),
      ),
    ).toBe(true);
  });
  it("offers meaningful keyword facets while retaining numeric query matching", () => {
    expect(
      graphKeywordTokens("Mechanism 100 1001 H2O IL-6 α-helix １２３"),
    ).toEqual(["mechanism", "h2o", "il-6", "α-helix"]);
    const graph = sourceGraph(),
      numeric = selectConnectedGraph(graph, { query: "100", limit: 10 });
    expect(numeric.nodes.some((node) => node.label === "Concept 100")).toBe(
      true,
    );
  });
  it("fits every declared node inside the viewport with padding, including negative coordinates, labels and saved pins", () => {
    const graph = selectConnectedGraph(sourceGraph(), { limit: 120 });
    graph.positions[graph.nodes[0].id] = { x: -3400, y: -1800, pinned: true };
    const positions = layoutConnectedGraph(graph);
    for (const [width, height, labels] of [
      [1060, 780, false],
      [400, 440, true],
      [720, 350, true],
    ] as const) {
      const viewport = connectedGraphViewport(
        positions,
        width,
        height,
        labels,
      )!;
      for (const point of Object.values(positions)) {
        expect(point.x * viewport.zoom + viewport.x).toBeGreaterThanOrEqual(23);
        expect(point.y * viewport.zoom + viewport.y).toBeGreaterThanOrEqual(23);
        expect(
          (point.x + (labels ? 205 : 40)) * viewport.zoom + viewport.x,
        ).toBeLessThanOrEqual(width - 23);
        expect((point.y + 40) * viewport.zoom + viewport.y).toBeLessThanOrEqual(
          height - 23,
        );
      }
    }
    expect(connectedGraphViewport({}, 100, 100)).toBeNull();
    expect(connectedGraphViewport(positions, 0, 100)).toBeNull();
  });
});
describe("automatic source-backed associations", () => {
  it("connects concepts across real source passages automatically, deduplicates references and never upgrades understanding", () => {
    const { store, subjects, subject, lesson, service } = setup();
    subjects.apply({
      subjectId: subject.id,
      baseRevision: subjects.snapshot(subject.id).subject.revision,
      label: "Explicit concepts",
      origin: "learner",
      operations: ["codon", "ribosome"].map((id) => ({
        entity: "concept",
        op: "put",
        id,
        value: {
          label: id,
          status: "unassessed",
          coverage: "introduced",
          evidence: "Not assessed",
          lessonId: lesson.id,
        },
      })),
    });
    const second = subjects.conversationCreate({
      subjectId: subject.id,
      title: "Second source",
      mode: "Explore",
    });
    const data = store.load();
    for (const item of data.lessons.filter((item) =>
      [lesson.id, second.id].includes(item.id),
    ))
      item.messages = [
        {
          id: "source-" + item.id,
          role: "assistant",
          text: "A ribosome reads each codon. Their relationship is discussed in this passage.",
          createdAt: new Date().toISOString(),
          status: "complete",
        },
      ];
    store.save(data);
    const graph = service.graph({ subjectId: subject.id }),
      links = graph.links.filter((edge) => edge.kind === "co-mentioned");
    expect(links).toHaveLength(1);
    expect(links[0].state).toBe("accepted");
    expect(links[0].sourceReferences).toHaveLength(2);
    expect(
      links[0]
        .sourceReferences!.map((reference) => reference.conversationId)
        .sort(),
    ).toEqual([lesson.id, second.id].sort());
    expect(
      service
        .graph({ subjectId: subject.id })
        .links.filter((edge) => edge.kind === "co-mentioned"),
    ).toHaveLength(1);
    expect(
      subjects
        .snapshot(subject.id)
        .concepts.every((concept) => concept.status === "unassessed"),
    ).toBe(true);
  });
  it("derives encountered nodes from two definition-only chats without fabricating tracked knowledge, and preserves identity when explicitly tracked", () => {
    const { store, subjects, subject, lesson, service } = setup();
    const second = subjects.conversationCreate({
      subjectId: subject.id,
      title: "Follow-up",
      mode: "Explore",
    });
    const data = store.load();
    for (const item of data.lessons.filter((item) =>
      [lesson.id, second.id].includes(item.id),
    ))
      item.messages = [
        {
          id: "terms-" + item.id,
          role: "assistant",
          text: "A ribosome reads a codon.",
          content: [
            {
              type: "terms",
              items: [
                { term: "codon", definition: "A group of three mRNA bases." },
                {
                  term: "ribosome",
                  definition: "A molecular complex that reads mRNA.",
                },
              ],
            },
          ],
          status: "complete",
          createdAt: new Date().toISOString(),
        },
      ];
    data.library.push({
      id: "source-note",
      kind: "note",
      subject: subject.name,
      subjectId: subject.id,
      title: "Saved source excerpt",
      content: "A note linked directly to a lesson",
      lessonIds: [lesson.id],
      createdAt: new Date().toISOString(),
    });
    store.save(data);
    const before = JSON.stringify(store.load().concepts),
      graph = service.graph({ subjectId: subject.id }),
      concepts = graph.nodes.filter((node) => node.kind === "concept");
    expect(concepts).toHaveLength(2);
    expect(
      concepts.every((node) => node.derived && node.status === "encountered"),
    ).toBe(true);
    expect(
      graph.links.filter((edge) => edge.kind === "explained-in"),
    ).toHaveLength(4);
    expect(
      graph.links.filter((edge) => edge.kind === "co-mentioned"),
    ).toHaveLength(1);
    expect(
      graph.links.some(
        (edge) =>
          edge.kind === "saved-from" &&
          edge.source === "note:source-note" &&
          edge.target === "lesson:" + lesson.id,
      ),
    ).toBe(true);
    expect(JSON.stringify(store.load().concepts)).toBe(before);
    expect(subjects.snapshot(subject.id).concepts).toHaveLength(0);
    const codon = concepts.find((node) => node.label === "codon")!;
    expect(
      service
        .graph({ subjectId: subject.id })
        .nodes.find((node) => node.label === "codon")!.id,
    ).toBe(codon.id);
    subjects.apply({
      subjectId: subject.id,
      baseRevision: subjects.snapshot(subject.id).subject.revision,
      label: "Explicit learner tracking",
      origin: "learner",
      operations: [
        {
          entity: "concept",
          op: "put",
          id: codon.sourceId,
          value: {
            label: codon.label,
            notes: "Learner-edited definition",
            status: "unassessed",
            evidence: "Not assessed",
            lessonId: lesson.id,
          },
        },
      ],
    });
    const edited = store.load();
    edited.concepts.find((concept) => concept.id === codon.sourceId)!.notes =
      "Learner-edited definition";
    store.save(edited);
    const tracked = service
      .graph({ subjectId: subject.id })
      .nodes.find((node) => node.label === "codon")!;
    expect(tracked.id).toBe(codon.id);
    expect(tracked.derived).not.toBe(true);
    expect(tracked.definition).toBe("Learner-edited definition");
    expect(tracked.status).toBe("unassessed");
    expect(subjects.snapshot(subject.id).concepts).toHaveLength(1);
  });
  it("keeps derived tracked IDs globally distinct across subjects with the same term", () => {
    const { store, subjects, subject, lesson, service } = setup(),
      other = subjects.create({
        name: "Second workspace",
        objective: "Independent scope",
        depth: "overview",
      }),
      otherLesson = subjects.conversationCreate({
        subjectId: other.id,
        title: "Same term",
        mode: "Learn",
      });
    const data = store.load();
    for (const item of data.lessons.filter((item) =>
      [lesson.id, otherLesson.id].includes(item.id),
    ))
      item.messages = [
        {
          id: "scoped-" + item.id,
          role: "assistant",
          text: "A field assigns values throughout space.",
          content: [
            {
              type: "terms",
              items: [
                {
                  term: "field",
                  definition: "A value associated with each position.",
                },
              ],
            },
          ],
          createdAt: new Date().toISOString(),
          status: "complete",
        },
      ];
    store.save(data);
    const encountered = [subject, other].map((item) =>
      service.graph({ subjectId: item.id }).nodes.find((node) => node.derived)!,
    );
    expect(encountered[0].sourceId).not.toBe(encountered[1].sourceId);
    for (const node of encountered)
      subjects.apply({
        subjectId: node.subjectId,
        baseRevision: subjects.snapshot(node.subjectId!).subject.revision,
        label: "Explicit scoped tracking",
        origin: "learner",
        operations: [
          {
            entity: "concept",
            op: "put",
            id: node.sourceId,
            value: {
              label: node.label,
              status: "unassessed",
              evidence: "Not assessed",
              lessonId: node.conversationId,
            },
          },
        ],
      });
    expect(
      store.load().concepts.filter((concept) => concept.label === "field"),
    ).toHaveLength(2);
    expect(
      service
        .graph({})
        .nodes.filter(
          (node) => node.kind === "concept" && node.label === "field",
        ),
    ).toHaveLength(2);
  });
  it("keeps cross-subject same-name associations reviewable and does not resurrect rejected suggestions", () => {
    const { store, subjects, subject, service } = setup(),
      other = subjects.create({
        name: "Another subject",
        objective: "Different scope",
        depth: "overview",
      });
    for (const item of [subject, other])
      subjects.apply({
        subjectId: item.id,
        baseRevision: subjects.snapshot(item.id).subject.revision,
        label: "Scoped record",
        origin: "learner",
        operations: [
          {
            entity: "concept",
            op: "put",
            id: "energy-" + item.id,
            value: {
              label: "Energy",
              status: "unassessed",
              evidence: "No assessment",
            },
          },
        ],
      });
    const graph = service.graph({}),
      link = graph.links.find((edge) => edge.kind === "same-label")!;
    expect(link.state).toBe("suggested");
    expect(link.ownerSubjectId).toBeTruthy();
    expect(graph.nodes.filter((node) => node.kind === "concept")).toHaveLength(
      2,
    );
    service.dispatch("graph:suggest", {});
    service.dispatch("graph:review", {
      subjectId: link.ownerSubjectId,
      id: link.id,
      state: "rejected",
    });
    service.dispatch("graph:suggest", {});
    expect(service.graph({}).links.some((edge) => edge.id === link.id)).toBe(
      false,
    );
    expect(() => validateAnnotationData(store.db)).not.toThrow();
  });
  it("retrieves and lays out a real thousand-concept SQLite subject within a bounded view", () => {
    const { store, subjects, subject, lesson, service } = setup();
    const data = store.load();
    data.concepts = Array.from({ length: 1200 }, (_, i) => ({
      id: "synthetic-" + i,
      subjectId: subject.id,
      label: i === 1199 ? "Rare mechanism" : "Mechanism " + i,
      status: "unassessed",
      evidence: "Synthetic performance fixture, no demonstrated knowledge",
      lessonId: lesson.id,
    }));
    store.save(data);
    const start = performance.now(),
      graph = service.graph({ subjectId: subject.id, limit: 120 }),
      retrieved = performance.now(),
      positions = layoutConnectedGraph(graph),
      laidOut = performance.now();
    expect(graph.availableNodes).toBeGreaterThanOrEqual(1200);
    expect(graph.nodes.length).toBeLessThanOrEqual(120);
    expect(Object.keys(positions)).toHaveLength(graph.nodes.length);
    const searched = service.graph({
      subjectId: subject.id,
      query: "Rare mechanism",
      limit: 10,
    });
    expect(searched.nodes.some((node) => node.label === "Rare mechanism")).toBe(
      true,
    );
    mkdirSync("docs", { recursive: true });
    writeFileSync(
      "docs/graph-v22-benchmark.json",
      JSON.stringify(
        {
          scope:
            "Synthetic 1200-concept SQLite subject, actual AnnotationStore retrieval and bounded force layout. Not a live learner profile.",
          availableNodes: graph.availableNodes,
          renderedNodes: graph.nodes.length,
          renderedLinks: graph.links.length,
          retrievalMs: retrieved - start,
          layoutMs: laidOut - retrieved,
          sourceKnowledgeUnchanged: subjects
            .snapshot(subject.id)
            .concepts.every((concept) => concept.status === "unassessed"),
        },
        null,
        2,
      ),
    );
  });
});
