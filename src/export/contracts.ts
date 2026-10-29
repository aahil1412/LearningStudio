import type { ContentBlock, ImageResult } from "../types";
import type { ReadingHighlight } from "../annotationTypes";
import type { Appearance } from "../lib/themes";
export type ExportReadingSource = {
  kind: "message" | "chapter" | "document";
  id: string;
  conversationId?: string;
  page?: number;
};
export type ExportCitation = {
  label: string;
  url?: string;
  documentId?: string;
  page?: number;
};
export type ExportVisualState = {
  id: string;
  subjectId: string;
  state: Record<string, unknown>;
  annotations: { id: string; text: string; createdAt: string }[];
};
export type ExportChapter = {
  id: string;
  title: string;
  markdown: string;
  blocks: ContentBlock[];
  citations: ExportCitation[];
  originMessageIds: string[];
  notes?: string;
  visualStates?: Record<number, ExportVisualState>;
  source?: ExportReadingSource;
  blockSources?: Record<number, ExportReadingSource>;
  highlights?: ReadingHighlight[];
};
export type ExportStructure = {
  data: string;
  format: string;
  sourceUrl?: string;
  name?: string;
};
export type ExportChemicalSource = {
  input: string;
  format: "smiles" | "mol" | "sdf";
};
export type ExportChemical = {
  svg: string;
  smiles: string;
  atoms: number;
  version: string;
};
export type ExportAssets = {
  images: Record<string, ImageResult[]>;
  structures: Record<string, ExportStructure>;
  sources: Record<string, ExportStructure | ExportChemicalSource>;
  chemicals: Record<string, { light: ExportChemical; dark: ExportChemical }>;
};
export type OfflineBook = {
  version: 1;
  title: string;
  description: string;
  subjectName?: string;
  exportedAt: string;
  chapters: ExportChapter[];
  assets: ExportAssets;
  warnings: string[];
  curriculum: { title: string; description: string; status: string }[];
  appearance?: Pick<Appearance, "mode" | "light" | "dark">;
};
