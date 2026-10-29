import { _electron as electron, chromium, expect } from "@playwright/test";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { resolve, join, sep } from "node:path";
import assert from "node:assert/strict";
import { createCanvas } from "@napi-rs/canvas";
function scanPdf(jpeg) {
  const content = Buffer.from("q 600 0 0 120 6 600 cm /Im1 Do Q");
  const objects = [
    Buffer.from("<< /Type /Catalog /Pages 2 0 R >>"),
    Buffer.from("<< /Type /Pages /Kids [3 0 R] /Count 1 >>"),
    Buffer.from(
      "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /XObject << /Im1 5 0 R >> >> /Contents 4 0 R >>",
    ),
    Buffer.concat([
      Buffer.from(`<< /Length ${content.length} >>\nstream\n`),
      content,
      Buffer.from("\nendstream"),
    ]),
    Buffer.concat([
      Buffer.from(
        `<< /Type /XObject /Subtype /Image /Width 1400 /Height 280 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`,
      ),
      jpeg,
      Buffer.from("\nendstream"),
    ]),
  ];
  const buffers = [Buffer.from("%PDF-1.4\n")],
    offsets = [0];
  let size = buffers[0].length;
  objects.forEach((object, index) => {
    offsets.push(size);
    const next = Buffer.concat([
      Buffer.from(`${index + 1} 0 obj\n`),
      object,
      Buffer.from("\nendobj\n"),
    ]);
    buffers.push(next);
    size += next.length;
  });
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1))
    xref += String(offset).padStart(10, "0") + " 00000 n \n";
  buffers.push(
    Buffer.from(
      `${xref}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${size}\n%%EOF`,
    ),
  );
  return Buffer.concat(buffers);
}
const directory = await mkdtemp(join(resolve("."), ".package-smoke-"));
const releaseRoot = resolve(process.env.STUDIO_RELEASE_DIR || "release");
const executable = join(releaseRoot, "win-unpacked/Learning Studio.exe");
const environment = Object.fromEntries(
  Object.entries(process.env).filter(([, value]) => typeof value === "string"),
);
delete environment.ELECTRON_RUN_AS_NODE;
delete environment.STUDIO_DEV_URL;
environment.STUDIO_DATA_DIR = directory;
let app;
async function launch() {
  app = await electron.launch({
    executablePath: executable,
    args: ["--start-hidden"],
    env: environment,
    timeout: 30000,
  });
  const page = await app.firstWindow();
  // Windows can stop animation-frame delivery to a hidden packaged window even
  // with stable layout. Exercise the real visible renderer in this isolated
  // verification profile; normal application background behavior is unchanged.
  await app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    window.webContents.setBackgroundThrottling(false);
    window.show();
    window.focus();
  });
  await expect(
    page.getByRole("heading", { name: "Your learning", exact: true }),
  ).toBeVisible({ timeout: 30000 });
  return page;
}
async function openLesson(page) {
  await page
    .getByRole("navigation", { name: "Main navigation", exact: true })
    .getByRole("button", { name: "Learning workspace: Lesson", exact: true })
    .click();
  await expect(page.locator(".lesson-top h1")).toBeVisible();
}
async function openLearningTool(page, name) {
  const menu = page.locator("details.studio-tools-menu");
  if ((await menu.getAttribute("open")) === null)
    await menu.locator(":scope > summary").click();
  await page.getByRole("menuitem", { name, exact: true }).click();
}
async function waitForSaved(page, predicate) {
  for (let n = 0; n < 100; n++) {
    const value = await page.evaluate(() => window.studio.invoke("data:load"));
    if (predicate(value)) return value;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("Packaged SQLite save was not observed.");
}
try {
  let page = await launch();
  assert.equal(await app.evaluate(({ app }) => app.isPackaged), true);
  await page.keyboard.press("Control+n");
  const newSession = page.getByRole("dialog", {
    name: "New learning session",
    exact: true,
  });
  await expect(newSession).toBeVisible();
  await newSession
    .getByLabel("Learning goal", { exact: true })
    .fill("Understand how people learn");
  await newSession
    .getByRole("button", { name: "Create learning session", exact: true })
    .click();
  await expect(newSession).toHaveCount(0);
  await expect(page.locator(".lesson-top h1")).toHaveText(
    "Understand how people learn",
  );
  await page.getByRole("button", { name: "Notes", exact: true }).click();
  await page
    .getByLabel("Session notes")
    .fill("Packaged application save and restart verification.");
  const saved = await waitForSaved(page, (d) =>
    d.lessons[0]?.notes.includes("Packaged application"),
  );
  const id = saved.activeLessonId;
  await app.close();
  app = undefined;
  page = await launch();
  await openLesson(page);
  const restored = await page.evaluate(() => window.studio.invoke("data:load"));
  assert.equal(restored.activeLessonId, id);
  assert.equal(restored.lessons[0].notes, saved.lessons[0].notes);
  assert.equal(await page.locator(".laboratory,.visual-lab").count(), 0);
  // Verify a real calculated figure authored explicitly in a subject notebook.
  const authorSubject = await page.evaluate(() =>
    window.studio.invoke("subject:create", {
      name: "Packaged figure authoring",
      objective: "Inspect explicitly authored calculated figures",
      depth: "overview",
    }),
  );
  await page
    .locator(".main-nav")
    .getByRole("button", {
      name: "Subject workspaces: My learning",
      exact: true,
    })
    .click();
  await page
    .locator(".subject-tile")
    .filter({ hasText: authorSubject.name })
    .click();
  await openLearningTool(page, "Visual notebook");
  await page
    .getByRole("button", { name: "Author a figure", exact: true })
    .click();
  await page.getByRole("tab", { name: "Plots", exact: true }).click();
  await page
    .getByLabel("Mathematical model", { exact: true })
    .selectOption("wave");
  await page.locator(".plot-canvas .main-svg").first().waitFor();
  const canvas = createCanvas(1400, 280),
    context = canvas.getContext("2d");
  context.fillStyle = "white";
  context.fillRect(0, 0, 1400, 280);
  context.fillStyle = "black";
  context.font = "64px Arial";
  context.fillText("SCIENCE CONNECTS IDEAS", 40, 150);
  const scan = join(directory, "scan.png"),
    pdf = join(directory, "scanned.pdf");
  await writeFile(scan, canvas.toBuffer("image/png"));
  await writeFile(pdf, scanPdf(canvas.toBuffer("image/jpeg")));
  let importedPdf;
  for (const path of [scan, pdf]) {
    await app.evaluate(({ dialog }, path) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [path],
      });
    }, path);
    const document = await page.evaluate(() =>
      window.studio.invoke("library:import"),
    );
    assert.ok(
      document.content.toUpperCase().includes("SCIENCE CONNECTS IDEAS"),
      "Packaged offline OCR must recognize the real scan",
    );
    assert.ok(
      document.figures.length > 0,
      "Imported images must retain their source figure",
    );
    if (path === pdf) importedPdf = document;
  }
  const chemical = await page.evaluate(() =>
    window.studio.invoke("chemistry:render", {
      input: "CCO",
      format: "smiles",
      theme: { background: "#293128", text: "#e1e8d9" },
    }),
  );
  assert.equal(chemical.atoms, 3);
  assert.ok(chemical.svg.includes("<svg"));
  const v2 = await page.evaluate(async (importedPdf) => {
    const api = window.studio.invoke;
    const subject = await api("subject:create", {
      name: "Packaged subject",
      objective: "Explore conservation and system boundaries",
      depth: "comprehensive",
    });
    const lesson = await api("subject:conversation-create", {
      subjectId: subject.id,
      title: "A portable scientific lesson",
      mode: "Learn",
    });
    const now = new Date().toISOString(),
      data = await api("data:load");
    data.lessons = data.lessons.map((item) =>
      item.id === lesson.id
        ? {
            ...item,
            notes: "PRIVATE_PACKAGE_NOTE_SENTINEL",
            messages: [
              {
                id: "package-v2-message",
                role: "assistant",
                text: "A scientific explanation with a real calculated plot.",
                status: "complete",
                createdAt: now,
                blocks: [
                  { type: "equation", latex: "E=mc^2" },
                  {
                    type: "plot",
                    spec: {
                      kind: "wave",
                      title: "Packaged calculated wave",
                      parameters: { amplitude: 1.6 },
                    },
                  },
                  {
                    type: "exercise",
                    question: "What is 2+2?",
                    hint: "Add two equal pairs.",
                    answer: "4",
                  },
                ],
              },
            ],
          }
        : item,
    );
    data.activeLessonId = lesson.id;
    data.activeSubjectId = subject.id;
    data.library.push({
      ...importedPdf,
      id: "packaged-pdf",
      kind: "document",
      subjectId: subject.id,
      subject: subject.name,
      createdAt: now,
    });
    await api("data:save", data);
    const current = await api("subject:get", { subjectId: subject.id });
    await api("subject:apply", {
      subjectId: subject.id,
      baseRevision: current.subject.revision,
      label: "Packaged shared finding",
      origin: "learner",
      operations: [
        {
          entity: "memory",
          op: "put",
          id: "packaged-finding",
          value: {
            kind: "finding",
            title: "System boundaries",
            content: "Include exchanges across the chosen system boundary.",
            conceptIds: [],
            conversationId: lesson.id,
            messageId: "package-v2-message",
          },
        },
      ],
    });
    return { subjectId: subject.id, lessonId: lesson.id };
  }, importedPdf);
  await page.reload();
  await openLesson(page);
  await expect(
    page.locator("[data-visual-host] .plot-canvas .main-svg").first(),
  ).toBeVisible();
  await expect(page.locator(".reading-column .katex").first()).toBeVisible();
  const shared = await page.evaluate(
    (subjectId) =>
      window.studio.invoke("subject:context", {
        subjectId,
        query: "System boundaries",
        tokenBudget: 1000,
      }),
    v2.subjectId,
  );
  assert.ok(JSON.stringify(shared).includes("exchanges across"));
  assert.ok(shared.usage.estimatedTokens <= 1000);
  const upgraded = await page.evaluate(async ({ subjectId, lessonId }) => {
    const api = window.studio.invoke;
    const preferences = {
      delivery: "visual-first",
      practice: "mcq",
      checkFrequency: "topic-end",
      sentenceStyle: "clean",
      avoidEmDashes: true,
    };
    await api("learning:intake-put", {
      subjectId,
      status: "skipped",
      goal: "Inspect packaged scientific teaching",
      depth: "overview",
      preferences,
    });
    const data = await api("data:load"),
      lesson = data.lessons.find((item) => item.id === lessonId);
    lesson.messages.push({
      id: "package-v21-message",
      role: "assistant",
      text: "A compact scientific teaching unit.",
      createdAt: new Date().toISOString(),
      status: "complete",
      content: [
        { type: "text", text: "A compact scientific teaching unit." },
        {
          type: "terms",
          items: [
            {
              term: "tRNA",
              definition:
                "Transfer RNA carries an amino acid and pairs with a complementary codon.",
            },
          ],
        },
        {
          type: "illustration",
          spec: {
            template: "translation",
            title: "Packaged translation illustration",
          },
        },
        {
          type: "mcq",
          question: "Which RNA carries the corresponding amino acid?",
          choices: [
            { id: "a", text: "tRNA" },
            { id: "b", text: "DNA" },
          ],
          correctChoiceIds: ["a"],
          allowUnknown: true,
        },
      ],
    });
    await api("data:save", data);
    const grade = await api("checks:submit", {
      conversationId: lessonId,
      messageId: "package-v21-message",
      blockIndex: 3,
      selectedIds: ["a"],
      requestId: "package-checkpoint",
    });
    await api("annotations:create", {
      subjectId,
      sourceKind: "message",
      sourceId: "package-v21-message",
      conversationId: lessonId,
      quote: "A compact scientific teaching unit.",
      prefix: "",
      suffix: "",
      color: "blue",
      note: "PRIVATE_PACKAGE_ANNOTATION_SENTINEL",
      tags: ["packaged"],
    });
    try {
      await api("planning:start", { subjectId, model: "not-connected" });
    } catch {
      /* A disconnected planning failure must be durable. */
    }
    const jobs = await api("planning:list", { subjectId });
    const zoom = await api("app:zoom", { direction: "in" });
    return { grade, jobs, zoom };
  }, v2);
  assert.equal(upgraded.grade.correct, true);
  assert.equal(upgraded.grade.mastery, false);
  assert.ok(upgraded.jobs.some((job) => job.status === "failed"));
  assert.equal(upgraded.zoom, 1.1);
  await page.reload();
  await openLesson(page);
  await page
    .getByLabel("Choose a lesson section", { exact: true })
    .selectOption("package-v21-message");
  const illustration = page.getByRole("region", {
    name: "Packaged translation illustration",
    exact: true,
  });
  await expect(illustration.locator(".translation-svg")).toBeVisible();
  await illustration
    .getByRole("button", { name: "Next step", exact: true })
    .click();
  await expect(
    illustration.locator(".science-step-controls output"),
  ).toHaveText("Step 2 of 3");
  await illustration
    .getByRole("button", { name: "Inspect tRNA", exact: true })
    .first()
    .focus();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("dialog", { name: "tRNA: an adaptor", exact: true }),
  ).toContainText("tRNA: an adaptor");
  await page.keyboard.press("Escape");
  const figureFit = await illustration
    .locator(".translation-svg")
    .evaluate((svg) => ({
      width: svg.getBoundingClientRect().width,
      viewport: svg.closest(".science-viewport").getBoundingClientRect().width,
    }));
  assert.ok(figureFit.width <= figureFit.viewport + 1);
  assert.equal(await page.locator(".laboratory,.visual-lab").count(), 0);
  const output = join(directory, "packaged-textbook.html");
  await app.evaluate(({ dialog }, path) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: path });
  }, output);
  const exported = await page.evaluate(
    (ids) =>
      window.studio.invoke("export:html", {
        title: "Packaged portable textbook",
        subjectId: ids.subjectId,
        lessonIds: [ids.lessonId],
        chapterIds: [],
        scope: "selection",
        includeNotes: false,
        includeUserMessages: false,
        embedCachedResources: true,
      }),
    v2,
  );
  assert.equal(exported.format, "html");
  const html = await readFile(output, "utf8");
  assert.ok(!html.includes("PRIVATE_PACKAGE_NOTE_SENTINEL"));
  assert.ok(!html.includes("PRIVATE_PACKAGE_ANNOTATION_SENTINEL"));
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    const context = await browser.newContext();
    await context.setOffline(true);
    const offline = await context.newPage();
    await offline.goto(new URL("file:///" + output.replace(/\\/g, "/")).href);
    await expect(offline.locator(".offline-book")).toBeVisible();
    await expect(offline.locator(".katex").first()).toBeVisible();
    await expect(
      offline.locator(".plot-canvas .main-svg").first(),
    ).toBeVisible();
    await offline
      .getByRole("button", { name: "Show explanation", exact: true })
      .click();
    await expect(offline.getByText("4", { exact: true }).first()).toBeVisible();
  } finally {
    await browser.close();
  }
  await page
    .locator(".subject-chat-banner")
    .getByRole("button", { name: "Packaged subject", exact: true })
    .click();
  await page.getByRole("button", { name: /^Study a document/ }).click();
  await page
    .getByLabel("Study document", { exact: true })
    .selectOption("packaged-pdf");
  await page.getByRole("button", { name: "Original PDF", exact: true }).click();
  await expect(
    page.getByRole("img", { name: "Original PDF page 1", exact: true }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("region", { name: "Original PDF document", exact: true })
      .getByRole("alert"),
  ).toHaveCount(0);
  const sourceGuide = await page.evaluate(async ({ subjectId }) => {
    const api = window.studio.invoke;
    const prepared = await api("study-sources:prepare", {
      subjectId,
      kind: "curriculum",
      title: "Packaged reviewed source",
      text: "# Module 1: Measurement\n\n## Topic 1: System boundaries\nChoose the system boundary before reasoning about exchanges.\n\n## Topic 2: Conservation\nCompare inputs, outputs and changes in the system.",
    });
    const saved = await api("study-sources:save", { ...prepared, subjectId });
    const adopted = await api("study-sources:adopt", {
      subjectId,
      sourceId: saved.id,
    });
    return {
      id: saved.id,
      entries: saved.entries.length,
      mappings: adopted.mappings.length,
      nodeIds: adopted.nodeIds,
    };
  }, v2);
  assert.ok(sourceGuide.entries >= 3);
  assert.equal(sourceGuide.mappings, sourceGuide.entries);
  // Hydrate the just-created canonical document before the renderer closes.
  await page.reload();
  await openLesson(page);
  await app.close();
  app = undefined;
  page = await launch();
  await openLesson(page);
  const persistedSubject = await page.evaluate(
    (subjectId) => window.studio.invoke("subject:get", { subjectId }),
    v2.subjectId,
  );
  assert.ok(
    persistedSubject.memory.some((memory) => memory.id === "packaged-finding"),
  );
  assert.ok(
    persistedSubject.memory.some(
      (memory) => memory.messageId === "package-v21-message",
    ),
  );
  const restoredUpgrade = await page.evaluate(
    async ({ subjectId }) => ({
      intake: await window.studio.invoke("learning:intake-get", { subjectId }),
      highlights: await window.studio.invoke("annotations:list", { subjectId }),
      jobs: await window.studio.invoke("planning:list", { subjectId }),
      zoom: await window.studio.invoke("app:zoom", { direction: "get" }),
    }),
    v2,
  );
  assert.equal(restoredUpgrade.intake.preferences.delivery, "visual-first");
  assert.ok(
    restoredUpgrade.highlights.some(
      (item) =>
        item.color === "blue" && item.sourceId === "package-v21-message",
    ),
  );
  assert.ok(restoredUpgrade.jobs.some((job) => job.status === "failed"));
  assert.equal(restoredUpgrade.zoom, 1.1);
  const restoredGuide = await page.evaluate(
    async ({ subjectId }) => ({
      sources: await window.studio.invoke("study-sources:list", { subjectId }),
      context: await window.studio.invoke("study-sources:context", {
        subjectId,
        query: "system boundaries",
        budget: 1000,
      }),
      state: await window.studio.invoke("subject:get", { subjectId }),
    }),
    v2,
  );
  assert.ok(
    restoredGuide.sources.some((source) => source.id === sourceGuide.id),
  );
  assert.ok(restoredGuide.context.usage.estimatedTokens <= 1000);
  assert.equal(restoredGuide.context.usage.fullSourceIncluded, false);
  const restoredSourceNodes = restoredGuide.state.curriculum.filter((node) =>
    sourceGuide.nodeIds.includes(node.id),
  );
  assert.equal(restoredSourceNodes.length, sourceGuide.entries);
  assert.ok(restoredSourceNodes.every((node) => node.status === "not-started"));
  const sourceUrl = await page.evaluate(() =>
    window.studio.invoke("documents:pdf-url", { resourceId: "packaged-pdf" }),
  );
  assert.ok(
    Buffer.from(sourceUrl.split(",")[1], "base64").equals(await readFile(pdf)),
  );
  const diagnostics = await page.evaluate(() =>
    window.studio.invoke("app:diagnostics"),
  );
  const receipt = {
    verifiedAt: new Date().toISOString(),
    executable,
    packaged: true,
    renderingMode:
      "Visible isolated verification window; normal app rendering unchanged",
    sqliteRestart: true,
    plotRendered: true,
    inlineOnlyLessonFigures: true,
    interactiveTranslationAndFit: true,
    offlineImageOcr: true,
    scannedPdfOcrAndFigureExtraction: true,
    localRdkit: true,
    subjectMemoryAndRestart: true,
    measuredContextBudget: true,
    packagedInteractiveHtmlOpensOffline: true,
    packagedPdfJsCanvas: true,
    pdfOriginalSurvivesSqliteRestart: true,
    diagnostics,
    installerExecution:
      "Not installed globally; unpacked packaged executable verified",
    version: JSON.parse(await readFile("package.json", "utf8")).version,
    structuredIntake: true,
    canonicalMcqAndSharedMemory: true,
    persistentHighlights: true,
    durableDisconnectedPlanningFailure: true,
    installationZoom: true,
    reviewedSourceGuideAndRestart: true,
    liveChatGPT:
      "This verification profile stays disconnected; fresh live-model quality and latency were not tested.",
  };
  const reportPrefix = process.env.STUDIO_REPORT_PREFIX || "";
  assert.match(reportPrefix, /^[a-zA-Z0-9-]*$/);
  await writeFile(
    `docs/${reportPrefix}packaged-smoke-result.json`,
    JSON.stringify(receipt, null, 2),
  );
  process.stdout.write(
    "Packaged Windows: SQLite/subject restart, teaching checkpoints, highlights, durable planning failure, zoom, measured memory, ordinary offline HTML, PDF.js, Plotly, OCR/figures, and RDKit PASS.\n",
  );
} finally {
  await app?.close();
  const target = resolve(directory),
    root = resolve(".");
  if (target.startsWith(root + sep) && target.includes(".package-smoke-"))
    await rm(target, { recursive: true, force: true });
}
