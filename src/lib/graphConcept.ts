import type { Concept, KnowledgeStatus, Lesson } from "../types";

/** Preserve canonical ownership/version metadata while changing editable fields. */
export function conceptFromEditor(input: {
  adding: boolean;
  id: string;
  selected?: Concept;
  label: string;
  status: KnowledgeStatus;
  evidence: string;
  notes: string;
  lessonId: string;
  defaultSubjectId?: string;
  lessons: Lesson[];
}): Concept {
  if (!input.adding && !input.selected)
    throw new Error("Choose an existing concept before editing it.");
  const sourceSubject = input.lessons.find(
    (lesson) => lesson.id === input.lessonId,
  )?.subjectId;
  const subjectId = input.adding
    ? sourceSubject || input.defaultSubjectId
    : input.selected?.subjectId;
  return {
    ...(!input.adding ? input.selected : {}),
    id: input.adding ? input.id : input.selected!.id,
    ...(subjectId ? { subjectId } : {}),
    label: input.label.trim(),
    status: input.status,
    evidence: input.evidence.trim(),
    notes: input.notes.trim(),
    lessonId: input.lessonId || undefined,
  };
}
