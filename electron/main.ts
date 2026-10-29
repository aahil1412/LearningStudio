import {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  shell,
  session,
  Tray,
  Menu,
  net,
} from "electron";
import { join, extname, basename } from "node:path";
import { readFile, writeFile, mkdir, stat } from "node:fs/promises";
import { StudioStore, validateStudioData } from "./storage";
import {
  searchImages,
  fetchStructure,
  boundedFetch,
  configureResourceCache,
  configureResourceTransport,
  cacheImage,
  cachedImages,
} from "./resources";
import { researchSearch, verifyReference } from "./research";
import {
  configureDocumentRuntime,
  extractDocument,
  searchDocuments,
  availableOcrLanguages,
  installOcrLanguage,
} from "./documents";
import { AuthProfiles } from "./profiles";
import { ModelProviderService } from "./providers";
import { BackgroundScheduler } from "./scheduler";
import { UpdateService } from "./updates";
import { renderChemical } from "./chemistry";
import { SubjectStore } from "./subjects";
import { renderOfflineTextbook, writeOfflineTextbook } from "./exporter";
import type {
  ExportSelection,
  OfflineExportPayload,
  VisualInstance,
} from "../src/v2types";
import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
import { unlinkSync } from "node:fs";
import { setImmediate as afterCurrentTurn } from "node:timers";
import { chapterFromRecord, visualFromRecord } from "../src/lib/v2records";
import { z } from "zod";
import { readZoom, saveZoom, zoomFactor, zoomShortcut } from "./zoom";
import { PlanningService } from "./planning";
import { AnnotationStore } from "./annotations";
import { CheckpointService } from "./checks";
import { ModelRequestService } from "./modelRequests";
import { RestorePreviewService } from "./restorePreview";
import { StudySourceService } from "./studySources";
import { fetchStudySource } from "./sourceImport";
import type { StudioData } from "../src/types";
const here = __dirname;
let win: BrowserWindow;
let store: StudioStore;
let subjects: SubjectStore;
let studySources: StudySourceService;
let auth: AuthProfiles;
let providers: ModelProviderService;
let scheduler: BackgroundScheduler;
let updater: UpdateService;
let planning: PlanningService;
let annotations: AnnotationStore;
let checkpoints: CheckpointService;
let modelRequests: ModelRequestService;
let restorePreview: RestorePreviewService;
let tray: Tray | undefined;
let quitting = false,
  closeAllowed = false,
  closePending = false,
  quitQueued = false,
  quitReady = false;
const changed = () => {
  if (win && !win.isDestroyed()) win.webContents.send("studio:data-changed");
};
function createPlanningService() {
  return new PlanningService(store, subjects, {
    models: () => providers.models(),
    request: (request, signal) => modelRequests.background(request, signal),
    sourceContext: (subjectId, options) =>
      Promise.resolve(studySources.context({ subjectId, ...options })),
    changed,
  });
}
function cancelAccountRequests() {
  modelRequests?.cancelAll(
    "The account changed or disconnected. Any partial explanation is saved; reconnect before retrying.",
  );
  scheduler?.cancel();
  for (const job of planning?.list() || [])
    if (job.status === "running") planning.cancel(job.id);
}
const previewFiles = new Set<string>();
app.on("will-quit", () => {
  for (const path of previewFiles)
    try {
      unlinkSync(path);
    } catch {}
});
const safeError = (error: unknown) =>
  error instanceof Error
    ? error.message.replace(/Bearer\s+\S+/gi, "[redacted]").slice(0, 700)
    : "The operation could not be completed.";
if (process.env.STUDIO_DATA_DIR)
  app.setPath("userData", process.env.STUDIO_DATA_DIR);
app.setName("Learning Studio");
// Electron scopes its process singleton to userData. Separate test/portable
// profiles can coexist, while two windows cannot race whole-library autosaves.
const primaryInstance = app.requestSingleInstanceLock();
if (!primaryInstance) app.quit();
app.on("second-instance", () => {
  if (!win || win.isDestroyed()) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
});
function pauseImportedAutomation(data: StudioData): StudioData {
  return {
    ...data,
    settings: {
      ...data.settings,
      backgroundConsent: false,
      backgroundOnClose: false,
    },
    backgroundTasks: data.backgroundTasks?.map((task) => ({
      ...task,
      enabled: false,
      status: task.status === "running" ? "scheduled" : task.status,
      updatedAt: new Date().toISOString(),
    })),
  };
}
async function fileImport(
  kind: "library" | "structure" | "data",
  textbook = false,
) {
  const filters =
    kind === "library"
      ? [
          {
            name: "Documents",
            extensions: [
              "md",
              "txt",
              "pdf",
              "png",
              "jpg",
              "jpeg",
              "webp",
              "tiff",
              "bmp",
            ],
          },
        ]
      : kind === "structure"
        ? [
            {
              name: "Molecular structures",
              extensions: ["pdb", "sdf", "mol", "mol2", "xyz", "cif"],
            },
          ]
        : [{ name: "Learning Studio export", extensions: ["json"] }];
  const result = await dialog.showOpenDialog(win, {
    filters,
    properties: ["openFile"],
  });
  if (result.canceled) return null;
  const path = result.filePaths[0];
  if ((await stat(path)).size > (textbook ? 100_000_000 : 20_000_000))
    throw new Error(`Choose a file smaller than ${textbook ? 100 : 20} MB.`);
  if (
    kind === "library" &&
    ![
      ".md",
      ".txt",
      ".pdf",
      ".png",
      ".jpg",
      ".jpeg",
      ".webp",
      ".tiff",
      ".bmp",
    ].includes(extname(path).toLowerCase())
  )
    throw new Error(
      "Choose a Markdown, plain text, PDF, or scanned-image document.",
    );
  if (
    kind === "structure" &&
    ![".pdb", ".sdf", ".mol", ".mol2", ".xyz", ".cif"].includes(
      extname(path).toLowerCase(),
    )
  )
    throw new Error("Choose a supported molecular structure file.");
  if (kind === "data")
    return pauseImportedAutomation(
      validateStudioData(JSON.parse(await readFile(path, "utf8"))),
    );
  if (kind === "structure")
    return {
      data: await readFile(path, "utf8"),
      format: extname(path).slice(1),
      name: basename(path),
    };
  return importDocument(path, textbook);
}
async function importDocument(path: string, textbook = false) {
  const extracted = await extractDocument(path, {
    ...(textbook
      ? { maxBytes: 100_000_000, maxPages: 2000, maxOcrPages: 2000 }
      : {}),
    ocr: true,
    extractImages: true,
    onProgress: (progress) => {
      if (!win.isDestroyed())
        win.webContents.send("studio:import-progress", progress);
    },
  });
  if (extname(path).toLowerCase() === ".pdf") {
    const bytes = await readFile(path),
      sourceAssetId = store.putDocumentAsset(bytes);
    return { ...extracted, sourceAssetId };
  }
  // Text and image OCR have no physical PDF pagination. Keep their text without
  // promoting the parser's convenience page1 into a source citation.
  return {
    ...extracted,
    content: extracted.pages.map((page) => page.text).join("\n\n"),
    pages: [],
  };
}
async function handle(action: string, payload: any) {
  if (action.startsWith("study-sources:")) {
    const result = studySources.handle(action, payload);
    if (
      [
        "study-sources:save",
        "study-sources:adopt",
        "study-sources:select",
        "study-sources:remove",
      ].includes(action)
    )
      changed();
    return result;
  }
  if (action.startsWith("providers:")) {
    const result = await providers.handle(action, payload);
    if (
      ["providers:save", "providers:select", "providers:delete"].includes(
        action,
      )
    )
      changed();
    return result;
  }
  if (action === "data:concepts")
    return (
      store.db.prepare("SELECT value FROM concepts").all() as {
        value: string;
      }[]
    ).map((row) => JSON.parse(row.value));
  if (action === "checks:submit") {
    const result = checkpoints.submit(payload);
    changed();
    return result;
  }
  if (action.startsWith("annotations:") || action.startsWith("graph:")) {
    const value = annotations.dispatch(action, payload);
    if (
      ![
        "annotations:list",
        "annotations:search",
        "annotations:revisions",
        "graph:get",
      ].includes(action)
    )
      changed();
    return value;
  }
  if (action.startsWith("planning:") || action.startsWith("learning:intake-"))
    return planning.handle(action, payload);
  if (action === "subject:archive-export") {
    const archive = subjects.dispatch("subject:export", payload);
    const result = await dialog.showSaveDialog(win, {
      defaultPath: "learning-subject.json",
      filters: [{ name: "Portable subject archive", extensions: ["json"] }],
    });
    if (result.canceled || !result.filePath) return false;
    await writeFile(result.filePath, JSON.stringify(archive), "utf8");
    return true;
  }
  if (action === "subject:archive-import") {
    const result = await dialog.showOpenDialog(win, {
      filters: [{ name: "Subject archive", extensions: ["json"] }],
      properties: ["openFile"],
    });
    if (result.canceled) return null;
    const path = result.filePaths[0];
    if ((await stat(path)).size > 300_000_000)
      throw new Error("Subject archive exceeds 300 MB.");
    const restored = subjects.dispatch("subject:restore", {
      archive: JSON.parse(await readFile(path, "utf8")),
    });
    changed();
    return restored;
  }
  if (action === "export:html" || action === "export:preview") {
    const selection = payload as ExportSelection;
    if (
      !selection ||
      typeof selection.title !== "string" ||
      !Array.isArray(selection.lessonIds) ||
      !Array.isArray(selection.chapterIds)
    )
      throw new Error("Select the content to export.");
    const canonical = store.load(),
      snapshot = selection.subjectId
        ? subjects.snapshot(selection.subjectId, true)
        : undefined;
    const lessons = canonical.lessons
      .filter(
        (lesson) =>
          selection.lessonIds.includes(lesson.id) &&
          (!snapshot ||
            snapshot.conversations.some((chat) => chat.id === lesson.id)),
      )
      .map((lesson) => ({
        ...lesson,
        messages: subjects.transcriptAll(lesson.id),
      }));
    const chapters = (snapshot?.records || [])
      .filter(
        (record) =>
          record.recordType === "chapter" &&
          selection.chapterIds.includes(record.id),
      )
      .map(chapterFromRecord);
    const complete =
      (selection as ExportSelection & { scope?: string }).scope === "subject";
    const messageIds = new Set(
        lessons.flatMap((lesson) =>
          lesson.messages
            .filter(
              (message) =>
                !selection.messageIds ||
                selection.messageIds.includes(message.id),
            )
            .map((message) => message.id),
        ),
      ),
      instanceIds = new Set(
        lessons.flatMap((lesson) =>
          lesson.messages
            .filter((message) => messageIds.has(message.id))
            .flatMap((message) => message.visualInstanceIds || []),
        ),
      );
    const permittedVisuals = (snapshot?.records || [])
      .filter((record) => record.recordType === "visual")
      .map(visualFromRecord)
      .filter((visual): visual is VisualInstance => !!visual)
      .filter(
        (visual) =>
          (complete &&
            visual.tags?.includes("saved") &&
            (!selection.visualIds ||
              selection.visualIds.includes(visual.id))) ||
          (visual.originMessageId && messageIds.has(visual.originMessageId)) ||
          instanceIds.has(visual.id) ||
          chapters.some(
            (chapter) =>
              chapter.blocks.some(
                (block) =>
                  JSON.stringify(block) === JSON.stringify(visual.block),
              ) &&
              (!visual.originMessageId ||
                chapter.originMessageIds.includes(visual.originMessageId)),
          ),
      );
    const assetRecords: Record<string, { kind: string; value: unknown }> = {};
    for (const visual of permittedVisuals)
      for (const key of [
        "molecule.structure",
        "molecule.comparison",
        "chemical.editor.applied",
      ]) {
        const pointer = visual.state[key] as { assetId?: string } | undefined;
        if (pointer?.assetId && snapshot) {
          const record = subjects.dispatch("subject:record-get", {
            subjectId: snapshot.subject.id,
            id: pointer.assetId,
            recordType: "asset",
          }) as { data: { kind: string; value: unknown } } | null;
          if (record) assetRecords[pointer.assetId] = record.data;
        }
      }
    const exportPayload: OfflineExportPayload = {
      title: selection.title.slice(0, 300),
      subject: snapshot?.subject,
      lessons,
      chapters,
      resources: complete
        ? canonical.library.filter(
            (item) =>
              (item.subjectId === selection.subjectId ||
                (!item.subjectId &&
                  (item.subject || "General") === snapshot?.subject.name)) &&
              (!selection.resourceIds ||
                selection.resourceIds.includes(item.id)),
          )
        : [],
      visuals: permittedVisuals,
      includeVisualNotebook: complete,
      notebookVisualIds: complete
        ? selection.visualIds ||
          permittedVisuals
            .filter((visual) => visual.tags.includes("saved"))
            .map((visual) => visual.id)
        : [],
      curriculum: complete ? snapshot?.curriculum : undefined,
      includeNotes: selection.includeNotes === true,
      includeUserMessages: selection.includeUserMessages === true,
      messageIds: selection.messageIds,
      exportedAt: new Date().toISOString(),
    };
    const exportHighlights = [
      ...new Set(
        [
          snapshot?.subject.id,
          ...lessons.map((lesson) => lesson.subjectId),
        ].filter((id): id is string => !!id),
      ),
    ].flatMap((subjectId) => annotations.list({ subjectId }));
    if (action === "export:preview") {
      const html = await renderOfflineTextbook(exportPayload, {
          appearance: canonical.appearance,
          highlights: exportHighlights,
          offlineOnly: true,
          assetRecords,
          embedResources: selection.embedCachedResources,
        }),
        directory = join(app.getPath("temp"), "learning-studio-preview");
      await mkdir(directory, { recursive: true });
      const path = join(directory, "preview-" + randomUUID() + ".html");
      await writeFile(path, html, "utf8");
      previewFiles.add(path);
      return { url: pathToFileURL(path).href };
    }
    const result = await dialog.showSaveDialog(win, {
      defaultPath:
        selection.title.replace(/[^\w -]/g, "").slice(0, 80) + ".html",
      filters: [
        { name: "Interactive HTML", extensions: ["html"] },
        { name: "Portable HTML package", extensions: ["zip"] },
      ],
    });
    if (result.canceled || !result.filePath) return null;
    return writeOfflineTextbook(result.filePath, exportPayload, {
      appearance: canonical.appearance,
      highlights: exportHighlights,
      assetRecords,
      embedResources: selection.embedCachedResources,
    });
  }
  if (action.startsWith("subject:")) {
    const result = subjects.dispatch(action, payload);
    const localVisualWrite =
      action === "subject:record-put" &&
      ["visual", "asset", "canvas"].includes(payload?.recordType);
    if (
      !localVisualWrite &&
      ![
        "subject:list",
        "subject:get",
        "subject:conversation-get",
        "subject:context",
        "subject:search",
        "subject:transcript",
        "subject:record-get",
        "subject:record-list",
        "subject:curriculum",
        "subject:dashboard",
        "subject:export",
      ].includes(action)
    )
      changed();
    return result;
  }
  switch (action) {
    case "documents:pdf-url": {
      const resource = store
        .load()
        .library.find((item) => item.id === String(payload?.resourceId));
      if (
        !resource?.sourceAssetId ||
        !/^[a-f0-9]{64}$/.test(resource.sourceAssetId)
      )
        return null;
      let bytes = store.getDocumentAsset(resource.sourceAssetId);
      if (!bytes) {
        bytes = await readFile(
          join(
            app.getPath("userData"),
            "document-originals",
            resource.sourceAssetId + ".pdf",
          ),
        );
        store.putDocumentAsset(bytes);
      }
      return "data:application/pdf;base64," + bytes.toString("base64");
    }
    case "data:load":
      return store.load();
    case "data:search":
      return store.search(String(payload?.query || ""));
    case "data:save":
      if (restorePreview.awaitingAcknowledgment)
        return { savedAt: new Date().toISOString(), deferredForRestore: true };
      store.save(payload);
      if (!payload?.settings?.backgroundConsent) scheduler?.cancel();
      for (const task of payload?.backgroundTasks || [])
        if (!task.enabled || task.status === "cancelled")
          scheduler?.cancel(task.id);
      return { savedAt: new Date().toISOString() };
    case "data:export": {
      const path = await dialog.showSaveDialog(win, {
        defaultPath: "learning-studio-library.json",
        filters: [{ name: "Studio library", extensions: ["json"] }],
      });
      if (path.canceled || !path.filePath) return false;
      await writeFile(
        path.filePath,
        JSON.stringify(store.load(), null, 2),
        "utf8",
      );
      return true;
    }
    case "data:import": {
      const imported = await fileImport("data");
      if (imported) scheduler?.cancel();
      return imported;
    }
    case "data:backup": {
      const path = await dialog.showSaveDialog(win, {
        defaultPath: "learning-studio-backup.sqlite",
        filters: [{ name: "SQLite backup", extensions: ["sqlite"] }],
      });
      if (path.canceled || !path.filePath) return false;
      await store.backup(path.filePath);
      return true;
    }
    case "data:restore": {
      const result = await dialog.showOpenDialog(win, {
        filters: [{ name: "SQLite backup", extensions: ["sqlite"] }],
        properties: ["openFile"],
      });
      if (result.canceled) return null;
      const file = result.filePaths[0];
      if ((await stat(file)).size > 1_000_000_000)
        throw new Error("Backup exceeds 1 GB limit.");
      return restorePreview.preview(file);
    }
    case "data:restore-cancel":
      restorePreview.cancel(String(payload?.token || ""));
      return true;
    case "data:restore-confirm": {
      if (modelRequests.foregroundCount)
        throw new Error(
          "Cancel the active tutor response before restoring a database backup. Your current library has not been changed.",
        );
      let planningDisposed = false;
      try {
        return restorePreview.confirm(String(payload?.token || ""), () => {
          scheduler?.cancel();
          planning?.dispose();
          planningDisposed = true;
        });
      } finally {
        if (planningDisposed) planning = createPlanningService();
      }
    }
    case "data:restore-ack":
      restorePreview.acknowledge(String(payload?.token || ""));
      changed();
      return true;
    case "library:import":
      return fileImport("library");
    case "study-document:import":
      return fileImport("library", true);
    case "study-document:url": {
      const imported = await fetchStudySource(
        z.string().url().max(4000).parse(payload?.url),
      );
      if (!imported.pdf)
        return {
          title: imported.title,
          source: imported.url,
          content: imported.text || "",
          pages: [],
          figures: [],
          citations: [],
          warnings: [],
        };
      const directory = join(
        app.getPath("temp"),
        "learning-studio-source-import",
      );
      await mkdir(directory, { recursive: true });
      const path = join(directory, randomUUID() + ".pdf");
      try {
        await writeFile(path, imported.pdf);
        return {
          ...(await importDocument(path, true)),
          title: imported.title,
          source: imported.url,
        };
      } finally {
        try {
          unlinkSync(path);
        } catch {}
      }
    }
    case "structure:import":
      return fileImport("structure");
    case "images:search":
      return searchImages(String(payload?.query || ""), {
        provider: payload?.provider || "wikimedia",
      });
    case "resources:cache":
      return cacheImage(payload?.image || payload?.id || payload);
    case "resources:cached":
      return cachedImages(String(payload?.query || ""));
    case "research:search":
      return researchSearch(String(payload?.query || ""));
    case "research:verify":
      return verifyReference(payload || {});
    case "documents:search":
      return searchDocuments({
        query: String(payload?.query || ""),
        documents: store
          .load()
          .library.filter(
            (i) =>
              i.kind === "document" &&
              (!Array.isArray(payload?.documentIds) ||
                payload.documentIds.includes(i.id)),
          ),
        limit: Math.min(30, Number(payload?.limit) || 8),
      });
    case "documents:languages":
      return availableOcrLanguages();
    case "documents:language-import": {
      const result = await dialog.showOpenDialog(win, {
        filters: [
          {
            name: "Tesseract language data",
            extensions: ["traineddata", "gz"],
          },
        ],
        properties: ["openFile"],
      });
      return result.canceled ? null : installOcrLanguage(result.filePaths[0]);
    }
    case "chemistry:wasm":
      return (
        await readFile(require.resolve("@rdkit/rdkit/RDKit_minimal.wasm"))
      ).toString("base64");
    case "chemistry:render":
      return renderChemical(payload);
    case "structure:fetch":
      return fetchStructure(String(payload?.source), String(payload?.id));
    case "structure:depiction": {
      const id = String(payload?.id);
      if (!/^\d{1,12}$/.test(id)) throw new Error("Use a numeric PubChem CID.");
      const sourceUrl = `https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/cid/${id}/PNG?record_type=2d`;
      const r = await boundedFetch(sourceUrl, 3_000_000);
      return {
        dataUrl:
          "data:image/png;base64," +
          Buffer.from(await r.arrayBuffer()).toString("base64"),
        sourceUrl,
      };
    }
    case "auth:status":
      return auth.status();
    case "auth:profiles":
      return auth.list();
    case "auth:create-profile":
      cancelAccountRequests();
      return auth.create(String(payload?.label || ""));
    case "auth:select-profile":
      cancelAccountRequests();
      return auth.select(String(payload?.id));
    case "auth:rename-profile":
      return auth.rename(String(payload?.id), String(payload?.label || ""));
    case "auth:connect":
      return auth.connect();
    case "auth:disconnect":
      cancelAccountRequests();
      await auth.disconnect();
      return auth.status();
    case "auth:models":
      return providers.models();
    case "model:cancel":
      modelRequests.cancel(String(payload?.requestId));
      return true;
    case "background:run": {
      if (!store.load().settings.backgroundConsent)
        throw new Error(
          "Enable explicit background model consent in Settings first.",
        );
      await scheduler.tick();
      return store.load().backgroundTasks;
    }
    case "background:cancel": {
      const id = String(payload?.id);
      scheduler.cancel(id);
      store.updateBackgroundTask(id, { enabled: false, status: "cancelled" });
      changed();
      return true;
    }
    case "updates:status":
      return updater.status();
    case "updates:check":
      return updater.check(
        String(
          payload?.feedUrl || store.load().settings.updates?.feedUrl || "",
        ),
      );
    case "updates:download":
      return updater.download();
    case "updates:install":
      updater.install();
      return true;
    case "model:send":
      return modelRequests.send(payload);
    case "external:open": {
      const url = new URL(String(payload));
      if (url.protocol !== "https:" || url.username || url.password)
        throw new Error(
          "Only HTTPS source links without embedded credentials can be opened.",
        );
      await shell.openExternal(url.href);
      return true;
    }
    case "app:diagnostics":
      return {
        version: app.getVersion(),
        platform: process.platform,
        databaseVersion: store.db.pragma("user_version", { simple: true }),
        activeRequests: modelRequests.foregroundCount,
        modelConcurrency: modelRequests.counts,
        storage: "SQLite · WAL transactions",
        credentialStorage: "Electron safeStorage / Windows DPAPI",
        zoomFactor: win.webContents.getZoomFactor(),
      };
    case "app:zoom": {
      const direction = z
        .enum(["in", "out", "reset", "get"])
        .parse(payload?.direction);
      const factor =
        direction === "get"
          ? readZoom(store.db)
          : saveZoom(
              store.db,
              direction === "reset"
                ? 1
                : zoomFactor(
                    win.webContents.getZoomFactor() +
                      (direction === "in" ? 0.1 : -0.1),
                  ),
            );
      win.webContents.setZoomFactor(factor);
      return factor;
    }
    default:
      throw new Error("Unknown operation.");
  }
}
app
  .whenReady()
  .then(async () => {
    if (!primaryInstance) return;
    await mkdir(app.getPath("userData"), { recursive: true });
    store = new StudioStore(
      join(app.getPath("userData"), "learning-studio.sqlite"),
    );
    restorePreview = new RestorePreviewService(store);
    subjects = new SubjectStore(store);
    studySources = new StudySourceService(store, subjects);
    annotations = new AnnotationStore(store);
    checkpoints = new CheckpointService(store, subjects);
    // Only migrate originals referenced by this application's canonical library.
    // This supports early portable-source imports without scanning unrelated files.
    for (const resource of store.load().library) {
      const assetId = resource.sourceAssetId;
      if (
        !assetId ||
        !/^[a-f0-9]{64}$/.test(assetId) ||
        store.db
          .prepare("SELECT 1 FROM document_assets WHERE id=?")
          .get(assetId)
      )
        continue;
      const path = join(
        app.getPath("userData"),
        "document-originals",
        assetId + ".pdf",
      );
      try {
        if ((await stat(path)).size <= 20_000_000) {
          const bytes = await readFile(path);
          if (store.putDocumentAsset(bytes) !== assetId)
            throw new Error(
              "The retained PDF content hash does not match its library reference.",
            );
        }
      } catch {
        /* Extracted legacy pages remain usable when an original was not retained. */
      }
    }
    configureResourceCache(join(app.getPath("userData"), "image-cache"));
    configureResourceTransport((url, options) =>
      net.fetch(url.toString(), { ...options, credentials: "omit" }),
    );
    configureDocumentRuntime({
      cacheDirectory: join(app.getPath("userData"), "ocr"),
      languageDirectory: join(here, "../assets/ocr"),
      workerPath: require
        .resolve("tesseract.js/src/worker-script/node/index.js")
        .replace("app.asar", "app.asar.unpacked"),
    });
    auth = new AuthProfiles({
      directory: app.getPath("userData"),
      fetch: (input, options) =>
        net.fetch(
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.href
              : input.url,
          { ...options, credentials: "omit" },
        ),
      openExternal: async (url) => {
        await shell.openExternal(url);
      },
    });
    providers = new ModelProviderService(app.getPath("userData"), auth, {
      beforeActiveChange: cancelAccountRequests,
      fetch: (input, options) =>
        net.fetch(
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.href
              : input.url,
          { ...options, credentials: "omit" },
        ),
    });
    modelRequests = new ModelRequestService({
      onState: (event) => {
        if (win && !win.isDestroyed())
          win.webContents.send("studio:request-state", event);
      },
      respond: (request, onDelta, signal) =>
        providers.respond(request, onDelta, signal),
      onDelta: (event) => {
        if (win && !win.isDestroyed())
          win.webContents.send("studio:stream", event);
      },
    });
    planning = createPlanningService();
    updater = new UpdateService();
    scheduler = new BackgroundScheduler({
      load: () => store.load(),
      update: (id, patch) => store.updateBackgroundTask(id, patch),
      models: () => providers.models(),
      respond: (request, signal) => modelRequests.background(request, signal),
      changed,
    });
    session.defaultSession.setPermissionRequestHandler(
      (_wc, _permission, callback) => callback(false),
    );
    win = new BrowserWindow({
      show: !app.commandLine.hasSwitch("start-hidden"),
      width: 1510,
      height: 980,
      minWidth: 880,
      minHeight: 640,
      backgroundColor: "#eee8de",
      title: "Learning Studio",
      icon: join(here, "../assets/icon.png"),
      autoHideMenuBar: true,
      webPreferences: {
        preload: join(here, "preload.cjs"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
      },
    });
    win.webContents.on("did-finish-load", () =>
      win.webContents.setZoomFactor(readZoom(store.db)),
    );
    win.webContents.on("before-input-event", (event, input) => {
      const direction = zoomShortcut(input);
      if (!direction) return;
      event.preventDefault();
      const factor = saveZoom(
        store.db,
        direction === "reset"
          ? 1
          : win.webContents.getZoomFactor() + (direction === "in" ? 0.1 : -0.1),
      );
      win.webContents.setZoomFactor(factor);
    });
    win.webContents.setWindowOpenHandler(({ url }) => {
      try {
        const u = new URL(url);
        if (u.protocol === "https:" && !u.username && !u.password)
          void shell.openExternal(u.href).catch(() => {});
      } catch {}
      return { action: "deny" };
    });
    win.webContents.on("will-navigate", (event, url) => {
      if (url !== win.webContents.getURL()) event.preventDefault();
    });
    win.on("close", (event) => {
      if (closeAllowed || quitting) return;
      const preferences = store.load().settings;
      if (preferences.backgroundConsent && preferences.backgroundOnClose) {
        event.preventDefault();
        win.hide();
        if (!tray) {
          tray = new Tray(join(here, "../assets/icon.png"));
          tray.setToolTip("Learning Studio · background tasks enabled");
          tray.setContextMenu(
            Menu.buildFromTemplate([
              { label: "Open Learning Studio", click: () => win.show() },
              { label: "Quit Learning Studio", click: () => app.quit() },
            ]),
          );
          tray.on("double-click", () => win.show());
        }
        return;
      }
      event.preventDefault();
      if (closePending) return;
      closePending = true;
      win.webContents.send("studio:close-requested");
      setTimeout(() => {
        if (closePending && !win.isDestroyed())
          void dialog
            .showMessageBox(win, {
              type: "warning",
              buttons: ["Keep open", "Quit with last saved state"],
              defaultId: 0,
              message: "The workspace has not confirmed its final save.",
              detail:
                "Keep the application open to retry, or quit with the last successfully saved library.",
            })
            .then(({ response }) => {
              closePending = false;
              if (response === 1) {
                closeAllowed = true;
                win.close();
              }
            });
      }, 5000).unref();
    });
    ipcMain.handle("studio:close-result", async (event, ok) => {
      if (
        event.sender !== win.webContents ||
        event.senderFrame !== win.webContents.mainFrame
      )
        throw new Error("Untrusted frame.");
      closePending = false;
      if (ok) {
        closeAllowed = true;
        win.close();
      }
      return true;
    });
    ipcMain.handle("studio:dropped", async (event, paths: unknown) => {
      if (
        event.sender !== win.webContents ||
        event.senderFrame !== win.webContents.mainFrame
      )
        throw new Error("Untrusted frame.");
      if (
        !Array.isArray(paths) ||
        paths.length > 8 ||
        paths.some((p) => typeof p !== "string")
      )
        throw new Error("Drop up to eight document files.");
      return Promise.all(paths.map((path) => importDocument(path)));
    });
    ipcMain.handle("studio:invoke", async (event, action, payload) => {
      if (
        event.sender !== win.webContents ||
        event.senderFrame !== win.webContents.mainFrame
      )
        throw new Error("Untrusted frame.");
      try {
        return await handle(action, payload);
      } catch (error) {
        throw new Error(safeError(error));
      }
    });
    if (process.env.STUDIO_DEV_URL === "http://127.0.0.1:5173")
      await win.loadURL(process.env.STUDIO_DEV_URL);
    else await win.loadFile(join(here, "../dist/index.html"));
    scheduler.start();
    const updateSettings = store.load().settings.updates;
    if (updateSettings?.autoCheck && updateSettings.feedUrl)
      void updater.check(updateSettings.feedUrl).catch(() => {});
  })
  .catch((error) => {
    dialog.showErrorBox(
      "Learning Studio could not open its library",
      safeError(error) +
        "\n\nYour saved library has not been replaced. Check file permissions or recover a backup before reopening.",
    );
    app.quit();
  });
app.on("window-all-closed", () => app.quit());
app.on("before-quit", (event) => {
  if (quitReady) return;
  // app.quit() can be invoked inside a SQLite/native callback. Cancel work
  // immediately, then let that synchronous callback unwind before will-quit
  // closes the database. Repeated quit requests share this one final turn.
  event.preventDefault();
  if (quitQueued) return;
  quitQueued = true;
  quitting = true;
  scheduler?.stop();
  planning?.dispose();
  modelRequests?.cancelAll(
    "Learning Studio is closing. Any saved partial explanation remains available when you reopen the app.",
  );
  afterCurrentTurn(() => {
    quitReady = true;
    app.quit();
  });
});
app.on("will-quit", () => {
  tray?.destroy();
  store?.close();
});
