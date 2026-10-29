import type { ContentBlock, Lesson, Message } from "../types";

export type LearningStageId = "understand" | "explore" | "check";
export type LearningStage = {
  id: LearningStageId;
  label: string;
  /** Original indices, including -1 for legacy top-level message text. */
  blockIndices: number[];
  firstBlockIndex: number;
};
export type LearningUnit = {
  id: string;
  messageId: string;
  index: number;
  title: string;
  question?: string;
  questionMessageId?: string;
  status: "ready" | "partial" | "failed" | "pending";
  hasContent: boolean;
  inherited: boolean;
  /** The original message, never a copied or rewritten transcript. */
  message: Message;
  stages: LearningStage[];
};

function plainLabel(value: string) {
  return value
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/(^|\s)__([^_]+)__(?=\s|$)/g, "$1$2")
    .replace(/(^|\s)_([^_]+)_(?=\s|$)/g, "$1$2")
    .replace(/\s+/g, " ")
    .trim();
}

function titleLabel(value: string) {
  const plain = plainLabel(value);
  if (plain.length <= 110) return plain;
  const space = plain.lastIndexOf(" ", 110);
  return plain.slice(0, space >= 65 ? space : 110).trimEnd() + "…";
}

function hasMaterial(block: ContentBlock) {
  if (block.type === "text") return Boolean(block.text.trim());
  if (block.type === "terms") return block.items.length > 0;
  if (block.type === "equation") return Boolean(block.latex.trim());
  if (block.type === "concept")
    return Boolean(
      block.title.trim() ||
      block.objective?.trim() ||
      block.prerequisites?.length,
    );
  return true;
}

/** Ignore headings inside code fences, which are content rather than structure. */
function markdownHeading(value: string) {
  let fence: { mark: string; length: number } | undefined;
  for (const line of value.split(/\r?\n/)) {
    const marker = line.match(/^\s{0,3}(`{3,}|~{3,})/);
    if (marker) {
      if (!fence) fence = { mark: marker[1][0], length: marker[1].length };
      else if (marker[1][0] === fence.mark && marker[1].length >= fence.length)
        fence = undefined;
      continue;
    }
    if (fence) continue;
    const heading = line.match(/^\s{0,3}#{1,6}\s+(.+?)(?:\s+#+)?\s*$/);
    if (heading && plainLabel(heading[1])) return plainLabel(heading[1]);
  }
  return "";
}

function entries(message: Message): { block: ContentBlock; index: number }[] {
  if (message.content?.length)
    return message.content.map((block, index) => ({ block, index }));
  const blocks = (message.blocks || []).map((block, index) => ({
    block,
    index,
  }));
  if (
    message.text.trim() &&
    !blocks.some(
      ({ block }) =>
        block.type === "text" && block.text.trim() === message.text.trim(),
    )
  )
    blocks.unshift({ block: { type: "text", text: message.text }, index: -1 });
  return blocks;
}

const exploratory = new Set<ContentBlock["type"]>([
  "illustration",
  "plot",
  "diagram",
  "knowledge-graph",
  "molecule",
  "chemical",
  "image",
]);
const labels: Record<LearningStageId, string> = {
  understand: "Understand",
  explore: "Explore",
  check: "Optional check",
};

function stagesFor(items: ReturnType<typeof entries>) {
  const stages: LearningStage[] = [];
  for (const { block, index } of items) {
    const id: LearningStageId =
      block.type === "mcq" || block.type === "exercise"
        ? "check"
        : exploratory.has(block.type)
          ? "explore"
          : "understand";
    const existing = stages.find((stage) => stage.id === id);
    if (existing) existing.blockIndices.push(index);
    else
      stages.push({
        id,
        label: labels[id],
        blockIndices: [index],
        firstBlockIndex: index,
      });
  }
  return stages;
}

function contentTitle(items: ReturnType<typeof entries>) {
  for (const { block } of items)
    if (block.type === "concept" && plainLabel(block.title))
      return plainLabel(block.title);
  for (const { block } of items) {
    if (block.type !== "text") continue;
    const heading = markdownHeading(block.text);
    if (heading) return heading;
  }
  for (const { block } of items)
    if (
      (block.type === "illustration" ||
        block.type === "plot" ||
        block.type === "diagram" ||
        block.type === "knowledge-graph") &&
      plainLabel(block.spec.title)
    )
      return plainLabel(block.spec.title);
  return "";
}

/**
 * Derive navigation from saved material. This neither generates a curriculum nor
 * turns a message, a page visit, or an optional check into mastery evidence.
 */
export function buildLearningSequence(
  lesson: Lesson,
  ancestors: Message[] = [],
): LearningUnit[] {
  const messages: Message[] = [],
    positions = new Map<string, number>();
  const localIds = new Set(lesson.messages.map((message) => message.id));
  for (const message of [...ancestors, ...lesson.messages]) {
    const prior = positions.get(message.id);
    if (prior === undefined) {
      positions.set(message.id, messages.length);
      messages.push(message);
    } else messages[prior] = message;
  }
  const assistants = messages.filter((message) => message.role === "assistant");
  const units: LearningUnit[] = [];
  let question: Message | undefined;
  for (const message of messages) {
    if (message.role === "user") {
      question = message;
      continue;
    }
    const items = entries(message).filter(({ block }) => hasMaterial(block));
    const meaningfulQuestion =
      question?.text.trim() &&
      !/^\s*(?:continue|next|resume|go on|begin|start)(?:\s+please)?[.!?]*\s*$/i.test(
        question.text,
      );
    const latest = message.id === assistants.at(-1)?.id;
    const fallback = meaningfulQuestion
      ? plainLabel(question!.text)
      : latest && lesson.position.trim()
        ? plainLabel(lesson.position)
        : plainLabel(lesson.title) || `Section ${units.length + 1}`;
    const hasContent = items.length > 0;
    units.push({
      id: message.id,
      messageId: message.id,
      index: units.length,
      title: titleLabel(contentTitle(items) || fallback),
      question: question?.text.trim() || undefined,
      questionMessageId: question?.id,
      status:
        message.status === "failed"
          ? "failed"
          : !hasContent
            ? "pending"
            : message.status === "partial"
              ? "partial"
              : "ready",
      hasContent,
      inherited: !localIds.has(message.id),
      message,
      stages: stagesFor(items),
    });
  }
  return units;
}
