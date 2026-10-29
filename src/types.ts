import type { TeachingPreferences } from "./v21types";
import type {
  GeneExpressionConfig,
  OptimizationConfig,
  ExperimentSpec,
} from "./explainerTypes";
export type Mode = "Learn" | "Explore" | "Deep Dive" | "Practice" | "Review";
export type KnowledgeStatus =
  | "encountered"
  | "unassessed"
  | "partial"
  | "demonstrated"
  | "misconception"
  | "review"
  | "unresolved";
export type DiagramSpec = {
  title: string;
  nodes: { id: string; label: string; detail?: string }[];
  edges: { from: string; to: string; label?: string }[];
};
export type PlotSpec = {
  kind:
    | "wave"
    | "derivative"
    | "gaussian"
    | "logistic"
    | "oscillator"
    | "function"
    | "parametric"
    | "surface"
    | "vector"
    | "ode";
  title: string;
  xLabel?: string;
  yLabel?: string;
  zLabel?: string;
  parameters?: Record<string, number>;
  expressions?: string[];
  domain?: [number, number];
  yDomain?: [number, number];
  parameterRanges?: Record<string, { min: number; max: number; step: number }>;
  showDerivative?: boolean;
  ode?: {
    variables: string[];
    derivatives: string[];
    initial: number[];
    duration: number;
    step: number;
  };
};
/** Authored scientific relationships rendered by trusted, reusable SVG templates. */
export type IllustrationSpec = {
  template:
    | "translation"
    | "membrane-transport"
    | "reaction-energy"
    | "process"
    | "scene"
    | "field-explorer"
    | "protein-aggregation"
    | "interaction-vertices"
    | "gene-expression-lab"
    | "optimization-lab"
    | "experiment";
  gene?: GeneExpressionConfig;
  optimization?: OptimizationConfig;
  experiment?: ExperimentSpec;
  title: string;
  caption?: string;
  stages?: { id: string; label: string; description?: string }[];
  reaction?: {
    activationEnergy: number;
    freeEnergyChange: number;
    unit: string;
  };
  interaction?: {
    theory?: "qed" | "qcd";
    vertex?: "matter" | "three-boson" | "four-boson";
  };
  field?: {
    mode?: "wave" | "packet";
    amplitude?: number;
    wavelength?: number;
    width?: number;
    speed?: number;
  };
  aggregation?: {
    concentration?: number;
    unfoldedFraction?: number;
    attraction?: number;
    partition?: number;
    condensate?: boolean;
  };
  scene?: {
    participants: {
      id: string;
      label: string;
      shape:
        | "cell"
        | "complex"
        | "rna"
        | "dna"
        | "protein"
        | "unfolded-protein"
        | "aggregate"
        | "field"
        | "photon"
        | "fermion"
        | "gluon"
        | "particle"
        | "compartment"
        | "source"
        | "barrier";
      description?: string;
    }[];
    relations: {
      from: string;
      to: string;
      label: string;
      kind: "movement" | "binding" | "conversion" | "regulation";
    }[];
    steps?: {
      id: string;
      label: string;
      description: string;
      activeIds: string[];
    }[];
  };
};
export type MCQBlock = {
  type: "mcq";
  purpose?: "checkpoint" | "baseline";
  id?: string;
  question: string;
  choices: { id: string; text: string; explanation?: string }[];
  correctChoiceIds: string[];
  multiple?: boolean;
  allowUnknown?: boolean;
  explanation?: string;
  conceptIds?: string[];
  curriculumNodeId?: string;
};
export type ContentBlock =
  | { type: "text"; text: string }
  | {
      type: "concept";
      title: string;
      prerequisites?: string[];
      objective?: string;
    }
  | { type: "terms"; items: { term: string; definition: string }[] }
  | { type: "illustration"; spec: IllustrationSpec }
  | MCQBlock
  | { type: "equation"; latex: string }
  | { type: "diagram"; spec: DiagramSpec }
  | { type: "knowledge-graph"; spec: DiagramSpec }
  | { type: "plot"; spec: PlotSpec }
  | {
      type: "molecule";
      id: string;
      source: "pdb" | "pubchem";
      caption?: string;
    }
  | { type: "image"; query: string; retrievalRequested?: boolean }
  | {
      type: "chemical";
      input: string;
      format: "smiles" | "mol" | "sdf";
      caption?: string;
    }
  | {
      type: "exercise";
      question: string;
      hint?: string;
      answer?: string;
      grading?: GradingSpec;
    };
export type Message = {
  id: string;
  role: "user" | "assistant";
  text: string;
  blocks?: ContentBlock[];
  /** Ordered text/figure/check stream. Legacy text + blocks remain readable. */
  content?: ContentBlock[];
  createdAt: string;
  status?: "complete" | "partial" | "failed";
  visualInstanceIds?: string[];
  error?: string;
  sources?: {
    documentId: string;
    title: string;
    page?: number;
    citation: string;
    text: string;
  }[];
};
export type LearningGoal = {
  id: string;
  title: string;
  status: "planned" | "current" | "visited";
  prerequisites: string[];
};
export type Lesson = {
  id: string;
  title: string;
  subject: string;
  subjectId?: string;
  curriculumNodeId?: string;
  parentConversationId?: string;
  branchMessageId?: string;
  mode: Mode;
  objective: string;
  position: string;
  messages: Message[];
  notes: string;
  createdAt: string;
  updatedAt: string;
  example?: boolean;
  readingProgress?: number;
  studyView?: { mode: "lesson" | "history"; messageId?: string };
  goals?: LearningGoal[];
  exerciseResponses?: Record<string, { answer: string; skipped: boolean }>;
};
export type Concept = {
  subjectRevision?: number;
  updatedAt?: string;
  id: string;
  label: string;
  subjectId?: string;
  status: KnowledgeStatus;
  evidence: string;
  lessonId?: string;
  notes?: string;
  position?: { x: number; y: number };
};
export type Relation = {
  id: string;
  source: string;
  target: string;
  kind:
    | "prerequisite"
    | "related"
    | "application"
    | "analogy"
    | "cross-disciplinary";
};
export type LibraryItem = {
  id: string;
  title: string;
  kind:
    | "note"
    | "document"
    | "reference"
    | "practice"
    | "course"
    | "topic"
    | "subject";
  subject: string;
  subjectId?: string;
  sourceAssetId?: string;
  content: string;
  createdAt: string;
  source?: string;
  parentId?: string;
  lessonIds?: string[];
  verified?: boolean;
  pages?: { page: number; text: string }[];
  figures?: { id: string; page: number; dataUrl: string; caption?: string }[];
  citations?: { text: string; doi?: string; url?: string }[];
  warnings?: string[];
};
export type TaskSettings = { model: string; reasoning: string };
export type StudioSettings = {
  teaching?: TeachingPreferences;
  personalization: boolean;
  profile: string;
  assessments: boolean;
  backgroundConsent: boolean;
  planUsageAcknowledged?: boolean;
  models: Record<"tutor" | "visual" | "review", TaskSettings>;
  planning?: TaskSettings;
  modelProfileId?: string;
  modelProfiles?: Record<
    string,
    {
      models: Record<"tutor" | "visual" | "review", TaskSettings>;
      planning?: TaskSettings;
    }
  >;
  leftWidth: number;
  rightWidth: number;
  labOpen: boolean;
  visualizationPlacement?: "auto" | "inline" | "side" | "split";
  subjectOrder?: string[];
  backgroundOnClose?: boolean;
  updates?: { feedUrl: string; autoCheck: boolean };
};
export type StudioData = {
  version: 1;
  lessons: Lesson[];
  concepts: Concept[];
  relations: Relation[];
  library: LibraryItem[];
  settings: StudioSettings;
  appearance: unknown;
  activeLessonId?: string;
  activeSubjectId?: string;
  reviewCards?: ReviewCard[];
  reviewHistory?: ReviewAttempt[];
  knowledgeSuggestions?: KnowledgeSuggestion[];
  graphHistory?: {
    past: { concepts: Concept[]; relations: Relation[] }[];
    future: { concepts: Concept[]; relations: Relation[] }[];
  };
  backgroundTasks?: BackgroundTask[];
};
export type ModelInfo = { id: string; name: string; reasoningLevels: string[] };
export type AuthStatus = {
  connected: boolean;
  connecting?: boolean;
  account?: string;
  error?: string;
  profileId?: string;
};
export type ImageResult = {
  searchQuery?: string;
  id: string;
  title: string;
  url: string;
  thumbnail: string;
  source: string;
  author: string;
  license: string;
  licenseUrl: string;
  caption: string;
  provider?: "wikimedia" | "openverse" | "pmc";
  cached?: boolean;
  cachedAt?: string;
  originalUrl?: string;
};
export type TutorRequestState = {
  requestId: string;
  phase:
    "queued" | "admitted" | "first-text" | "complete" | "failed" | "canceled";
  elapsedMs: number;
  queueMs?: number;
  firstTextMs?: number;
};
export type StudioBridge = {
  onRequestState?: (listener: (event: TutorRequestState) => void) => () => void;
  invoke: <T = unknown>(action: string, payload?: unknown) => Promise<T>;
  onStream: (
    listener: (event: { requestId: string; delta: string }) => void,
  ) => () => void;
  platform: string;
  onDataChanged?: (listener: () => void) => () => void;
  onCloseRequested?: (listener: () => Promise<void>) => () => void;
  importDroppedFiles?: (files: File[]) => Promise<unknown[]>;
};
export type GradingSpec =
  | { kind: "numeric"; expected: number; tolerance: number; unit?: string }
  | { kind: "symbolic"; expected: string; variables: string[] }
  | { kind: "exact"; accepted: string[]; caseSensitive?: boolean }
  | {
      kind: "rubric";
      criteria: { id: string; description: string; required: boolean }[];
      referenceAnswer?: string;
    };
export type ReviewCard = {
  id: string;
  subjectId?: string;
  collectionId?: string;
  conceptId?: string;
  lessonId?: string;
  question: string;
  answer: string;
  grading: GradingSpec;
  dueAt: string;
  intervalDays: number;
  repetitions: number;
  easeFactor: number;
  lapses: number;
  createdAt: string;
};
export type ReviewAttempt = {
  id: string;
  subjectId?: string;
  cardId: string;
  answer: string;
  grade: number;
  correct: boolean | null;
  feedback: string;
  method: "numeric" | "symbolic" | "exact" | "rubric";
  createdAt: string;
  rubricChecks?: Record<string, boolean>;
};
export type KnowledgeSuggestion = {
  id: string;
  subjectId?: string;
  lessonId?: string;
  conceptLabel: string;
  proposedStatus: KnowledgeStatus;
  evidence: string;
  reason: string;
  state: "pending" | "accepted" | "dismissed";
  createdAt: string;
};
export type BackgroundTask = {
  id: string;
  kind: "review" | "lesson" | "summary" | "research";
  prompt: string;
  lessonId?: string;
  model: string;
  reasoning?: string;
  nextRunAt: string;
  intervalMinutes?: number;
  enabled: boolean;
  status: "scheduled" | "running" | "complete" | "failed" | "cancelled";
  result?: string;
  error?: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
};
export type ReferenceResult = {
  id: string;
  title: string;
  url: string;
  provider: string;
  authors: string[];
  year?: number;
  doi?: string;
  pmid?: string;
  snippet: string;
  verified: boolean;
};
declare global {
  interface Window {
    studio?: StudioBridge;
    $3Dmol?: any;
    Plotly?: any;
  }
}
