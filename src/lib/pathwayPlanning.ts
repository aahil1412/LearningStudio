import type { SubjectDepth } from "../v2types";

/** These limit one checkpoint, not the total size of a subject curriculum. */
export function planningBudget(depth: SubjectDepth) {
  return depth === "overview"
    ? {
        modules: [4, 6],
        topics: 2,
        concepts: [4, 6],
        maxNodes: 10,
        descriptionChars: 180,
      }
    : depth === "advanced"
      ? {
          modules: [8, 14],
          topics: 4,
          concepts: [12, 20],
          maxNodes: 28,
          descriptionChars: 320,
        }
      : {
          modules: [6, 10],
          topics: 3,
          concepts: [8, 12],
          maxNodes: 18,
          descriptionChars: 240,
        };
}

/** Curriculum previews describe a check, never expose an answer key. Legacy output is preserved in storage. */
export function curriculumPreviewDescription(description: string, title = "") {
  if (
    /\b(?:answer(?:\s+key)?|correct\s+(?:answer|option|choice))\s*(?::|=|is\b)/i.test(
      description,
    )
  )
    return /check|quiz|practice|assessment/i.test(title)
      ? "Optional concept check. Choose an answer during the lesson to receive feedback; skipping remains available."
      : "Study the central idea and its applications. Optional checks provide feedback after submission.";
  return description;
}
