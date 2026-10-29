import { readFile, writeFile, rename, rm } from "node:fs/promises";
import { join, dirname, basename, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash, randomUUID } from "node:crypto";
import { deflateRawSync } from "node:zlib";
import type { OfflineExportPayload } from "../src/v2types";
import type { ContentBlock, ImageResult } from "../src/types";
import type {
  ExportAssets,
  ExportChapter,
  ExportStructure,
  ExportChemicalSource,
  ExportVisualState,
  OfflineBook,
} from "../src/export/contracts";
import {
  initialParameters,
  validateContentBlock,
} from "../src/lib/visualSpecs";
import { cachedImages, fetchStructure } from "./resources";
import { renderChemical } from "./chemistry";
import { chooseTeachingVisual } from "../src/lib/tutorSkills";
import { messageContent } from "../src/lib/messageContent";
import type { ReadingHighlight } from "../src/annotationTypes";
import type { ExportReadingSource } from "../src/export/contracts";
import { sanitizeAppearance } from "../src/lib/themes";
import {
  DEFAULT_CODING_DNA,
  geneTimeline,
  mutateDna,
  translateCodingDna,
  type GeneMutation,
} from "../src/lib/explainers/geneExpression";
import { landscapes, type Landscape } from "../src/lib/explainers/optimization";

export type ExportOptions = {
  highlights?: ReadingHighlight[];
  appearance?: unknown;
  runtimeDirectory?: string;
  assets?: Partial<ExportAssets>;
  assetRecords?: Record<string, { kind: string; value: unknown }>;
  embedResources?: boolean;
  offlineOnly?: boolean;
  zipThresholdBytes?: number;
};
const here =
  typeof __dirname === "string"
    ? __dirname
    : dirname(fileURLToPath(import.meta.url));
const emptyAssets = (): ExportAssets => ({
  images: {},
  structures: {},
  sources: {},
  chemicals: {},
});
const safeUrl = (value: unknown) => {
  try {
    const url = new URL(String(value));
    return url.protocol === "https:" && !url.username && !url.password
      ? url.href
      : undefined;
  } catch {
    return undefined;
  }
};
const dataImage = (value: unknown) =>
  typeof value === "string" &&
  /^data:image\/(?:png|jpeg|webp|gif);base64,[a-zA-Z0-9+/=]+$/.test(value) &&
  value.length < 24000000;
const escapeHtml = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ]!,
  );
const message = (error: unknown) =>
  error instanceof Error ? error.message : "The resource was unavailable.";
function blockList(values: unknown): ContentBlock[] {
  return Array.isArray(values)
    ? values
        .map(validateContentBlock)
        .filter((item): item is ContentBlock => item !== null)
    : [];
}
const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const numbers = (value: unknown, length?: number) =>
  Array.isArray(value) &&
  value.length < 100 &&
  (!length || value.length === length) &&
  value.every((item) => typeof item === "number" && Number.isFinite(item))
    ? value
    : undefined;
/** Renderer state is a data contract, not a bag of arbitrary persisted fields. */
export function exportVisualState(
  block: ContentBlock,
  input: unknown,
): Record<string, unknown> {
  block = chooseTeachingVisual(block);
  const raw = object(input),
    state: Record<string, unknown> = {};
  const numeric = (key: string) => {
    if (typeof raw[key] === "number" && Number.isFinite(raw[key]))
      state[key] = raw[key];
  };
  const boolean = (key: string) => {
    if (typeof raw[key] === "boolean") state[key] = raw[key];
  };
  const text = (key: string, max = 2000) => {
    if (typeof raw[key] === "string")
      state[key] = (raw[key] as string).slice(0, max);
  };
  const bounded = (key: string, min: number, max: number) => {
    if (
      typeof raw[key] === "number" &&
      Number.isFinite(raw[key]) &&
      (raw[key] as number) >= min &&
      (raw[key] as number) <= max
    )
      state[key] = raw[key];
  };
  const integer = (key: string, min: number, max: number) => {
    if (Number.isInteger(raw[key])) bounded(key, min, max);
  };
  const layout = (key: string) => {
    if (!Object.hasOwn(raw, key)) return;
    const value = object(raw[key]),
      result: Record<string, unknown> = {};
    for (const axis of ["xaxis", "yaxis", "zaxis"]) {
      const a = object(value[axis]),
        clean: Record<string, unknown> = {};
      if (numbers(a.range, 2)) clean.range = a.range;
      if (typeof a.autorange === "boolean") clean.autorange = a.autorange;
      if (Object.keys(clean).length) result[axis] = clean;
    }
    if (
      ["zoom", "pan", "select", "lasso", "orbit", "turntable", false].includes(
        value.dragmode as string | false,
      )
    )
      result.dragmode = value.dragmode;
    state[key] = result;
  };
  if (block.type === "plot") {
    const advanced = [
        "function",
        "parametric",
        "surface",
        "vector",
        "ode",
      ].includes(block.spec.kind),
      prefix = advanced ? "advanced" : "plot",
      parameters = object(raw[prefix + ".parameters"]);
    const allowed = advanced
      ? Object.keys(block.spec.parameters || {})
      : Object.keys(initialParameters(block.spec));
    if (Object.hasOwn(raw, prefix + ".parameters"))
      state[prefix + ".parameters"] = Object.fromEntries(
        allowed
          .filter(
            (key) =>
              typeof parameters[key] === "number" &&
              Number.isFinite(parameters[key]),
          )
          .map((key) => [key, parameters[key]]),
      );
    boolean(prefix + ".playing");
    numeric("advanced.timeIndex");
    layout(prefix + ".layout");
    const camera = object(raw["three.camera"]);
    if (
      numbers(camera.position, 3) &&
      numbers(camera.quaternion, 4) &&
      numbers(camera.target, 3) &&
      typeof camera.zoom === "number" &&
      Number.isFinite(camera.zoom)
    )
      state["three.camera"] = {
        position: camera.position,
        quaternion: camera.quaternion,
        target: camera.target,
        zoom: camera.zoom,
      };
  }
  if (block.type === "diagram" || block.type === "knowledge-graph") {
    numeric("diagram.zoom");
    const pan = object(raw["diagram.pan"]);
    if (
      typeof pan.x === "number" &&
      typeof pan.y === "number" &&
      Number.isFinite(pan.x) &&
      Number.isFinite(pan.y)
    )
      state["diagram.pan"] = { x: pan.x, y: pan.y };
    text("diagram.selected");
  }
  if (block.type === "illustration") {
    // Each explainer has its own closed contract. Never inherit another renderer's
    // keys, arbitrary nested records, or transient playback into a portable book.
    if (block.spec.template === "gene-expression-lab") {
      const validDna = (value: unknown): value is string =>
        typeof value === "string" && /^[ACGT]{3,180}$/.test(value);
      const reference = validDna(raw["gene.reference"])
        ? raw["gene.reference"]
        : validDna(block.spec.gene?.codingDna)
          ? block.spec.gene.codingDna
          : DEFAULT_CODING_DNA;
      if (validDna(raw["gene.reference"]))
        state["gene.reference"] = raw["gene.reference"];
      let current = reference;
      if (raw["gene.mutation"] === null) state["gene.mutation"] = null;
      else {
        const value = object(raw["gene.mutation"]);
        const mutation = {
          kind: value.kind,
          position: value.position,
          base: value.base,
        } as GeneMutation;
        try {
          current = mutateDna(reference, mutation);
          state["gene.mutation"] = {
            kind: mutation.kind,
            position: mutation.position,
            base: mutation.base,
          };
        } catch {
          /* An invalid edit cannot change the exported reference. */
        }
      }
      integer("gene.progress", 0, geneTimeline(translateCodingDna(current)));
      integer("gene.window", 0, current.length - 1);
      if (
        ["transcription", "translation", "mutation"].includes(
          raw["gene.view"] as string,
        )
      )
        text("gene.view", 13);
      boolean("gene.labels");
      if (
        [
          "dna",
          "template",
          "rna",
          "polymerase",
          "ribosome",
          "trna",
          "pairing",
          "peptide",
        ].includes(raw["gene.selected"] as string)
      )
        text("gene.selected", 10);
      return state;
    }
    if (block.spec.template === "optimization-lab") {
      const names: Landscape[] = ["quadratic", "ravine", "himmelblau"];
      const kind = names.includes(raw["optimization.landscape"] as Landscape)
        ? (raw["optimization.landscape"] as Landscape)
        : block.spec.optimization?.landscape || "quadratic";
      if (names.includes(raw["optimization.landscape"] as Landscape))
        text("optimization.landscape", 10);
      bounded("optimization.learningRate", 0.001, 1);
      integer("optimization.iterations", 1, 300);
      const iterations =
        typeof state["optimization.iterations"] === "number"
          ? state["optimization.iterations"]
          : block.spec.optimization?.iterations || 120;
      integer("optimization.step", 0, iterations);
      integer("optimization.stage", 0, 2);
      boolean("optimization.compare");
      boolean("optimization.show3d");
      const start = numbers(raw["optimization.start"], 2),
        meta = landscapes[kind];
      if (
        start &&
        start[0] >= meta.xDomain[0] &&
        start[0] <= meta.xDomain[1] &&
        start[1] >= meta.yDomain[0] &&
        start[1] <= meta.yDomain[1]
      )
        state["optimization.start"] = [...start];
      const camera = object(raw["optimization.camera"]),
        position = numbers(camera.position, 3),
        target = numbers(camera.target, 3);
      if (
        position &&
        target &&
        [...position, ...target].every((n) => Math.abs(n) <= 10000) &&
        Math.hypot(...position.map((n, i) => n - target[i])) > 1e-6 &&
        typeof camera.zoom === "number" &&
        Number.isFinite(camera.zoom) &&
        camera.zoom >= 0.2 &&
        camera.zoom <= 5
      )
        state["optimization.camera"] = {
          position: [...position],
          target: [...target],
          zoom: camera.zoom,
        };
      return state;
    }
    if (block.spec.template === "experiment") {
      const model = block.spec.experiment;
      if (!model) return state;
      if (Object.hasOwn(raw, "experiment.parameters")) {
        const parameters = object(raw["experiment.parameters"]);
        state["experiment.parameters"] = Object.fromEntries(
          model.parameters.flatMap((parameter) => {
            const value = parameters[parameter.id];
            return Object.hasOwn(parameters, parameter.id) &&
              typeof value === "number" &&
              Number.isFinite(value) &&
              value >= parameter.min &&
              value <= parameter.max
              ? [[parameter.id, value]]
              : [];
          }),
        );
      }
      if (model.time) bounded("experiment.time", 0, model.time.duration);
      if (model.stages?.length)
        integer("experiment.stage", 0, model.stages.length - 1);
      if (
        raw["experiment.selected"] === "" ||
        model.scene?.elements.some(
          (element) => element.id === raw["experiment.selected"],
        )
      )
        text("experiment.selected", 24);
      return state;
    }
    for (const key of [
      "illustration.step",
      "illustration.activation",
      "illustration.freeEnergyChange",
    ])
      numeric(key);
    if (block.spec.template === "scene" && block.spec.scene) {
      numeric("scene.step");
      if (
        Number.isInteger(raw["scene.relation"]) &&
        (raw["scene.relation"] as number) >= 0 &&
        (raw["scene.relation"] as number) < block.spec.scene.relations.length
      )
        numeric("scene.relation");
      if (
        block.spec.scene.participants.some(
          (participant) => participant.id === raw["scene.selection"],
        )
      )
        text("scene.selection", 50);
    }
    if (
      ["rna", "trna", "ribosome", "amino", "attachment", "pairing"].includes(
        raw["illustration.selection"] as string,
      )
    )
      text("illustration.selection", 50);
    if (block.spec.template === "field-explorer") {
      bounded("field.amplitude", 0, 2);
      bounded("field.wavelength", 0.5, 6);
      bounded("field.width", 0.4, 4);
      bounded("field.speed", 0.1, 2);
      bounded("field.time", 0, 6);
      bounded("field.selectedX", -6, 6);
      if (["wave", "packet"].includes(raw["field.mode"] as string))
        text("field.mode", 6);
    }
    if (block.spec.template === "protein-aggregation") {
      bounded("aggregation.concentration", 0.2, 5);
      bounded("aggregation.unfoldedFraction", 0, 1);
      bounded("aggregation.attraction", 0, 2);
      bounded("aggregation.partition", 1, 12);
      bounded("aggregation.time", 0, 12);
      if (Number.isInteger(raw["aggregation.selected"]))
        bounded("aggregation.selected", -1, 31);
      boolean("aggregation.condensate");
    }
    if (block.spec.template === "interaction-vertices") {
      const theory = ["qed", "qcd"].includes(
        raw["interaction.theory"] as string,
      )
        ? raw["interaction.theory"]
        : block.spec.interaction?.theory || "qcd";
      if (["qed", "qcd"].includes(raw["interaction.theory"] as string))
        text("interaction.theory", 3);
      const vertices =
        theory === "qed" ? ["matter"] : ["matter", "three-boson", "four-boson"];
      if (vertices.includes(raw["interaction.vertex"] as string))
        text("interaction.vertex", 11);
      if (
        ["fermion", "boson", "vertex"].includes(
          raw["interaction.selection"] as string,
        )
      )
        text("interaction.selection", 7);
    }
    // Interactive exports start paused rather than autoplay on file open.
  }
  if (block.type === "image") {
    text("image.term");
    numeric("image.active");
    numeric("image.zoom");
  }
  if (block.type === "molecule") {
    for (const key of [
      "molecule.style",
      "molecule.provider",
      "molecule.lookup",
      "molecule.selection",
      "molecule.measurement",
      "molecule.atomSerial",
      "molecule.label",
      "molecule.selectionMode",
      "molecule.alignmentInfo",
      "molecule.expression",
      "molecule.expressionResult",
    ])
      text(key);
    for (const key of [
      "molecule.surface",
      "molecule.spinning",
      "molecule.aligned",
      "molecule.trajectory.playing",
    ])
      boolean(key);
    numeric("molecule.trajectory.frame");
    if (numbers(raw["molecule.camera"]))
      state["molecule.camera"] = raw["molecule.camera"];
    if (Array.isArray(raw["molecule.selectedAtoms"]))
      state["molecule.selectedAtoms"] = (
        raw["molecule.selectedAtoms"] as unknown[]
      )
        .slice(0, 10000)
        .flatMap((value) => {
          const atom = object(value);
          return Number.isInteger(atom.serial) && Number.isInteger(atom.model)
            ? [{ serial: atom.serial, model: atom.model }]
            : [];
        });
    for (const key of [
      "molecule.structure",
      "molecule.comparison",
      "chemical.editor.applied",
    ]) {
      const pointer = object(raw[key]);
      if (typeof pointer.assetId === "string")
        state[key] = { assetId: pointer.assetId };
    }
  }
  return state;
}
export function composeOfflineBook(payload: OfflineExportPayload): OfflineBook {
  if (
    !payload ||
    typeof payload.title !== "string" ||
    !Array.isArray(payload.lessons) ||
    !Array.isArray(payload.chapters) ||
    !Array.isArray(payload.resources)
  )
    throw new Error("Choose valid learning material for export.");
  if (payload.messageIds !== undefined && !payload.messageIds.length)
    throw new Error(
      "No message sections were selected. An empty selection never exports the full conversation.",
    );
  const visualState = (id: string): ExportVisualState | undefined => {
    const visual = payload.visuals.find((v) => v.id === id);
    if (!visual) return;
    return {
      id: visual.id,
      subjectId: visual.subjectId,
      state: exportVisualState(visual.block, visual.state),
      annotations: payload.includeNotes
        ? visual.annotations.map((annotation) => ({
            id: annotation.id,
            text: annotation.text,
            createdAt: annotation.createdAt,
          }))
        : [],
    };
  };
  const chapters: ExportChapter[] = payload.chapters
    .slice()
    .sort((a, b) => (a.position || 0) - (b.position || 0))
    .map((chapter) => ({
      id: "chapter:" + chapter.id,
      title: chapter.title,
      markdown: chapter.markdown,
      blocks: blockList(chapter.blocks),
      citations: (chapter.citations || []).map((c) => ({
        label: c.label,
        url: safeUrl(c.url),
        documentId: c.documentId,
        page: c.page,
      })),
      originMessageIds: [...chapter.originMessageIds],
      source: { kind: "chapter", id: chapter.id },
      visualStates: Object.fromEntries(
        chapter.blocks.flatMap((block, index) => {
          const instance = payload.visuals.find(
            (v) =>
              JSON.stringify(v.block) === JSON.stringify(block) &&
              (!v.originMessageId ||
                chapter.originMessageIds.includes(v.originMessageId)),
          );
          return instance ? [[index, visualState(instance.id)!]] : [];
        }),
      ),
    }));
  const selected = payload.messageIds?.length
    ? new Set(payload.messageIds)
    : undefined;
  for (const lesson of payload.lessons) {
    const messages = lesson.messages.filter(
      (m) =>
        (!selected || selected.has(m.id)) &&
        (payload.includeUserMessages || m.role === "assistant"),
    );
    if (!messages.length && !(payload.includeNotes && lesson.notes)) continue;
    const blocks: ContentBlock[] = [],
      blockSources: Record<number, ExportReadingSource> = {},
      visualStates: Record<number, ExportVisualState> = {};
    for (const m of messages) {
      if (m.role === "user")
        blocks.push({ type: "text", text: "### Learner question" });
      for (const { block, key } of messageContent(m)) {
        if (!validateContentBlock(block)) continue;
        blockSources[blocks.length] = {
          kind: "message",
          id: m.id,
          conversationId: lesson.id,
        };
        const instance =
          payload.visuals.find((visual) => visual.id === key) ||
          payload.visuals.find(
            (v) =>
              (v.originMessageId === m.id ||
                m.visualInstanceIds?.includes(v.id)) &&
              JSON.stringify(v.block) === JSON.stringify(block),
          );
        if (instance) visualStates[blocks.length] = visualState(instance.id)!;
        blocks.push(block);
      }
      if (m.status === "partial")
        blocks.push({
          type: "text",
          text: "*Partial response preserved from the original session.*",
        });
    }
    chapters.push({
      id: "lesson:" + lesson.id,
      title: lesson.title,
      markdown: lesson.objective
        ? "*Learning objective: " + lesson.objective + "*"
        : "",
      blocks,
      blockSources,
      visualStates,
      citations: messages.flatMap((m) =>
        (m.sources || []).map((source) => ({
          label: source.citation,
          documentId: source.documentId,
          page: source.page,
        })),
      ),
      originMessageIds: messages.map((m) => m.id),
      ...(payload.includeNotes && lesson.notes ? { notes: lesson.notes } : {}),
    });
  }
  for (const resource of payload.resources) {
    if (resource.kind === "note" && !payload.includeNotes) continue;
    if (!resource.content.trim() && !resource.figures?.length) continue;
    const blocks: ContentBlock[] = [];
    const citations = [
      ...(resource.source
        ? [
            {
              label:
                safeUrl(resource.source) ||
                resource.title + " · supplied source",
              url: safeUrl(resource.source),
            },
          ]
        : []),
      ...(resource.citations || []).map((c) => ({
        label: c.text,
        url:
          safeUrl(c.url) ||
          (c.doi ? "https://doi.org/" + encodeURIComponent(c.doi) : undefined),
      })),
    ];
    chapters.push({
      id: "resource-" + resource.id,
      title: resource.title,
      markdown:
        (resource.kind === "document"
          ? "*Supplied document. Source material is " +
            (resource.verified ? "marked checked by its owner" : "unverified") +
            "; it is not evidence of learner mastery.*\n\n"
          : "") + resource.content,
      blocks,
      citations,
      originMessageIds: [],
      ...(resource.kind === "document"
        ? { source: { kind: "document" as const, id: resource.id } }
        : {}),
    });
    for (const figure of resource.figures || [])
      if (dataImage(figure.dataUrl)) {
        const query = "document-figure:" + resource.id + ":" + figure.id;
        blocks.push({ type: "image", query });
      }
  }
  const book: OfflineBook = {
    version: 1,
    title: payload.title.slice(0, 300),
    description:
      payload.subject?.objective ||
      "Selected learning material, preserved as an interactive offline textbook.",
    subjectName: payload.subject?.name,
    exportedAt: payload.exportedAt || new Date().toISOString(),
    chapters,
    assets: emptyAssets(),
    warnings: [],
    curriculum: (payload.curriculum || []).map((node) => ({
      title: node.title,
      description: node.description,
      status: node.status,
    })),
  };
  if (book.curriculum.length)
    book.chapters.unshift({
      id: "curriculum",
      title: "Learning pathway",
      markdown:
        "# " +
        (book.subjectName || book.title) +
        "\n\n" +
        book.description +
        "\n\nCoverage records describe what was visited, not demonstrated mastery.\n\n" +
        book.curriculum
          .map(
            (node) =>
              "### " +
              node.title +
              "\n\n" +
              node.description +
              "\n\nStatus: **" +
              node.status +
              "**",
          )
          .join("\n\n"),
      blocks: [],
      citations: [],
      originMessageIds: [],
    });
  for (const resource of payload.resources)
    for (const figure of resource.figures || [])
      if (dataImage(figure.dataUrl)) {
        const query = "document-figure:" + resource.id + ":" + figure.id;
        book.assets.images[query] = [
          {
            id: figure.id,
            title: resource.title + " · figure",
            url: figure.dataUrl,
            thumbnail: figure.dataUrl,
            source: safeUrl(resource.source) || "",
            author: "Supplied document",
            license:
              "Rights are governed by the supplied document; no redistribution permission is inferred.",
            licenseUrl: "",
            caption:
              (figure.caption || "Extracted figure") + " · page " + figure.page,
          },
        ];
      }
  const notebook = (payload.visuals || []).filter(
    (v) =>
      !!validateContentBlock(v.block) &&
      (payload.notebookVisualIds === undefined ||
        payload.notebookVisualIds.includes(v.id)),
  );
  if (payload.includeVisualNotebook && notebook.length) {
    book.chapters.push({
      id: "visual-notebook",
      title: "Visual notebook",
      markdown: "Saved scientific visualizations from this subject.",
      blocks: notebook.map((v) => validateContentBlock(v.block)!),
      visualStates: Object.fromEntries(
        notebook.map((v, index) => [index, visualState(v.id)!]),
      ),
      citations: [],
      originMessageIds: notebook.flatMap((v) =>
        v.originMessageId ? [v.originMessageId] : [],
      ),
    });
  }
  if (!book.chapters.length)
    throw new Error(
      "Select at least one nonempty chapter, explanation, resource, or visual.",
    );
  return book;
}
function validStructure(value: unknown): value is ExportStructure {
  const item = value as ExportStructure;
  if (!item || typeof item.data !== "string" || item.data.length > 20000000)
    return false;
  return item.format === "pdb"
    ? /^(?:ATOM {2}|HETATM)/m.test(item.data)
    : ["sdf", "mol"].includes(item.format) && /M {2}END/.test(item.data);
}
function validChemicalSource(value: unknown): value is ExportChemicalSource {
  const source = object(value);
  return (
    typeof source.input === "string" &&
    source.input.length > 0 &&
    source.input.length <= 100000 &&
    ["smiles", "mol", "sdf"].includes(String(source.format))
  );
}
const cleanStructure = (structure: ExportStructure): ExportStructure => ({
  data: structure.data,
  format: structure.format,
  sourceUrl: safeUrl(structure.sourceUrl),
  name:
    typeof structure.name === "string"
      ? structure.name.slice(0, 500)
      : undefined,
});
const cleanImage = (image: ImageResult): ImageResult => ({
  id: image.id,
  title: image.title,
  url: image.url,
  thumbnail: image.url,
  source: safeUrl(image.source) || "",
  author: image.author,
  license: image.license,
  licenseUrl: safeUrl(image.licenseUrl) || "",
  caption: image.caption,
});
export async function prepareOfflineBook(
  payload: OfflineExportPayload,
  options: ExportOptions = {},
): Promise<OfflineBook> {
  const book = composeOfflineBook(payload);
  if (options.appearance) {
    const appearance = sanitizeAppearance(options.appearance);
    book.appearance = {
      mode: appearance.mode,
      light: { ...appearance.light, presetId: "export-light" },
      dark: { ...appearance.dark, presetId: "export-dark" },
    };
  }
  // Include only annotations anchored to explicitly selected public lesson content.
  // No subject memory, authentication fields, or unselected transcript is copied.
  for (const chapter of book.chapters) {
    const allowed = [
      chapter.source,
      ...Object.values(chapter.blockSources || {}),
    ].filter(Boolean) as ExportReadingSource[];
    chapter.highlights = (options.highlights || [])
      .filter(
        (item) =>
          allowed.some(
            (source) =>
              source.kind === item.sourceKind && source.id === item.sourceId,
          ) &&
          (!payload.subject || item.subjectId === payload.subject.id),
      )
      .map((item) => ({
        id: item.id,
        subjectId: item.subjectId,
        sourceKind: item.sourceKind,
        sourceId: item.sourceId,
        conversationId: item.conversationId,
        page: item.page,
        quote: item.quote,
        prefix: item.prefix,
        suffix: item.suffix,
        start: item.start,
        end: item.end,
        color: item.color,
        note: payload.includeNotes ? item.note : "",
        tags: payload.includeNotes ? [...item.tags] : [],
        anchorState: item.anchorState,
        revision: item.revision,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
      }));
  }
  const supplied = options.assets;
  const usedQueries = new Set(
    book.chapters
      .flatMap((chapter) => chapter.blocks)
      .flatMap((block) => (block.type === "image" ? [block.query] : [])),
  );
  const usedStructures = new Set(
    book.chapters
      .flatMap((chapter) => chapter.blocks)
      .flatMap((block) =>
        block.type === "molecule" ? [block.source + ":" + block.id] : [],
      ),
  );
  for (const [query, images] of Object.entries(supplied?.images || {}))
    if (usedQueries.has(query))
      book.assets.images[query] = images
        .filter(
          (image) =>
            dataImage(image.url) && !!image.license && !!safeUrl(image.source),
        )
        .map(cleanImage);
  for (const [id, structure] of Object.entries(supplied?.structures || {}))
    if (usedStructures.has(id) && validStructure(structure))
      book.assets.structures[id] = cleanStructure(structure);
  const referencedVisuals = new Set(
    book.chapters.flatMap((chapter) =>
      Object.values(chapter.visualStates || {}).map((visual) => visual.id),
    ),
  );
  for (const visual of (payload.visuals || []).filter((visual) =>
    referencedVisuals.has(visual.id),
  )) {
    const state = visual.state || {};
    const structure = state.structureData || state.structure;
    if (
      visual.block.type === "molecule" &&
      usedStructures.has(visual.block.source + ":" + visual.block.id) &&
      validStructure(structure)
    )
      book.assets.structures[visual.block.source + ":" + visual.block.id] =
        cleanStructure(structure);
  }
  for (const chapter of book.chapters)
    for (const visual of Object.values(chapter.visualStates || {}))
      for (const key of [
        "molecule.structure",
        "molecule.comparison",
        "chemical.editor.applied",
      ]) {
        const pointer = visual.state[key] as { assetId?: string } | undefined;
        if (pointer?.assetId) {
          const asset = options.assetRecords?.[pointer.assetId];
          if (
            asset?.kind === "visual-source" &&
            key === "chemical.editor.applied" &&
            validChemicalSource(asset.value)
          )
            book.assets.sources[pointer.assetId] = {
              input: asset.value.input,
              format: asset.value.format,
            };
          else if (
            asset?.kind === "visual-source" &&
            key !== "chemical.editor.applied" &&
            validStructure(asset.value)
          )
            book.assets.sources[pointer.assetId] = cleanStructure(asset.value);
          else {
            delete visual.state[key];
            book.warnings.push(
              "A saved molecular source asset was unavailable and was not invented.",
            );
          }
        }
      }
  const blocks = book.chapters.flatMap((chapter) => chapter.blocks),
    queries = [
      ...new Set(
        blocks
          .filter(
            (b): b is Extract<ContentBlock, { type: "image" }> =>
              b.type === "image",
          )
          .map((b) => b.query),
      ),
    ];
  if (options.embedResources === false) {
    book.assets.images = {};
    book.assets.structures = {};
    book.assets.sources = {};
    book.warnings.push(
      "Image and molecular resource embedding was disabled by the export selection.",
    );
  }
  for (const query of queries) {
    if (options.embedResources === false) continue;
    if (book.assets.images[query]?.length) continue;
    try {
      const images = await cachedImages(query);
      book.assets.images[query] = images
        .filter(
          (image) =>
            dataImage(image.url) && !!image.license && !!safeUrl(image.source),
        )
        .map(cleanImage);
      if (!book.assets.images[query].length)
        book.warnings.push(
          "No permitted cached image was available for “" +
            query +
            "”. The explanation is preserved; its online image was not silently downloaded.",
        );
    } catch {
      book.warnings.push("Cached images were unavailable for “" + query + "”.");
    }
  }
  for (const chapter of book.chapters)
    for (const [index, visual] of Object.entries(chapter.visualStates || {})) {
      const block = chapter.blocks[Number(index)];
      if (block.type === "image") {
        visual.state["image.results"] = book.assets.images[block.query] || [];
        const active = Number(visual.state["image.active"] || 0);
        if (active >= (book.assets.images[block.query]?.length || 0))
          visual.state["image.active"] = 0;
      }
      if (options.embedResources === false) {
        delete visual.state["molecule.structure"];
        delete visual.state["molecule.comparison"];
        delete visual.state["chemical.editor.applied"];
      }
    }
  const moleculeBlocks = blocks.filter(
    (b): b is Extract<ContentBlock, { type: "molecule" }> =>
      b.type === "molecule",
  );
  for (const block of moleculeBlocks) {
    const key = block.source + ":" + block.id;
    if (book.assets.structures[key] || options.embedResources === false)
      continue;
    if (options.offlineOnly) {
      book.warnings.push(
        "Molecular source " +
          key +
          " was not supplied; no coordinates were invented.",
      );
      continue;
    }
    try {
      const structure = await fetchStructure(block.source, block.id);
      if (validStructure(structure)) book.assets.structures[key] = structure;
      else throw new Error("No valid coordinates.");
    } catch (error) {
      book.warnings.push(
        "Molecular source " + key + " could not be bundled: " + message(error),
      );
    }
  }
  const chemicals = [
    ...blocks.filter(
      (b): b is Extract<ContentBlock, { type: "chemical" }> =>
        b.type === "chemical",
    ),
    ...Object.values(book.assets.sources)
      .filter(validChemicalSource)
      .map((source) => ({
        type: "chemical" as const,
        input: source.input,
        format: source.format,
      })),
  ];
  for (const block of chemicals) {
    const key = block.format + ":" + block.input;
    if (book.assets.chemicals[key]) continue;
    try {
      book.assets.chemicals[key] = {
        light: await renderChemical({
          input: block.input,
          format: block.format,
          theme: { background: "#f7f7ef", text: "#303b2e" },
        }),
        dark: await renderChemical({
          input: block.input,
          format: block.format,
          theme: { background: "#333d31", text: "#e1e8d9" },
        }),
      };
    } catch (error) {
      book.warnings.push(
        "Chemical depiction could not be bundled: " + message(error),
      );
    }
  }
  return book;
}
async function runtime(options: ExportOptions) {
  const directory = options.runtimeDirectory || join(here, "../dist-export");
  try {
    return {
      js: await readFile(join(directory, "runtime.js"), "utf8"),
      css: await readFile(join(directory, "runtime.css"), "utf8"),
      notices: await readFile(join(directory, "NOTICES.txt"), "utf8").catch(
        () => "",
      ),
    };
  } catch {
    throw new Error(
      "The portable textbook runtime is missing. Run node scripts/build-export.mjs before building the desktop application.",
    );
  }
}
export function offlineHtml(
  book: OfflineBook,
  assets: { js: string; css: string; notices?: string },
  external = false,
): string {
  const js = assets.js.replace(/<\/script/gi, "<\\/script"),
    css = assets.css.replace(/<\/style/gi, "<\\/style"),
    serialized = JSON.stringify(book)
      .replace(/</g, "\\u003c")
      .replace(/\u2028/g, "\\u2028")
      .replace(/\u2029/g, "\\u2029");
  const hash = createHash("sha256").update(js).digest("base64");
  const policy = `default-src 'none'; script-src ${external ? "'self'" : "'sha256-" + hash + "'"}; style-src 'unsafe-inline' ${external ? "'self'" : ""}; img-src data: blob:; font-src data:; connect-src 'none'; worker-src blob:; object-src 'none'; base-uri 'none'`;
  return (
    '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="' +
    escapeHtml(policy) +
    '"><title>' +
    escapeHtml(book.title) +
    "</title>" +
    (external
      ? '<link rel="stylesheet" href="assets/runtime.css">'
      : "<style>" + css + "</style>") +
    '</head><body><div id="root"></div><noscript>This textbook requires JavaScript for interactive figures. No account or network connection is required.</noscript><script type="application/json" id="studio-book-data">' +
    serialized +
    "</script>" +
    (external
      ? '<script defer src="assets/runtime.js"></script>'
      : "<script>" + js + "</script>") +
    (assets.notices
      ? '<details class="offline-software-notices"><summary>Software licenses</summary><pre>' +
        escapeHtml(assets.notices) +
        "</pre></details>"
      : "") +
    "</body></html>"
  );
}
export async function renderOfflineTextbook(
  payload: OfflineExportPayload,
  options: ExportOptions = {},
): Promise<string> {
  const [book, assets] = await Promise.all([
    prepareOfflineBook(payload, options),
    runtime(options),
  ]);
  return offlineHtml(book, assets);
}
const crcTable = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit++)
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});
function crc32(bytes: Buffer) {
  let value = 0xffffffff;
  for (const byte of bytes)
    value = crcTable[(value ^ byte) & 255] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}
export function portableZip(entries: { name: string; data: Buffer }[]): Buffer {
  const local: Buffer[] = [],
    central: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name),
      compressed = deflateRawSync(entry.data),
      crc = crc32(entry.data),
      header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(0x800, 6);
    header.writeUInt16LE(8, 8);
    header.writeUInt32LE(crc, 14);
    header.writeUInt32LE(compressed.length, 18);
    header.writeUInt32LE(entry.data.length, 22);
    header.writeUInt16LE(name.length, 26);
    local.push(header, name, compressed);
    const directory = Buffer.alloc(46);
    directory.writeUInt32LE(0x02014b50, 0);
    directory.writeUInt16LE(20, 4);
    directory.writeUInt16LE(20, 6);
    directory.writeUInt16LE(0x800, 8);
    directory.writeUInt16LE(8, 10);
    directory.writeUInt32LE(crc, 16);
    directory.writeUInt32LE(compressed.length, 20);
    directory.writeUInt32LE(entry.data.length, 24);
    directory.writeUInt16LE(name.length, 28);
    directory.writeUInt32LE(offset, 42);
    central.push(directory, name);
    offset += header.length + name.length + compressed.length;
  }
  const centralBytes = Buffer.concat(central),
    end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBytes.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, centralBytes, end]);
}
export async function writeOfflineTextbook(
  path: string,
  payload: OfflineExportPayload,
  options: ExportOptions = {},
) {
  const [book, assets] = await Promise.all([
    prepareOfflineBook(payload, options),
    runtime(options),
  ]);
  const html = offlineHtml(book, assets);
  let destination = path,
    bytes: Buffer,
    format: "html" | "zip" = "html";
  if (
    extname(path).toLowerCase() === ".zip" ||
    Buffer.byteLength(html) > (options.zipThresholdBytes ?? 32000000)
  ) {
    format = "zip";
    destination =
      extname(path).toLowerCase() === ".zip"
        ? path
        : join(dirname(path), basename(path, extname(path)) + ".zip");
    bytes = portableZip([
      {
        name: "index.html",
        data: Buffer.from(offlineHtml(book, assets, true)),
      },
      {
        name: "assets/runtime.js",
        data: Buffer.from(assets.js.replace(/<\/script/gi, "<\\/script")),
      },
      { name: "assets/runtime.css", data: Buffer.from(assets.css) },
      { name: "NOTICES.txt", data: Buffer.from(assets.notices || "") },
      {
        name: "README.txt",
        data: Buffer.from(
          "Extract this folder and open index.html in an ordinary browser. All resources are bundled; no Learning Studio account is needed.\n" +
            book.warnings.join("\n"),
        ),
      },
    ]);
  } else bytes = Buffer.from(html);
  const temporary = destination + "." + randomUUID() + ".tmp";
  try {
    await writeFile(temporary, bytes, { flag: "wx" });
    await rename(temporary, destination);
  } finally {
    await rm(temporary, { force: true }).catch(() => {});
  }
  return {
    path: destination,
    format,
    bytes: bytes.length,
    chapters: book.chapters.length,
    warnings: book.warnings,
  };
}
