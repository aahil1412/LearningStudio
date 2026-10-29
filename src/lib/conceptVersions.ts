import type { Concept } from "../types";

const semantics = (concept: Concept) =>
  JSON.stringify([
    concept.label,
    concept.status,
    concept.evidence,
    concept.notes || "",
    concept.lessonId || "",
  ]);

/** Advance only metadata from an accepted save, preserving edits made while it was in flight. */
export function mergeConceptVersions(
  current: Concept[],
  submitted: Concept[],
  canonical: Concept[],
) {
  const sent = new Map(submitted.map((concept) => [concept.id, concept]));
  const stored = new Map(canonical.map((concept) => [concept.id, concept]));
  let changed = false;
  const next = current.map((concept) => {
    const before = sent.get(concept.id),
      saved = stored.get(concept.id);
    if (
      !before ||
      !saved ||
      semantics(before) !== semantics(saved) ||
      (before.subjectId && before.subjectId !== saved.subjectId) ||
      (concept.subjectId &&
        concept.subjectId !== before.subjectId &&
        concept.subjectId !== saved.subjectId)
    )
      return concept;
    if (
      concept.subjectId === saved.subjectId &&
      concept.subjectRevision === saved.subjectRevision &&
      concept.updatedAt === saved.updatedAt
    )
      return concept;
    changed = true;
    return {
      ...concept,
      subjectId: saved.subjectId,
      subjectRevision: saved.subjectRevision,
      updatedAt: saved.updatedAt,
    };
  });
  return changed ? next : current;
}
