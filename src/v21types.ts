import type { SubjectDepth } from "./v2types";

export type TeachingPreferences = {
  delivery: "visual-first" | "balanced" | "text-first";
  practice: "mcq" | "free-response" | "mixed";
  checkFrequency: "topic-end" | "occasionally" | "requested";
  sentenceStyle: "clean" | "conversational" | "academic";
  avoidEmDashes: boolean;
};
export const defaultTeachingPreferences: TeachingPreferences = {
  delivery: "balanced",
  practice: "mcq",
  checkFrequency: "topic-end",
  sentenceStyle: "clean",
  avoidEmDashes: true,
};
export type SubjectIntake = {
  subjectId: string;
  revision: number;
  status: "in-progress" | "ready" | "skipped";
  goal: string;
  motivation: string;
  familiarity: string;
  strengths: string;
  gaps: string;
  depth: SubjectDepth;
  preferences: TeachingPreferences;
  assessment: "skipped" | "requested" | "completed";
  assessmentNotes: string;
  createdAt: string;
  updatedAt: string;
};
export type PathwayOutlineModule = {
  id: string;
  title: string;
  description: string;
  priorities: string[];
  prerequisites: string[];
};
export type PathwayChunk = {
  id: string;
  parentId?: string;
  kind: "module" | "topic" | "lesson" | "concept";
  title: string;
  description: string;
  prerequisites: string[];
};
export type PathwayJob = {
  id: string;
  subjectId: string;
  status:
    | "running"
    | "awaiting-review"
    | "complete"
    | "failed"
    | "canceled"
    | "interrupted";
  stage:
    | "preparing-outline"
    | "waiting-for-model"
    | "constructing-module"
    | "validating-prerequisites"
    | "saving-proposal"
    | "awaiting-review"
    | "complete"
    | "failed"
    | "canceled"
    | "interrupted";
  model: string;
  reasoning?: string;
  /** No book text is copied into checkpoints. Source edits require a new job. */
  sourceBinding?: {
    sources: { id: string; revision: number; fingerprint: string }[];
    entryIds: string[];
  };
  completedModules: number;
  totalModules: number;
  outline: PathwayOutlineModule[];
  chunks: { moduleId: string; nodes: PathwayChunk[]; completedAt: string }[];
  requestState: "idle" | "possibly-admitted" | "completed";
  currentModuleId?: string;
  requestStartedAt?: string;
  requestDeadlineAt?: string;
  /** Main-process request liveness only; not evidence of remote model progress. */
  heartbeatAt?: string;
  cancelRequested: boolean;
  error?: string;
  retryCount: number;
  proposalId?: string;
  createdAt: string;
  updatedAt: string;
  startedAt: string;
  finishedAt?: string;
};
