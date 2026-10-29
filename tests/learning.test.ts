import { describe, expect, it } from "vitest";
import {
  confirmKnowledgeSuggestion,
  gradeAnswer,
  libraryHierarchyProblems,
  libraryPath,
  parseLearningSuggestions,
  reparentLibraryItem,
  removeLibraryItem,
  removeLessonReferences,
  reviewCardFromExercise,
  scheduleReview,
  suggestionEvidenceMatches,
} from "../src/lib/learning";
import type { Concept, LibraryItem, ReviewCard } from "../src/types";
import { defaultData } from "../src/lib/defaults";

const item = (
  id: string,
  kind: LibraryItem["kind"],
  parentId?: string,
): LibraryItem => ({
  id,
  title: id,
  kind,
  parentId,
  subject: "",
  content: "",
  createdAt: "2026-10-28T12:00:00.000Z",
});
const card = (): ReviewCard => ({
  id: "card",
  question: "What is six divided by two?",
  answer: "3",
  grading: { kind: "numeric", expected: 3, tolerance: 0.001 },
  dueAt: "2026-10-28T12:00:00.000Z",
  intervalDays: 0,
  repetitions: 0,
  easeFactor: 2.5,
  lapses: 0,
  createdAt: "2026-10-28T12:00:00.000Z",
});

describe("library hierarchy invariants", () => {
  it("supports subject/course/topic/resource paths and rejects cycles and invalid parent types", () => {
    const items = [
      item("Science", "subject"),
      item("Mechanics", "course", "Science"),
      item("Motion", "topic", "Mechanics"),
      item("Notes", "note", "Motion"),
    ];
    expect(libraryHierarchyProblems(items)).toEqual([]);
    expect(libraryPath(items, "Notes").map((i) => i.id)).toEqual([
      "Science",
      "Mechanics",
      "Motion",
      "Notes",
    ]);
    expect(() => reparentLibraryItem(items, "Motion", "Notes")).toThrow(
      "cannot contain",
    );
    expect(() =>
      reparentLibraryItem(
        [...items, item("Nested", "topic", "Motion")],
        "Motion",
        "Nested",
      ),
    ).toThrow("cycle");
    expect(() => reparentLibraryItem(items, "Mechanics", "Motion")).toThrow(
      "course belongs",
    );
    expect(() => reparentLibraryItem(items, "Science", "Motion")).toThrow(
      "Subjects",
    );
  });
  it("retains child content on deletion and validates linked lesson provenance", () => {
    const items = [
      item("Science", "subject"),
      item("Course", "course", "Science"),
      { ...item("Topic", "topic", "Course"), lessonIds: ["lesson"] },
    ];
    const remaining = removeLibraryItem(items, "Course");
    expect(remaining.find((i) => i.id === "Topic")?.parentId).toBe("Science");
    expect(libraryHierarchyProblems(remaining, new Set(["lesson"]))).toEqual(
      [],
    );
    expect(libraryHierarchyProblems(items, new Set())).toContain(
      "Missing linked lesson in Topic",
    );
  });
  it("reparents a subtree and recalculates the subject without losing resource text", () => {
    const items = [
      item("Mathematics", "subject"),
      item("Physics", "subject"),
      item("Modeling", "course", "Mathematics"),
      { ...item("Notes", "note", "Modeling"), content: "Keep this evidence." },
    ];
    const moved = reparentLibraryItem(items, "Modeling", "Physics");
    expect(moved.find((i) => i.id === "Notes")).toMatchObject({
      subject: "Physics",
      content: "Keep this evidence.",
    });
  });
  it("removes a lesson while preserving notes, review attempts, and graph history without dangling source links", () => {
    const data = defaultData();
    data.lessons = [
      {
        id: "lesson",
        title: "Source",
        subject: "Any",
        mode: "Learn",
        objective: "A goal",
        position: "Here",
        messages: [],
        notes: "",
        createdAt: "2026-10-28",
        updatedAt: "2026-10-28",
      },
    ];
    data.activeLessonId = "lesson";
    data.library = [{ ...item("notes", "note"), lessonIds: ["lesson"] }];
    data.concepts = [
      {
        id: "concept",
        label: "Concept",
        status: "partial",
        evidence: "Keep this evidence.",
        lessonId: "lesson",
      },
    ];
    data.reviewCards = [{ ...card(), lessonId: "lesson" }];
    data.knowledgeSuggestions = [
      {
        id: "suggestion",
        lessonId: "lesson",
        conceptLabel: "Concept",
        proposedStatus: "partial",
        evidence: "Evidence",
        reason: "Reason",
        state: "pending",
        createdAt: "2026-10-28",
      },
    ];
    data.graphHistory = {
      past: [{ concepts: data.concepts, relations: [] }],
      future: [],
    };
    const removed = removeLessonReferences(data, "lesson");
    expect(removed.lessons).toEqual([]);
    expect(removed.activeLessonId).toBeUndefined();
    expect(removed.library[0].lessonIds).toEqual([]);
    expect(removed.concepts[0]).toMatchObject({
      evidence: "Keep this evidence.",
      lessonId: undefined,
    });
    expect(removed.reviewCards?.[0].lessonId).toBeUndefined();
    expect(removed.knowledgeSuggestions?.[0].lessonId).toBeUndefined();
    expect(removed.graphHistory?.past[0].concepts[0].lessonId).toBeUndefined();
    expect(data.lessons).toHaveLength(1);
  });
});
describe("transparent spaced repetition", () => {
  it("saves generated exercises as reusable cards without inventing grading or reference answers", () => {
    const record = reviewCardFromExercise(
      {
        type: "exercise",
        question: "Compute 2+2.",
        answer: "4",
        grading: { kind: "numeric", expected: 4, tolerance: 0 },
      },
      "lesson",
      "collection",
      new Date("2026-10-28T00:00:00Z"),
    );
    expect(record).toMatchObject({
      lessonId: "lesson",
      collectionId: "collection",
      grading: { kind: "numeric", expected: 4, tolerance: 0 },
      intervalDays: 0,
    });
    const rubric = reviewCardFromExercise({
      type: "exercise",
      question: "Explain a historical cause.",
      answer: "A supported explanation.",
    });
    expect(rubric.grading.kind).toBe("rubric");
    expect(() =>
      reviewCardFromExercise({
        type: "exercise",
        question: "A question without a reference.",
      }),
    ).toThrow("reference answer");
  });
  it("uses SM-2 first/second intervals, multiplicative recall, and lapse reset without mutating the source", () => {
    const now = new Date("2026-10-28T12:00:00.000Z"),
      first = scheduleReview(card(), 4, now),
      second = scheduleReview(first, 4, now),
      third = scheduleReview(second, 5, now),
      lapse = scheduleReview(third, 1, now);
    expect([
      first.intervalDays,
      second.intervalDays,
      third.intervalDays,
    ]).toEqual([1, 6, 15]);
    expect(first.dueAt).toBe("2026-10-29T12:00:00.000Z");
    expect(third.easeFactor).toBe(2.6);
    expect(lapse).toMatchObject({ intervalDays: 1, repetitions: 0, lapses: 1 });
    expect(card().repetitions).toBe(0);
    expect(() => scheduleReview(card(), 6, now)).toThrow();
    expect(
      scheduleReview(
        { ...card(), repetitions: 2, intervalDays: 3, easeFactor: 1.5 },
        4,
        now,
      ).intervalDays,
    ).toBe(5);
  });
});
describe("actual answer grading", () => {
  it("calculates numeric expressions and respects absolute tolerance and stated units", () => {
    expect(
      gradeAnswer(
        { kind: "numeric", expected: 3, tolerance: 0.001, unit: "m" },
        "6/2 m",
      ).correct,
    ).toBe(true);
    expect(
      gradeAnswer({ kind: "numeric", expected: 3, tolerance: 0.001 }, "sqrt(9)")
        .correct,
    ).toBe(true);
    expect(
      gradeAnswer({ kind: "numeric", expected: 0.3, tolerance: 0 }, "0.1+0.2")
        .correct,
    ).toBe(true);
    expect(
      gradeAnswer({ kind: "numeric", expected: 3, tolerance: 0.001 }, "3.01")
        .correct,
    ).toBe(false);
    expect(
      gradeAnswer(
        { kind: "numeric", expected: 3, tolerance: 0.001, unit: "m" },
        "300 cm",
      ).correct,
    ).toBeNull();
    expect(
      gradeAnswer({ kind: "numeric", expected: 3, tolerance: 0.001 }, "1/0")
        .correct,
    ).toBeNull();
    expect(
      gradeAnswer(
        { kind: "numeric", expected: 3, tolerance: 0.001 },
        "globalThis.process.exit()",
      ).correct,
    ).toBeNull();
  });
  it("compares polynomial identities with exact rational coefficients, not numerical sampling", () => {
    const spec = {
      kind: "symbolic" as const,
      expected: "x^2+2*x+1",
      variables: ["x"],
    };
    expect(gradeAnswer(spec, "(x+1)^2").correct).toBe(true);
    expect(gradeAnswer(spec, "x^2+1").correct).toBe(false);
    expect(
      gradeAnswer(
        { kind: "symbolic", expected: "0.3*x", variables: ["x"] },
        "0.1*x+0.2*x",
      ).correct,
    ).toBe(true);
    expect(gradeAnswer(spec, "sin(x)").correct).toBeNull();
    expect(gradeAnswer(spec, "1/x").correct).toBeNull();
  });
  it("requires an actual accepted answer or an explicit assessment of every rubric criterion", () => {
    expect(
      gradeAnswer({ kind: "exact", accepted: ["mitosis"] }, "MITOSIS").correct,
    ).toBe(true);
    expect(
      gradeAnswer(
        { kind: "exact", accepted: ["mitosis"] },
        "the answer may mention mitosis",
      ).correct,
    ).toBe(false);
    const rubric = {
      kind: "rubric" as const,
      criteria: [
        { id: "reason", description: "Explain the reasoning", required: true },
        { id: "example", description: "Give an example", required: false },
      ],
    };
    expect(gradeAnswer(rubric, "A response", {}).correct).toBeNull();
    expect(
      gradeAnswer(rubric, "A response", { reason: true, example: false })
        .correct,
    ).toBe(true);
    expect(
      gradeAnswer(rubric, "A response", { reason: false, example: true })
        .correct,
    ).toBe(false);
    expect(gradeAnswer(rubric, "", {}).correct).toBeNull();
  });
});
describe("learner-confirmed knowledge suggestions", () => {
  it("accepts valid suggested evidence without changing knowledge until an explicit confirmation", () => {
    const raw = JSON.stringify({
      knowledgeSuggestions: [
        {
          conceptLabel: "Local rate",
          proposedStatus: "demonstrated",
          evidence: "The tangent slope is six.",
          reason: "The learner calculated the derivative correctly.",
        },
        {
          conceptLabel: "Unsupported",
          proposedStatus: "demonstrated",
          evidence: "",
          reason: "Mentioned.",
        },
      ],
    });
    const parsed = parseLearningSuggestions(raw, "lesson");
    expect(parsed).toHaveLength(1);
    expect(parsed[0].state).toBe("pending");
    expect(
      suggestionEvidenceMatches(parsed[0], [
        "The tangent slope is six. I used f′(3)=6.",
      ]),
    ).toBe(true);
    expect(
      suggestionEvidenceMatches(parsed[0], [
        "I recognize the word derivative.",
      ]),
    ).toBe(false);
    const before: Concept[] = [];
    const after = confirmKnowledgeSuggestion(before, parsed[0]);
    expect(before).toEqual([]);
    expect(after[0]).toMatchObject({
      label: "Local rate",
      status: "demonstrated",
      evidence: "The tangent slope is six.",
      lessonId: "lesson",
    });
    expect(() =>
      confirmKnowledgeSuggestion(after, { ...parsed[0], state: "accepted" }),
    ).toThrow("already");
    expect(parseLearningSuggestions("malformed", "lesson")).toEqual([]);
  });
});
