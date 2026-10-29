import { afterEach, describe, expect, it } from "vitest";
import { encode } from "gpt-tokenizer/encoding/o200k_base";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { StudioStore } from "../electron/storage";
import { SubjectStore } from "../electron/subjects";
import { StudySourceService } from "../electron/studySources";
import type { LibraryItem } from "../src/types";
import type { StudySourcePreview } from "../src/sourceStudyTypes";

const stores: StudioStore[] = [];
const temporary: string[] = [];
afterEach(() => {
  for (const store of stores.splice(0)) if (store.db.open) store.close();
  for (const path of temporary.splice(0))
    rmSync(path, { recursive: true, force: true });
});
function setup() {
  const store = new StudioStore(":memory:");
  stores.push(store);
  const subjects = new SubjectStore(store);
  const subject = subjects.create({
    name: "Source study",
    objective: "Learn according to a supplied source",
    depth: "comprehensive",
  });
  const service = new StudySourceService(store, subjects);
  return { store, subjects, subject, service };
}
function addDocument(
  ctx: ReturnType<typeof setup>,
  patch: Partial<LibraryItem> = {},
) {
  const document: LibraryItem = {
    id: "book-1",
    kind: "document",
    subjectId: ctx.subject.id,
    subject: ctx.subject.name,
    title: "An actual textbook",
    content:
      "Chapter 1: Cells\r\nCells have membranes.\r\nSection 1.1: Inside cells\r\nOrganelles perform distinct functions.\r\nChapter 2: Genetics\r\nDNA stores genetic information.\r\nChapter 3: Ecology\r\nEcosystems exchange energy.",
    createdAt: new Date().toISOString(),
    verified: false,
    ...patch,
  };
  const data = ctx.store.load();
  ctx.store.save({ ...data, library: [...data.library, document] });
  return document;
}
function savePreview(
  ctx: ReturnType<typeof setup>,
  preview: StudySourcePreview,
) {
  return ctx.service.save({
    ...preview,
    sourceId: preview.id,
    expectedRevision: preview.revision,
  });
}
function book(ctx: ReturnType<typeof setup>) {
  const document = addDocument(ctx);
  const source = savePreview(
    ctx,
    ctx.service.prepare({
      subjectId: ctx.subject.id,
      kind: "textbook",
      resourceId: document.id,
    }),
  );
  return { document, source };
}

describe("reviewed curricula and textbooks", () => {
  it("detects source headings locally, preserves CRLF offsets and never starts AI or creates knowledge", () => {
    const ctx = setup(),
      document = addDocument(ctx);
    const before = ctx.subjects.snapshot(ctx.subject.id);
    const preview = ctx.service.prepare({
      subjectId: ctx.subject.id,
      kind: "textbook",
      resourceId: document.id,
    });
    expect(preview.entries.map((entry) => entry.title)).toEqual([
      "Chapter 1: Cells",
      "Section 1.1: Inside cells",
      "Chapter 2: Genetics",
      "Chapter 3: Ecology",
    ]);
    for (const entry of preview.entries)
      expect(
        document.content.slice(
          entry.startOffset,
          entry.startOffset! + entry.sourceHeading!.length,
        ),
      ).toBe(entry.sourceHeading);
    expect(preview.entries[1].parentId).toBe(preview.entries[0].id);
    expect(preview.entries[0].endOffset).toBe(
      document.content.indexOf("Chapter 2"),
    );
    expect(ctx.service.list(ctx.subject.id)).toHaveLength(0);
    expect(ctx.subjects.snapshot(ctx.subject.id).subject.revision).toBe(
      before.subject.revision,
    );
    const source = savePreview(ctx, preview);
    expect(source.warnings).toEqual(preview.warnings);
    const snapshot = ctx.subjects.snapshot(ctx.subject.id);
    expect(snapshot.concepts).toEqual([]);
    expect(snapshot.evidence).toEqual([]);
    expect(snapshot.curriculum).toEqual([]);
  });
  it("detects a university week outline, saves pasted content only once, and adopts a reviewed source without mastery", () => {
    const ctx = setup();
    const preview = ctx.service.prepare({
      subjectId: ctx.subject.id,
      kind: "curriculum",
      title: "University mechanics",
      text: "Week 1: Motion\n- Coordinates and velocity\nWeek 2: Forces\n- Newton's laws\nWeek 3: Energy\n- Work and conservation",
    });
    expect(
      preview.entries.filter((entry) => entry.kind === "week"),
    ).toHaveLength(3);
    expect(preview.entries[1].parentId).toBe(preview.entries[0].id);
    expect(preview.entries[3].parentId).toBe(preview.entries[2].id);
    expect(
      ctx.store.load().library.filter((item) => item.kind === "document"),
    ).toHaveLength(0);
    const source = savePreview(ctx, preview);
    expect(
      ctx.store.load().library.filter((item) => item.id === source.resourceId),
    ).toHaveLength(1);
    const result = ctx.service.adopt({
      subjectId: ctx.subject.id,
      sourceId: source.id,
    });
    expect(result.mappings).toHaveLength(6);
    const snapshot = ctx.subjects.snapshot(ctx.subject.id);
    expect(snapshot.curriculum).toHaveLength(7);
    expect(
      snapshot.curriculum.every((node) => node.status === "not-started"),
    ).toBe(true);
    expect(snapshot.concepts).toEqual([]);
    expect(snapshot.evidence).toEqual([]);
    expect(
      ctx.store.load().library.find((item) => item.id === source.resourceId)!
        .verified,
    ).toBe(false);
    const version = snapshot.subject.revision;
    ctx.service.adopt({ subjectId: ctx.subject.id, sourceId: source.id });
    expect(ctx.subjects.snapshot(ctx.subject.id).subject.revision).toBe(
      version,
    );
    savePreview(ctx, { ...source, text: preview.text });
    expect(
      ctx.store.load().library.filter((item) => item.id === source.resourceId),
    ).toHaveLength(1);
  });
  it("does not invent an outline or treat printed contents numbers as verified PDF pages", () => {
    const ctx = setup(),
      plain = addDocument(ctx, {
        content:
          "This is continuous prose without a chapter outline. Chapter introduces a concept in a sentence.",
      });
    const manual = ctx.service.prepare({
      subjectId: ctx.subject.id,
      kind: "textbook",
      resourceId: plain.id,
    });
    expect(manual.structure).toBe("manual");
    expect(manual.entries).toEqual([]);
    expect(manual.warnings.join(" ")).toMatch(/will not invent/);
    const toc = addDocument(ctx, {
      id: "toc-book",
      content: "Contents",
      pages: [
        {
          page: 1,
          text: "Contents\nChapter 1: Cells ........ 9\nChapter 2: Genetics ........ 47",
        },
      ],
    });
    const preview = ctx.service.prepare({
      subjectId: ctx.subject.id,
      kind: "textbook",
      resourceId: toc.id,
    });
    expect(preview.entries).toHaveLength(2);
    expect(
      preview.entries.every((entry) => entry.startPage === undefined),
    ).toBe(true);
    expect(preview.warnings.join(" ")).toMatch(/not verified PDF/);
    const source = savePreview(ctx, preview);
    expect(source.entries[0].title).toBe("Chapter 1: Cells");
  });
  it("validates parent relationships, page anchors, fingerprints and revisions before changing saved work", () => {
    const ctx = setup(),
      { source } = book(ctx),
      initial = JSON.stringify(ctx.service.list(ctx.subject.id));
    const input = {
      ...source,
      sourceId: source.id,
      expectedRevision: source.revision,
    };
    expect(() =>
      ctx.service.save({
        ...input,
        entries: [...source.entries, source.entries[0]],
      }),
    ).toThrow(/unique/);
    expect(() =>
      ctx.service.save({
        ...input,
        entries: source.entries.map((entry, i) =>
          i === 0 ? { ...entry, parentId: source.entries[1].id } : entry,
        ),
      }),
    ).toThrow(/circular/);
    expect(() =>
      ctx.service.save({
        ...input,
        entries: source.entries.map((entry) => ({ ...entry, startPage: 3 })),
      }),
    ).toThrow(/no verified page/);
    expect(() => ctx.service.save({ ...input, fingerprint: "stale" })).toThrow(
      /document changed/,
    );
    expect(() =>
      ctx.service.save({
        ...input,
        entries: [{ ...source.entries[0], parentId: "missing" }],
      }),
    ).toThrow(/parent is missing/);
    expect(JSON.stringify(ctx.service.list(ctx.subject.id))).toBe(initial);
    const edited = ctx.service.save({
      ...input,
      entries: source.entries.map((entry, i) =>
        i === 0 ? { ...entry, title: "Cells, renamed by learner" } : entry,
      ),
    });
    expect(edited.revision).toBe(source.revision + 1);
    expect(() => ctx.service.save(input)).toThrow(/changed/);
    expect(
      ctx.service.save({
        ...edited,
        sourceId: edited.id,
        expectedRevision: edited.revision,
      }).revision,
    ).toBe(edited.revision);
  });
  it("preserves existing learner edits and progress, isolates subjects and removes alignment non-destructively", () => {
    const ctx = setup(),
      { source, document } = book(ctx);
    const adoption = ctx.service.adopt({
        subjectId: ctx.subject.id,
        sourceId: source.id,
      }),
      nodeId = adoption.mappings[0].curriculumNodeId;
    ctx.subjects.apply({
      subjectId: ctx.subject.id,
      baseRevision: ctx.subjects.snapshot(ctx.subject.id).subject.revision,
      label: "My chapter edit",
      origin: "learner",
      operations: [
        {
          entity: "curriculum",
          op: "put",
          id: nodeId,
          value: { title: "My title", status: "covered", userEdited: true },
        },
      ],
    });
    const repeated = ctx.service.adopt({
      subjectId: ctx.subject.id,
      sourceId: source.id,
    });
    expect(repeated.preservedNodeIds).toContain(nodeId);
    const node = ctx.subjects
      .snapshot(ctx.subject.id)
      .curriculum.find((node) => node.id === nodeId)!;
    expect(node.title).toBe("My title");
    expect(node.status).toBe("covered");
    const other = ctx.subjects.create({
      name: "Another subject",
      objective: "Separate learning",
      depth: "overview",
    });
    expect(() =>
      ctx.service.prepare({
        subjectId: other.id,
        kind: "textbook",
        resourceId: document.id,
      }),
    ).toThrow(/must belong/);
    expect(() =>
      ctx.service.adopt({ subjectId: other.id, sourceId: source.id }),
    ).toThrow(/missing/);
    const otherChat = ctx.subjects.conversationCreate({
      subjectId: other.id,
      title: "Other",
      mode: "Learn",
    });
    expect(() =>
      ctx.service.context({
        subjectId: ctx.subject.id,
        conversationId: otherChat.id,
      }),
    ).toThrow(/does not belong/);
    ctx.service.remove({ subjectId: ctx.subject.id, sourceId: source.id });
    expect(ctx.service.list(ctx.subject.id)).toEqual([]);
    expect(ctx.subjects.snapshot(ctx.subject.id).curriculum).toHaveLength(5);
    expect(
      ctx.store.load().library.some((item) => item.id === document.id),
    ).toBe(true);
  });
});

describe("source-governed compact teaching context", () => {
  it("reads an existing Markdown import as unpaged text without mutating its stored synthetic page record", () => {
    const ctx = setup(),
      document = addDocument(ctx, {
        source: "outline.md",
        content:
          "[Page 1]\n# Mechanics\n## Motion\nPosition changes relative to an origin.",
        pages: [
          {
            page: 1,
            text: "# Mechanics\n## Motion\nPosition changes relative to an origin.",
          },
        ],
      });
    const original = JSON.stringify(
      ctx.store.load().library.find((item) => item.id === document.id),
    );
    const preview = ctx.service.prepare({
      subjectId: ctx.subject.id,
      kind: "curriculum",
      resourceId: document.id,
    });
    expect(preview.entries.length).toBeGreaterThan(0);
    expect(
      preview.entries.every(
        (entry) => entry.startPage === undefined && entry.endPage === undefined,
      ),
    ).toBe(true);
    const source = savePreview(ctx, preview);
    ctx.service.adopt({ subjectId: ctx.subject.id, sourceId: source.id });
    const context = ctx.service.context({
      subjectId: ctx.subject.id,
      query: "continue",
    });
    expect(context.excerpts.length).toBeGreaterThan(0);
    expect(
      context.excerpts.every(
        (excerpt) =>
          excerpt.page === undefined && !excerpt.citation.includes("PDF page"),
      ),
    ).toBe(true);
    expect(context.excerpts.map((excerpt) => excerpt.text).join(" ")).toContain(
      "Position changes",
    );
    expect(
      context.excerpts.map((excerpt) => excerpt.text).join(" "),
    ).not.toContain("[Page 1]");
    expect(
      JSON.stringify(
        ctx.store.load().library.find((item) => item.id === document.id),
      ),
    ).toBe(original);
  });
  it("honors manually corrected PDF page ranges while retaining precise offsets for title-only edits", () => {
    const ctx = setup(),
      document = addDocument(ctx, {
        pages: [
          {
            page: 1,
            text: "Chapter 1: Motion\nA misleading heading in a front-page overview.",
          },
          {
            page: 2,
            text: "Actual-motion-section. Position changes relative to an origin.",
          },
          { page: 3, text: "Later-motion-page. Velocity includes direction." },
          { page: 4, text: "Chapter 2: Forces\nActual forces and momentum." },
        ],
      });
    const preview = ctx.service.prepare({
      subjectId: ctx.subject.id,
      kind: "textbook",
      resourceId: document.id,
    });
    const renamed = savePreview(ctx, {
      ...preview,
      entries: preview.entries.map((entry, index) =>
        index === 0 ? { ...entry, title: "My motion lesson" } : entry,
      ),
    });
    expect(renamed.entries[0].startOffset).toBe(preview.entries[0].startOffset);
    expect(renamed.entries[0].endOffset).toBe(preview.entries[0].endOffset);
    const adoption = ctx.service.adopt({
        subjectId: ctx.subject.id,
        sourceId: renamed.id,
      }),
      node = adoption.mappings[0].curriculumNodeId;
    const corrected = ctx.service.save({
      ...renamed,
      sourceId: renamed.id,
      expectedRevision: renamed.revision,
      entries: renamed.entries.map((entry, index) =>
        index === 0 ? { ...entry, startPage: 2, endPage: 2 } : entry,
      ),
    });
    expect(corrected.entries[0].startOffset).toBeUndefined();
    expect(corrected.entries[0].endOffset).toBeUndefined();
    expect(corrected.entries[1].startOffset).toBe(
      renamed.entries[1].startOffset,
    );
    const context = ctx.service.context({
      subjectId: ctx.subject.id,
      curriculumNodeId: node,
      query: "continue",
    });
    expect(context.currentEntry).toMatchObject({
      title: "My motion lesson",
      startPage: 2,
      endPage: 2,
    });
    expect(context.excerpts.length).toBeGreaterThan(0);
    expect(context.excerpts.every((excerpt) => excerpt.page === 2)).toBe(true);
    const text = context.excerpts.map((excerpt) => excerpt.text).join(" ");
    expect(text).toContain("Actual-motion-section");
    expect(text).not.toContain("misleading");
    expect(text).not.toContain("Later-motion-page");
  });
  it("ends a chapter before the next chapter's physical page while retaining exact shared-page boundaries", () => {
    const ctx = setup(),
      document = addDocument(ctx, {
        pages: [
          { page: 1, text: "A title page with no numbered chapter heading." },
          {
            page: 2,
            text: "Chapter 1: Mechanics\nChapter-one-exclusive motion and velocity.",
          },
          {
            page: 3,
            text: "More chapter-one-exclusive explanations of forces.",
          },
          {
            page: 4,
            text: "Chapter 2: Waves\nChapter-two-exclusive wave propagation.",
          },
          {
            page: 5,
            text: "Chapter 3: Thermodynamics\nChapter-three-exclusive energy.",
          },
        ],
      });
    const preview = ctx.service.prepare({
      subjectId: ctx.subject.id,
      kind: "textbook",
      resourceId: document.id,
    });
    expect(
      preview.entries.map((entry) => [entry.startPage, entry.endPage]),
    ).toEqual([
      [2, 3],
      [4, 4],
      [5, 5],
    ]);
    const source = savePreview(ctx, preview);
    ctx.service.adopt({ subjectId: ctx.subject.id, sourceId: source.id });
    const first = ctx.service.context({
      subjectId: ctx.subject.id,
      query: "continue",
    });
    expect(
      first.excerpts.every(
        (excerpt) =>
          excerpt.page !== undefined && excerpt.page >= 2 && excerpt.page <= 3,
      ),
    ).toBe(true);
    expect(
      first.excerpts.map((excerpt) => excerpt.text).join(" "),
    ).not.toContain("Chapter-two-exclusive");
    const shared = addDocument(ctx, {
      id: "shared-page-book",
      pages: [
        {
          page: 1,
          text: "Chapter 1: Mechanics\nOnly-first-chapter motion.\nChapter 2: Waves\nOnly-second-chapter oscillations.",
        },
      ],
    });
    const sharedPreview = ctx.service.prepare({
      subjectId: ctx.subject.id,
      kind: "textbook",
      resourceId: shared.id,
    });
    expect(
      sharedPreview.entries.map((entry) => [entry.startPage, entry.endPage]),
    ).toEqual([
      [1, 1],
      [1, 1],
    ]);
    const sharedSource = savePreview(ctx, sharedPreview),
      adoption = ctx.service.adopt({
        subjectId: ctx.subject.id,
        sourceId: sharedSource.id,
      });
    const current = ctx.service.context({
      subjectId: ctx.subject.id,
      curriculumNodeId: adoption.mappings[0].curriculumNodeId,
      query: "continue",
    });
    expect(current.excerpts[0].page).toBe(1);
    expect(current.excerpts.map((excerpt) => excerpt.text).join(" ")).toContain(
      "Only-first-chapter",
    );
    expect(
      current.excerpts.map((excerpt) => excerpt.text).join(" "),
    ).not.toContain("Only-second-chapter");
  });
  it("retains a removed section's lesson but does not silently resume another chapter", () => {
    const ctx = setup(),
      { source } = book(ctx),
      adoption = ctx.service.adopt({
        subjectId: ctx.subject.id,
        sourceId: source.id,
      });
    const entry = source.entries.find((entry) =>
      entry.title.includes("Genetics"),
    )!;
    const node = adoption.mappings.find(
      (mapping) => mapping.entryId === entry.id,
    )!.curriculumNodeId;
    ctx.service.save({
      ...source,
      sourceId: source.id,
      expectedRevision: source.revision,
      entries: source.entries.filter((item) => item.id !== entry.id),
    });
    const context = ctx.service.context({
      subjectId: ctx.subject.id,
      curriculumNodeId: node,
      query: "continue",
    });
    expect(context.currentEntry).toBeUndefined();
    expect(context.excerpts).toEqual([]);
    expect(context.warnings.join(" ")).toMatch(/removed from this outline/);
    expect(
      ctx.subjects
        .snapshot(ctx.subject.id)
        .curriculum.some((item) => item.id === node),
    ).toBe(true);
  });
  it("continues the mapped chapter in another chat with exact physical PDF citations", () => {
    const ctx = setup();
    const document = addDocument(ctx, {
      content: "Original PDF extracted text",
      pages: [
        { page: 1, text: "Chapter 1: Cells\nCells have membranes." },
        {
          page: 2,
          text: "Section 1.1: Organelles\nMitochondria process energy.",
        },
        {
          page: 3,
          text: "Chapter 2: Genetics\nDNA stores genetic information and inheritance.",
        },
        { page: 4, text: "Genetic information is passed between generations." },
      ],
    });
    const source = savePreview(
      ctx,
      ctx.service.prepare({
        subjectId: ctx.subject.id,
        kind: "textbook",
        resourceId: document.id,
      }),
    );
    const adoption = ctx.service.adopt({
      subjectId: ctx.subject.id,
      sourceId: source.id,
    });
    const entry = source.entries.find((entry) =>
      entry.title.includes("Genetics"),
    )!;
    const node = adoption.mappings.find(
      (mapping) => mapping.entryId === entry.id,
    )!.curriculumNodeId;
    const chat = ctx.subjects.conversationCreate({
      subjectId: ctx.subject.id,
      title: "Chapter 2",
      mode: "Learn",
      curriculumNodeId: node,
    });
    const context = ctx.service.context({
      subjectId: ctx.subject.id,
      conversationId: chat.id,
      query: "continue",
    });
    expect(context.currentEntry?.id).toBe(entry.id);
    expect(context.excerpts.length).toBeGreaterThan(0);
    expect(
      context.excerpts.every(
        (excerpt) => excerpt.page !== undefined && excerpt.page >= 3,
      ),
    ).toBe(true);
    expect(context.excerpts.map((excerpt) => excerpt.text).join(" ")).toContain(
      "DNA stores genetic information",
    );
    expect(
      context.excerpts.some(
        (excerpt) => excerpt.citation === `${document.title}, PDF page 3`,
      ),
    ).toBe(true);
    expect(
      context.entries.find((item) => item.id === entry.id)?.curriculumNodeId,
    ).toBe(node);
    expect(context.sources[0].revision).toBe(source.revision);
  });
  it("uses section citations for unpaged text and does not expose unrelated book chapters", () => {
    const ctx = setup(),
      { source } = book(ctx);
    const adoption = ctx.service.adopt({
      subjectId: ctx.subject.id,
      sourceId: source.id,
    });
    const entry = source.entries.find((entry) =>
      entry.title.includes("Genetics"),
    )!;
    const node = adoption.mappings.find(
      (mapping) => mapping.entryId === entry.id,
    )!.curriculumNodeId;
    const context = ctx.service.context({
      subjectId: ctx.subject.id,
      curriculumNodeId: node,
      query: "continue",
    });
    expect(
      context.excerpts.every((excerpt) => excerpt.page === undefined),
    ).toBe(true);
    expect(
      context.excerpts.map((excerpt) => excerpt.text).join(" "),
    ).not.toContain("Ecosystems");
    expect(context.excerpts[0].citation).toContain(entry.title);
    expect(context.guidance).toMatch(/untrusted reference data/);
  });
  it("bounds thousands of outline entries and textbook excerpts by actual encoded tokens", () => {
    const ctx = setup();
    const text = Array.from(
      { length: 1100 },
      (_, i) =>
        `Chapter ${i + 1}: Topic ${i + 1}\nActual source section ${i + 1}. ` +
        "Explanation with terms and arguments. ".repeat(10),
    ).join("\n");
    const document = addDocument(ctx, { content: text }),
      preview = ctx.service.prepare({
        subjectId: ctx.subject.id,
        kind: "textbook",
        resourceId: document.id,
      });
    expect(preview.entries).toHaveLength(1100);
    savePreview(ctx, preview);
    for (const budget of [200, 600, 2400, 3000]) {
      const context = ctx.service.context({
        subjectId: ctx.subject.id,
        query: "continue",
        budget,
        purpose: budget === 3000 ? "planning" : "teaching",
      });
      expect(encode(JSON.stringify(context)).length).toBeLessThanOrEqual(
        budget,
      );
      expect(context.usage.estimatedTokens).toBe(
        encode(JSON.stringify(context)).length,
      );
      expect(context.usage.fullSourceIncluded).toBe(false);
      expect(context.usage.truncated).toBe(true);
      expect(context.entries.length).toBeLessThanOrEqual(80);
    }
  });
  it("does not quote stale chapter anchors after the underlying source changes", () => {
    const ctx = setup(),
      { source, document } = book(ctx),
      previous = ctx.service.context({
        subjectId: ctx.subject.id,
        query: "continue",
      });
    const data = ctx.store.load();
    ctx.store.save({
      ...data,
      library: data.library.map((item) =>
        item.id === document.id
          ? {
              ...item,
              content: "A replacement document without the original chapters.",
            }
          : item,
      ),
    });
    const context = ctx.service.context({
      subjectId: ctx.subject.id,
      query: "continue",
    });
    expect(context.excerpts).toEqual([]);
    expect(context.entries).toEqual([]);
    expect(context.currentEntry).toBeUndefined();
    expect(context.warnings.join(" ")).toMatch(/document changed/);
    expect(context.sources[0].fingerprint).not.toBe(
      previous.sources[0].fingerprint,
    );
    expect(() =>
      ctx.service.save({
        ...source,
        sourceId: source.id,
        expectedRevision: source.revision,
      }),
    ).toThrow(/heading is no longer present/);
  });
});

describe("existing backup, subject archive and revision compatibility", () => {
  it("can roll back an edited source outline using existing subject revision history", () => {
    const ctx = setup(),
      { source } = book(ctx),
      title = source.entries[0].title;
    ctx.service.save({
      ...source,
      sourceId: source.id,
      expectedRevision: source.revision,
      entries: source.entries.map((entry, index) =>
        index === 0 ? { ...entry, title: "A reversible chapter edit" } : entry,
      ),
    });
    const revision = ctx.subjects.snapshot(ctx.subject.id).revisions[0];
    ctx.subjects.rollback({
      subjectId: ctx.subject.id,
      revisionId: revision.id,
      expectedRevision: ctx.subjects.snapshot(ctx.subject.id).subject.revision,
    });
    expect(ctx.service.list(ctx.subject.id)[0].entries[0].title).toBe(title);
    expect(ctx.service.list(ctx.subject.id)[0].revision).toBeGreaterThan(
      source.revision,
    );
  });
  it("preserves separate source rows, mappings, imported pages, old notes, settings and existing schema in SQLite backup/restore", async () => {
    const ctx = setup(),
      document = addDocument(ctx, {
        pages: [
          { page: 1, text: "Chapter 1: Cells\nActual cells." },
          { page: 2, text: "Chapter 2: Genetics\nActual inheritance." },
        ],
      }),
      schema = ctx.store.db.pragma("user_version", { simple: true });
    const source = savePreview(
      ctx,
      ctx.service.prepare({
        subjectId: ctx.subject.id,
        kind: "textbook",
        resourceId: document.id,
      }),
    );
    ctx.service.adopt({ subjectId: ctx.subject.id, sourceId: source.id });
    ctx.subjects.apply({
      subjectId: ctx.subject.id,
      baseRevision: ctx.subjects.snapshot(ctx.subject.id).subject.revision,
      label: "An ordinary note",
      origin: "learner",
      operations: [
        {
          entity: "record",
          op: "put",
          id: "normal-note",
          value: {
            recordType: "note",
            title: "Keep me",
            data: { text: "Existing user note" },
          },
        },
      ],
    });
    expect(ctx.service.list(ctx.subject.id)).toHaveLength(1);
    const path = mkdtempSync(join(tmpdir(), "studio-source-test-"));
    temporary.push(path);
    const backup = join(path, "backup.sqlite");
    await ctx.store.backup(backup);
    const restored = new StudioStore(":memory:");
    stores.push(restored);
    restored.restoreBackup(backup);
    const restoredSubjects = new SubjectStore(restored),
      restoredService = new StudySourceService(restored, restoredSubjects);
    expect(restoredService.list(ctx.subject.id)).toEqual(
      ctx.service.list(ctx.subject.id),
    );
    expect(
      restored.load().library.find((item) => item.id === document.id)?.pages,
    ).toEqual(document.pages);
    expect(
      restoredSubjects
        .snapshot(ctx.subject.id, true)
        .records.some((record) => record.id === "normal-note"),
    ).toBe(true);
    expect(restored.db.pragma("user_version", { simple: true })).toBe(schema);
    const archive = ctx.subjects.exportArchive(ctx.subject.id),
      imported = new StudioStore(":memory:");
    stores.push(imported);
    const importedSubjects = new SubjectStore(imported);
    importedSubjects.restore({ archive });
    expect(
      new StudySourceService(imported, importedSubjects).list(ctx.subject.id),
    ).toEqual(ctx.service.list(ctx.subject.id));
  });
});
