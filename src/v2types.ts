import type {
  ContentBlock,
  KnowledgeStatus,
  LibraryItem,
  Lesson,
} from "./types";
export type SubjectDepth = "overview" | "comprehensive" | "advanced";
export type CurriculumStatus =
  | "not-started"
  | "introduced"
  | "covered"
  | "partial"
  | "demonstrated"
  | "review"
  | "gap";
export type Subject = {
  id: string;
  name: string;
  objective: string;
  depth: SubjectDepth;
  archived: boolean;
  currentNodeId?: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
};
export type CurriculumNode = {
  id: string;
  subjectId: string;
  parentId?: string;
  kind: "module" | "topic" | "lesson" | "concept";
  title: string;
  description: string;
  position: number;
  status: CurriculumStatus;
  skipped?: boolean;
  conceptId?: string;
  userEdited: boolean;
  revision: number;
  sourceMessageId?: string;
  createdAt: string;
  updatedAt: string;
};
export type CurriculumEdge = {
  id: string;
  subjectId: string;
  nodeId: string;
  prerequisiteId: string;
};
export type ConversationMeta = {
  id: string;
  subjectId: string;
  curriculumNodeId?: string;
  parentConversationId?: string;
  branchMessageId?: string;
  title: string;
  archived: boolean;
  resumeSummary?: string;
  createdAt: string;
  updatedAt: string;
};
export type SubjectConcept = {
  id: string;
  subjectId: string;
  label: string;
  status: KnowledgeStatus;
  coverage: "not-started" | "introduced" | "covered";
  evidence: string;
  revision: number;
  lessonId?: string;
  createdAt: string;
  updatedAt: string;
};
export type LearningEvidence = {
  id: string;
  subjectId: string;
  conceptId: string;
  kind: "learner-statement" | "assessment" | "manual" | "review";
  content: string;
  conversationId?: string;
  messageId?: string;
  reviewAttemptId?: string;
  createdAt: string;
};
export type SubjectMemory = {
  id: string;
  subjectId: string;
  kind:
    | "objective"
    | "position"
    | "finding"
    | "explanation"
    | "question"
    | "misconception"
    | "coverage"
    | "summary";
  title: string;
  content: string;
  conceptIds: string[];
  conversationId?: string;
  messageId?: string;
  resourceId?: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
};
export type SubjectOperation = {
  entity:
    | "subject"
    | "curriculum"
    | "edge"
    | "concept"
    | "evidence"
    | "memory"
    | "summary"
    | "record";
  op: "put" | "delete";
  id: string;
  value?: Record<string, unknown>;
};
export type SubjectRevision = {
  id: string;
  subjectId: string;
  baseRevision: number;
  revision?: number;
  label: string;
  origin: "ai" | "learner" | "migration";
  status: "proposed" | "applied" | "rolled-back" | "rejected";
  operations: SubjectOperation[];
  sourceConversationId?: string;
  sourceMessageId?: string;
  createdAt: string;
};
export type SubjectRecordType =
  "visual" | "chapter" | "canvas" | "note" | "finding" | "asset";
export type SubjectRecord<T = unknown> = {
  id: string;
  subjectId: string;
  recordType: SubjectRecordType;
  title: string;
  data: T;
  revision: number;
  createdAt: string;
  updatedAt: string;
};
export type SubjectSnapshot = {
  subject: Subject;
  conversations: ConversationMeta[];
  curriculum: CurriculumNode[];
  edges: CurriculumEdge[];
  concepts: SubjectConcept[];
  evidence: LearningEvidence[];
  memory: SubjectMemory[];
  records: SubjectRecord[];
  revisions: SubjectRevision[];
};
export type SubjectSearchResult = {
  id: string;
  subjectId: string;
  kind:
    | "highlight"
    | "conversation"
    | "message"
    | "concept"
    | "curriculum"
    | "note"
    | "chapter"
    | "equation"
    | "figure"
    | "document"
    | "reference"
    | "visual";
  title: string;
  preview: string;
  conversationId?: string;
  messageId?: string;
  resourceId?: string;
  recordId?: string;
  nodeId?: string;
};
export type SubjectContext = {
  schema: string;
  subject: { id: string; name: string; objective: string; depth: SubjectDepth };
  position?: unknown;
  concepts: unknown[];
  prerequisites: unknown[];
  findings: unknown[];
  questions: unknown[];
  messages: unknown[];
  summaries: unknown[];
  evidence: unknown[];
  usage: {
    estimatedTokens: number;
    budget: number;
    recordCount: number;
    fullHistoryIncluded: false;
    tokenizer?: string;
    overheadTokens?: number;
    encodedTokens?: number;
  };
  [key: string]: unknown;
};
export type VisualizationPlacement =
  "auto" | "inline" | "side" | "split" | "fullscreen" | "collapsed";
export type VisualInstance = {
  id: string;
  subjectId: string;
  block: ContentBlock;
  state: Record<string, unknown>;
  placement: VisualizationPlacement;
  originMessageId?: string;
  tags: string[];
  annotations: { id: string; text: string; createdAt: string }[];
  createdAt: string;
  updatedAt: string;
  title?: string;
  revision?: number;
};
export type TextbookChapter = {
  id: string;
  subjectId: string;
  title: string;
  markdown: string;
  blocks: ContentBlock[];
  citations: {
    label: string;
    url?: string;
    documentId?: string;
    page?: number;
  }[];
  originMessageIds: string[];
  revision: number;
  updatedAt: string;
  createdAt: string;
  position?: number;
  userEdited?: boolean;
  curriculumNodeId?: string;
};
export type ChapterProposal = {
  chapter: TextbookChapter;
  baseRevision: number;
  reason: string;
};
export type ExportSelection = {
  title: string;
  subjectId?: string;
  scope?: "selection" | "subject";
  lessonIds: string[];
  messageIds?: string[];
  chapterIds: string[];
  resourceIds?: string[];
  visualIds?: string[];
  includeNotes: boolean;
  includeUserMessages: boolean;
  embedCachedResources: boolean;
};
export type OfflineExportPayload = {
  title: string;
  subject?: Subject;
  lessons: Lesson[];
  chapters: TextbookChapter[];
  resources: LibraryItem[];
  visuals: VisualInstance[];
  includeVisualNotebook?: boolean;
  notebookVisualIds?: string[];
  curriculum?: CurriculumNode[];
  includeNotes: boolean;
  includeUserMessages: boolean;
  messageIds?: string[];
  exportedAt: string;
};
export type CanvasNode = {
  id: string;
  kind: "text" | "equation" | "visual" | "excerpt";
  x: number;
  y: number;
  width: number;
  height: number;
  text?: string;
  visualId?: string;
  block?: ContentBlock;
  source?: {
    documentId?: string;
    messageId?: string;
    page?: number;
    title?: string;
  };
};
export type LearningCanvasData = {
  nodes: CanvasNode[];
  edges: { id: string; source: string; target: string; label?: string }[];
  viewport: { x: number; y: number; zoom: number };
  annotations: string[];
};
