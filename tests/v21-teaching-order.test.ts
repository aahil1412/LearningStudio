import { describe, expect, it } from "vitest";
import { prepareTeachingContent } from "../src/lib/teachingController";
import { defaultTeachingPreferences } from "../src/v21types";
import type { ContentBlock, Lesson } from "../src/types";

const lesson: Lesson = { id: "test", title: "Gene to protein", subject: "Biology", objective: "Understand how gene information makes proteins", position: "Transcription and translation", mode: "Learn", messages: [], notes: "", createdAt: "2026-10-28T12:00:00Z", updatedAt: "2026-10-28T12:00:00Z" };
const terms = (items: string[]): ContentBlock => ({ type: "terms", items: items.map((term) => ({ term, definition: `A definition of ${term}.` })) });
const figure: ContentBlock = { type: "illustration", spec: { template: "translation", title: "Reading the message" } };

describe("staged biological explanations", () => {
  it("keeps transcription before the translation zoom-in and definitions near first use", () => {
    const content: ContentBlock[] = [
      { type: "concept", title: "Gene information", prerequisites: [], objective: "Follow the information" },
      terms(["DNA", "gene", "mRNA", "transcription"]),
      { type: "text", text: "First, transcription copies information from DNA into mRNA." },
      terms(["mRNA (messenger RNA)", "ribosome", "codon", "tRNA (transfer RNA)", "anticodon", "polypeptide"]),
      figure,
      { type: "text", text: "Next, translation reads that message." },
    ];
    const result = prepareTeachingContent({ text: "", blocks: [], content }, lesson, "How does a gene lead to a protein?", defaultTeachingPreferences);
    expect(result.findIndex((b) => b.type === "text")).toBeLessThan(result.findIndex((b) => b.type === "illustration"));
    expect(result[0].type).toBe("concept");
    const allTerms = result.flatMap((b) => b.type === "terms" ? b.items.map((item) => item.term) : []);
    expect(allTerms.filter((term) => /^mRNA/i.test(term))).toHaveLength(1);
    expect(allTerms.filter((term) => /^tRNA/i.test(term))).toHaveLength(1);
    expect(allTerms).toContain("DNA");
    expect(result.filter((b) => b.type === "terms").every((b) => b.items.length < 10)).toBe(true);
  });
  it("adds only missing illustration prerequisites and preserves unrelated terms beyond sixteen", () => {
    const unrelated = Array.from({ length: 20 }, (_, i) => `Earlier term ${i}`);
    const content: ContentBlock[] = [terms(unrelated.slice(0, 10)), { type: "text", text: "A useful prerequisite explanation." }, terms(unrelated.slice(10)), figure];
    const result = prepareTeachingContent({ text: "", blocks: [], content }, lesson, "Continue with biological translation", defaultTeachingPreferences);
    const allTerms = result.flatMap((b) => b.type === "terms" ? b.items.map((item) => item.term) : []);
    expect(allTerms).toEqual(expect.arrayContaining(unrelated));
    expect(allTerms).toEqual(expect.arrayContaining(["codon", "anticodon", "ribosome"]));
    const figureIndex = result.findIndex((b) => b.type === "illustration");
    expect(result[figureIndex - 1].type).toBe("terms");
    expect(result.filter((b) => b.type === "terms")).toHaveLength(3);
  });
});
