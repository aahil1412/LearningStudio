export type HighlightColor = "yellow" | "green" | "blue" | "pink" | "purple";
export type ReadingHighlight = {
  id: string;
  subjectId: string;
  sourceKind: "message" | "chapter" | "document";
  sourceId: string;
  conversationId?: string;
  page?: number;
  quote: string;
  prefix: string;
  suffix: string;
  start?: number;
  end?: number;
  color: HighlightColor;
  note: string;
  tags: string[];
  anchorState: "anchored" | "orphaned";
  revision: number;
  createdAt: string;
  updatedAt: string;
};
export type HighlightDraft = Omit<
  ReadingHighlight,
  "id" | "revision" | "createdAt" | "updatedAt" | "anchorState"
>;
export type ConnectedGraphNode = {
  id: string;
  sourceId: string;
  subjectId?: string;
  kind: "concept" | "lesson" | "note";
  label: string;
  definition: string;
  evidence?: string;
  conversationId?: string;
  messageId?: string;
  subjectName?: string;
  updatedAt?: string;
  status?: string;
  derived?: boolean;
};
export type ConnectedGraphLink = {
  id: string;
  source: string;
  target: string;
  kind: string;
  state: "accepted" | "suggested" | "rejected";
  reason: string;
  sourceMessageId?: string;
  ownerSubjectId?: string;
  sourceReferences?: { conversationId: string; messageId: string }[];
};
export type ConnectedGraph = {
  nodes: ConnectedGraphNode[];
  links: ConnectedGraphLink[];
  positions: Record<string, { x: number; y: number; pinned: boolean }>;
  totalNodes: number;
  truncated: boolean;
  backlinks?: Record<
    string,
    { node: ConnectedGraphNode; link: ConnectedGraphLink }[]
  >;
  backlinkCounts?: Record<string, number>;
  availableNodes?: number;
  matchedNodes?: number;
  totalLinks?: number;
  appliedLimit?: number;
  keywords?: { keyword: string; count: number }[];
  relationTypes?: { kind: string; count: number }[];
  clusters?: { id: string; label: string; count: number }[];
};
