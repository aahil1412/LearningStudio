import { expect, it } from "vitest";
import { acceptedLessonPosition } from "../src/lib/lessonPosition";
import type { Lesson } from "../src/types";
const lesson: Lesson = {
  id: "l",
  title: "A broad subject",
  subject: "Science",
  objective: "Understand science",
  mode: "Learn",
  position: "Conservation: assumptions",
  notes: "",
  createdAt: "now",
  updatedAt: "now",
  messages: [
    {
      id: "a",
      role: "assistant",
      text: "Core explanation",
      createdAt: "now",
      status: "complete",
    },
  ],
};
const proposal = { position: "A different topic", goals: [] };
it("preserves the exact core cursor when a question or feedback response proposes a different position", () => {
  expect(
    acceptedLessonPosition(lesson, "How does a telescope work?", proposal),
  ).toBeNull();
  expect(
    acceptedLessonPosition(lesson, "Explain more simply", proposal),
  ).toBeNull();
  expect(
    acceptedLessonPosition(
      lesson,
      "Unrelated side question: continue with history",
      proposal,
    ),
  ).toBeNull();
});
it("allows a first conceptual unit and an explicit return or next step", () => {
  expect(
    acceptedLessonPosition(
      { ...lesson, messages: [] },
      "Teach the first idea",
      proposal,
    ),
  ).toEqual(proposal);
  expect(acceptedLessonPosition(lesson, "Continue", proposal)).toEqual(
    proposal,
  );
  expect(
    acceptedLessonPosition(lesson, "Resume the learning objective", proposal),
  ).toEqual(proposal);
});
