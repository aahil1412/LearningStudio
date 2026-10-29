import { describe, expect, it } from "vitest";
import type { StudySourceContext } from "../src/sourceStudyTypes";
import { sourceStudyInstructions } from "../src/lib/sourceTeaching";
import { makeExampleLesson, teachingInstructions } from "../src/lib/teaching";
import { defaultData } from "../src/lib/defaults";

const source: StudySourceContext = {
  schema: "study-source/v1",
  sources: [
    {
      id: "book",
      title: "Supplied physics book",
      kind: "textbook",
      resourceId: "document",
      revision: 2,
      fingerprint: "content-v2",
    },
  ],
  currentEntry: {
    id: "chapter-3",
    title: "Oscillations",
    order: 3,
    level: 1,
    kind: "chapter",
    selected: true,
    sourceId: "book",
    sourceTitle: "Supplied physics book",
    curriculumNodeId: "mapped-chapter-3",
    startPage: 37,
    endPage: 44,
  },
  entries: [
    {
      id: "chapter-3",
      sourceId: "book",
      kind: "chapter",
      title: "Oscillations",
      order: 3,
      startPage: 37,
      endPage: 44,
    },
  ],
  excerpts: [
    {
      documentId: "document",
      title: "Supplied physics book",
      page: 38,
      citation: "Supplied physics book, PDF page 38",
      text: "A restoring force acts toward the equilibrium position.",
    },
  ],
  guidance: "Follow the selected chapter.",
  warnings: [],
  usage: {
    estimatedTokens: 350,
    budget: 2400,
    truncated: false,
    fullSourceIncluded: false,
  },
};

describe("source-aligned teaching", () => {
  it("does not change ordinary teaching without a supplied source", () => {
    expect(sourceStudyInstructions(null)).toBe("");
    const prompt = teachingInstructions(
      makeExampleLesson(),
      defaultData().settings,
      [],
      { question: "continue" },
    );
    expect(prompt).not.toContain("SOURCE_STUDY_CONTEXT");
  });
  it("gives the tutor the actual current chapter and exact retrieved citations", () => {
    const prompt = teachingInstructions(
      makeExampleLesson(),
      defaultData().settings,
      [],
      { sourceStudy: source, question: "continue" },
    );
    expect(prompt).toContain('"curriculumNodeId":"mapped-chapter-3"');
    expect(prompt).toContain('"title":"Oscillations"');
    expect(prompt).toContain("Supplied physics book, PDF page 38");
    expect(prompt).toContain(
      "A restoring force acts toward the equilibrium position.",
    );
    expect(prompt).toContain("An unrelated question is a tangent");
    expect(prompt).toContain("Never silently advance to another chapter");
    expect(prompt).toContain(
      "label it as an additional explanation or original practice example",
    );
  });
  it("whitelists the compact study window instead of sending hidden source data", () => {
    const extra = {
      ...source,
      fullBook: "DO NOT SEND WHOLE BOOK",
      credentials: "DO NOT SEND SECRETS",
      sources: source.sources.map((item) => ({
        ...item,
        hiddenMemory: "DO NOT SEND MEMORY",
      })),
      entries: source.entries.map((entry) => ({
        ...entry,
        fullChapter: "DO NOT SEND CHAPTER",
      })),
    };
    const prompt = sourceStudyInstructions(extra);
    expect(prompt).not.toContain("DO NOT SEND");
    expect(prompt).toContain('"fullSourceIncluded":false');
  });
  it("handles missing evidence without inventing book contents or printed pages", () => {
    const prompt = sourceStudyInstructions({
      ...source,
      excerpts: [],
      warnings: ["The imported document changed. Review its outline."],
    });
    expect(prompt).toContain("the section's text is unavailable");
    expect(prompt).toContain("not an assumed printed page number");
    expect(prompt).toContain("Never invent page numbers");
    expect(prompt).toContain(
      "The imported document changed. Review its outline.",
    );
  });
});
