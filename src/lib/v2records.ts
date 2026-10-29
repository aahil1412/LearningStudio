import type {
  SubjectRecord,
  TextbookChapter,
  VisualInstance,
  VisualizationPlacement,
} from "../v2types";
import type { ContentBlock } from "../types";
import { validateContentBlock } from "./visualSpecs";
const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const strings = (value: unknown) =>
  Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
export function chapterFromRecord(record: SubjectRecord): TextbookChapter {
  const value = object(record.data),
    blocks = Array.isArray(value.blocks)
      ? value.blocks
          .map(validateContentBlock)
          .filter((block): block is ContentBlock => !!block)
      : [];
  const citations: TextbookChapter["citations"] = Array.isArray(value.citations)
    ? value.citations.flatMap((raw) => {
        const entry = object(raw);
        if (typeof entry.label !== "string") return [];
        return [
          {
            label: entry.label,
            url: typeof entry.url === "string" ? entry.url : undefined,
            documentId:
              typeof entry.documentId === "string"
                ? entry.documentId
                : undefined,
            page:
              typeof entry.page === "number" && entry.page > 0
                ? entry.page
                : undefined,
          },
        ];
      })
    : [];
  return {
    id: record.id,
    subjectId: record.subjectId,
    title: typeof value.title === "string" ? value.title : record.title,
    markdown:
      typeof value.markdown === "string"
        ? value.markdown
        : "This saved chapter could not be decoded. Its original database record has been preserved; restore a previous revision before editing.",
    blocks,
    citations,
    originMessageIds: strings(value.originMessageIds),
    revision: record.revision,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    position: typeof value.position === "number" ? value.position : 0,
    userEdited: value.userEdited === true,
    curriculumNodeId:
      typeof value.curriculumNodeId === "string"
        ? value.curriculumNodeId
        : undefined,
  };
}
export function visualFromRecord(record: SubjectRecord): VisualInstance | null {
  const value = object(record.data),
    block = validateContentBlock(value.block);
  if (!block) return null;
  const placements: VisualizationPlacement[] = [
      "auto",
      "inline",
      "side",
      "split",
      "fullscreen",
      "collapsed",
    ],
    placement = placements.includes(value.placement as VisualizationPlacement)
      ? (value.placement as VisualizationPlacement)
      : "inline";
  const annotations: VisualInstance["annotations"] = Array.isArray(
    value.annotations,
  )
    ? value.annotations.flatMap((raw) => {
        const entry = object(raw);
        return typeof entry.id === "string" && typeof entry.text === "string"
          ? [
              {
                id: entry.id,
                text: entry.text,
                createdAt:
                  typeof entry.createdAt === "string"
                    ? entry.createdAt
                    : record.createdAt,
              },
            ]
          : [];
      })
    : [];
  return {
    id: record.id,
    subjectId: record.subjectId,
    block,
    state: object(value.state),
    placement,
    title: typeof value.title === "string" ? value.title : record.title,
    originMessageId:
      typeof value.originMessageId === "string"
        ? value.originMessageId
        : undefined,
    tags: strings(value.tags),
    annotations,
    revision: record.revision,
    createdAt: record.createdAt,
    updatedAt:
      typeof value.updatedAt === "string" ? value.updatedAt : record.updatedAt,
  };
}
