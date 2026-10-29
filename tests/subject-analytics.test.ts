import { it, expect } from "vitest";
import { reviewWeeks } from "../src/components/v2/SubjectAnalytics";
import type { ReviewAttempt } from "../src/types";
it("weekly evidence history separates wrong, correct, uncertain and future/out-of-window results", () => {
  const rows = [
    ["2026-10-26T00:00:00Z", true],
    ["2026-10-28T12:00:00Z", false],
    ["2026-10-28T13:00:00Z", null],
    ["2026-01-01T00:00:00Z", true],
    ["2026-11-09T00:00:00Z", true],
  ].map(([createdAt, correct], index) => ({
    id: String(index),
    createdAt,
    correct,
  })) as ReviewAttempt[];
  const weeks = reviewWeeks(rows, Date.parse("2026-10-28T18:00:00Z"));
  expect(weeks).toHaveLength(8);
  expect(weeks.at(-1)).toEqual({
    date: "2026-10-26",
    correct: 1,
    incorrect: 1,
    uncertain: 1,
    total: 3,
  });
  expect(weeks.reduce((count, week) => count + week.total, 0)).toBe(3);
});
