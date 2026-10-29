import type { Lesson, LearningGoal } from "../types";

/** Question/feedback turns cannot move the saved curriculum cursor. Continuing is explicit. */
export function acceptedLessonPosition(
  lesson: Lesson,
  request: string,
  proposal: { position: string; goals: LearningGoal[] } | null,
) {
  if (!proposal) return null;
  if (/\b(?:unrelated|off-topic|tangent|side question)\b/i.test(request))
    return null;
  const firstExplanation = !lesson.messages.some(
    (message) => message.role === "assistant" && message.status !== "failed",
  );
  const advancing = /^\s*(?:continue|resume|next\b|begin\b|start\b)/i.test(
    request,
  );
  return firstExplanation || advancing ? proposal : null;
}
