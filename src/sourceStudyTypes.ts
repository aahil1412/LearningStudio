/** User-supplied curricula and books remain references, never learning evidence. */
export type StudySourceKind = "curriculum" | "textbook";
export type StudySourceEntry = {
  id: string;
  title: string;
  order: number;
  parentId?: string;
  level: number;
  kind: "part" | "chapter" | "module" | "week" | "topic" | "section";
  startPage?: number;
  endPage?: number;
  /** Exact original heading, even when the learner edits its displayed title. */
  sourceHeading?: string;
  startOffset?: number;
  endOffset?: number;
  selected: boolean;
};
export type StudySourceMapping = {
  id: string;
  sourceId: string;
  entryId: string;
  curriculumNodeId: string;
};
export type StudySource = {
  id: string;
  subjectId: string;
  kind: StudySourceKind;
  title: string;
  resourceId?: string;
  sourceUrl?: string;
  active: boolean;
  structure: "detected" | "manual";
  warnings: string[];
  entries: StudySourceEntry[];
  mappings: StudySourceMapping[];
  createdAt: string;
  updatedAt: string;
  revision: number;
  fingerprint?: string;
};
export type StudySourcePreview = StudySource & {
  /** Present only for a user-pasted source; saved once as a library document. */
  text?: string;
};
export type StudySourceSave = {
  subjectId: string;
  sourceId?: string;
  id?: string;
  kind: StudySourceKind;
  title: string;
  resourceId?: string;
  sourceUrl?: string;
  text?: string;
  structure?: "detected" | "manual";
  entries: StudySourceEntry[];
  active?: boolean;
  expectedRevision?: number;
  fingerprint?: string;
  warnings?: string[];
};
export type StudySourceContext = {
  schema: "study-source/v1";
  sources: {
    id: string;
    title: string;
    kind: StudySourceKind;
    resourceId?: string;
    sourceUrl?: string;
    revision: number;
    fingerprint: string;
  }[];
  currentEntry?: StudySourceEntry & {
    sourceId: string;
    sourceTitle: string;
    resourceId?: string;
    curriculumNodeId?: string;
  };
  /** Bounded neighboring outline entries, not a complete book or graph. */
  entries: (Pick<
    StudySourceEntry,
    "id" | "title" | "kind" | "order" | "parentId" | "startPage" | "endPage"
  > & { sourceId: string; curriculumNodeId?: string })[];
  excerpts: {
    documentId: string;
    title: string;
    page?: number;
    citation: string;
    text: string;
  }[];
  guidance: string;
  warnings: string[];
  usage: {
    estimatedTokens: number;
    budget: number;
    truncated: boolean;
    fullSourceIncluded: false;
  };
};
export type StudySourceAdoption = {
  source: StudySource;
  nodeIds: string[];
  mappings: StudySourceMapping[];
  preservedNodeIds: string[];
};

/** IPC contracts:
 * list({subjectId}) -> StudySource[]
 * prepare({subjectId,kind,resourceId?,title?,text?,sourceUrl?}) -> StudySourcePreview
 * save(StudySourceSave) -> StudySource
 * adopt({subjectId,sourceId,entryIds?}) -> StudySourceAdoption
 * context({subjectId,conversationId?,curriculumNodeId?,query?,budget?}) -> StudySourceContext
 * select({subjectId,sourceId}) -> StudySource
 * remove({subjectId,sourceId}) -> {removed:true} (curriculum and imported document retained)
 */
