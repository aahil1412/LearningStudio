import { expect, it } from "vitest";
import { mergeConceptVersions } from "../src/lib/conceptVersions";
import type { Concept } from "../src/types";

it("rebases only accepted graph metadata while keeping in-flight edits and refusing conflicting evidence", () => {
  const submitted: Concept = {
    id: "c",
    label: "Energy",
    status: "partial",
    evidence: "Reasoning",
    subjectId: "s",
    subjectRevision: 1,
  };
  const canonical = { ...submitted, subjectRevision: 2, updatedAt: "saved" };
  const pending = {
    ...submitted,
    notes: "New local edit",
    position: { x: 90, y: 40 },
  };
  const merged = mergeConceptVersions([pending], [submitted], [canonical]);
  expect(merged[0]).toMatchObject({
    ...pending,
    subjectRevision: 2,
    updatedAt: "saved",
  });
  expect(mergeConceptVersions(merged, [merged[0]], [merged[0]])).toBe(merged);
  const current = [pending];
  expect(
    mergeConceptVersions(
      current,
      [submitted],
      [{ ...canonical, evidence: "Another writer's assessment" }],
    ),
  ).toBe(current);
  expect(
    mergeConceptVersions(
      [{ ...pending, subjectId: "other" }],
      [submitted],
      [canonical],
    )[0].subjectId,
  ).toBe("other");
});
