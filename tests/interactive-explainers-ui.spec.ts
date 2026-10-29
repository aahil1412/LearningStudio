import {
  test,
  expect,
  _electron as electron,
  chromium,
  type ElectronApplication,
  type Locator,
  type Page,
} from "@playwright/test";
import { build } from "esbuild";
import {
  appendFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { ContentBlock, Lesson, StudioData } from "../src/types";
import type { Subject, SubjectRecord, VisualInstance } from "../src/v2types";
import {
  circuitExperiment,
  equilibriumExperiment,
} from "../src/lib/explainers/examples";
import { sanitizeAppearance } from "../src/lib/themes";
import {
  openReadingControls,
  openTutor,
  openDestination,
} from "./ui-navigation";

// Real Windows Electron renderer, preload, IPC, SQLite and offline exporter.
// The one transport test explicitly injects a controlled response adapter into
// the production request service. It is not a claim of live model quality.
let app: ElectronApplication, page: Page, directory: string;
let rendererErrors: string[];
let electronVersion = "not launched";
const receipts: {
  title: string;
  status: string | undefined;
  expectedStatus: string;
  durationMs: number;
  errors: string[];
}[] = [];
const screenshots = "docs/screenshots/interactive-explainers";
const geneBlock: ContentBlock = {
  type: "illustration",
  spec: {
    template: "gene-expression-lab",
    title: "From a DNA message to an amino-acid chain",
  },
};
const optimizationBlock: ContentBlock = {
  type: "illustration",
  spec: {
    template: "optimization-lab",
    title: "Follow calculated gradient descent",
    optimization: {
      landscape: "quadratic",
      start: [-3, 2.5],
      learningRate: 0.18,
      iterations: 120,
    },
  },
};
const call = <T = unknown>(action: string, payload?: unknown) =>
  page.evaluate(
    ({ action, payload }) => window.studio!.invoke<T>(action, payload),
    { action, payload },
  );

async function launch() {
  const env = Object.fromEntries(
    Object.entries({ ...process.env, STUDIO_DATA_DIR: directory }).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.STUDIO_DEV_URL;
  app = await electron.launch({
    ...(process.env.STUDIO_TEST_EXECUTABLE
      ? { executablePath: process.env.STUDIO_TEST_EXECUTABLE }
      : {}),
    args: [
      ...(process.env.STUDIO_TEST_EXECUTABLE ? [] : ["."]),
      "--start-hidden",
    ],
    cwd: process.cwd(),
    env,
  });
  page = await app.firstWindow();
  electronVersion = await app.evaluate(() => process.versions.electron);
  page.on("pageerror", (error) => rendererErrors.push(error.message));
  await app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    window.setContentSize(1480, 1120);
    window.webContents.setBackgroundThrottling(false);
  });
  await expect(page.locator(".titlebar-center")).toHaveText("Saved locally");
  const foreground = !!process.env.STUDIO_TEST_EXECUTABLE;
  if (foreground)
    await app.evaluate(({ BrowserWindow }) => {
      const owned = BrowserWindow.getAllWindows()[0];
      owned.show();
      owned.focus();
    });
  const countFrames = () =>
    page.evaluate(async () => {
      let frames = 0,
        frame = 0;
      const tick = () => {
        frames++;
        frame = requestAnimationFrame(tick);
      };
      frame = requestAnimationFrame(tick);
      await new Promise((resolve) => setTimeout(resolve, 300));
      cancelAnimationFrame(frame);
      return frames;
    });
  const initialFrames = await countFrames();
  let frames = initialFrames;
  if (frames === 0) {
    await app.evaluate(({ BrowserWindow }) => {
      const owned = BrowserWindow.getAllWindows()[0];
      owned.show();
      owned.focus();
    });
    for (let attempt = 0; attempt < 3 && frames === 0; attempt++)
      frames = await countFrames();
  }
  await appendFile(
    "docs/v23-launch-frame-diagnostics.jsonl",
    JSON.stringify({
      packaged: !!process.env.STUDIO_TEST_EXECUTABLE,
      flag: null,
      foregroundRequested: foreground,
      initialFrames,
      shownForeground: foreground || initialFrames === 0,
      frames,
    }) + "\n",
  );
  expect(
    frames,
    "The owned automation window must deliver actual renderer frames",
  ).toBeGreaterThan(0);
}

async function seed(
  blocks: ContentBlock[],
  title = "An inline scientific lesson",
) {
  const subject = await call<Subject>("subject:create", {
    name: "Interactive scientific learning",
    objective:
      "Understand mechanisms by changing inputs and comparing calculated outcomes",
    depth: "comprehensive",
  });
  const lesson = await call<Lesson>("subject:conversation-create", {
    subjectId: subject.id,
    title,
    mode: "Learn",
  });
  const data = await call<StudioData>("data:load");
  await call("data:save", {
    ...data,
    activeSubjectId: subject.id,
    activeLessonId: lesson.id,
    settings: {
      ...data.settings,
      labOpen: false,
      visualizationPlacement: "inline",
      personalization: false,
      teaching: {
        delivery: "visual-first",
        practice: "mcq",
        checkFrequency: "requested",
        sentenceStyle: "clean",
        avoidEmDashes: true,
      },
      models: {
        tutor: { model: "explainer-fixture", reasoning: "low" },
        visual: { model: "explainer-fixture", reasoning: "low" },
        review: { model: "explainer-fixture", reasoning: "low" },
      },
    },
    lessons: data.lessons.map((item) =>
      item.id === lesson.id
        ? {
            ...item,
            notes: "PRIVATE_NOTE_NOT_SELECTED_FOR_EXPORT",
            messages: blocks.length
              ? [
                  {
                    id: "explainer-acceptance-message",
                    role: "assistant",
                    text: "",
                    content: [
                      {
                        type: "text",
                        text: "## Change something and compare the result\n\nThese trusted lesson models calculate their output from the displayed inputs. A schematic position is not a measured molecular coordinate.",
                      },
                      ...blocks,
                      {
                        type: "text",
                        text: "Return to the original inputs to compare. Exploring a figure does not itself demonstrate understanding.",
                      },
                    ],
                    status: "complete",
                    createdAt: new Date().toISOString(),
                  },
                ]
              : [],
          }
        : item,
    ),
  });
  await page.reload();
  await openDestination(page, "Learning workspace: Lesson");
  await expect(page.locator(".lesson-top h1")).toHaveText(title);
  return { subject, lesson };
}

function noSideLab() {
  return expect(
    page.locator(
      ".laboratory,.visual-lab,[data-visual-dock=side],[data-visual-dock=split]",
    ),
  ).toHaveCount(0);
}
async function captureScientific(view: Locator, path: string) {
  // A tall whole-lab crop includes the sticky app chrome. Capture the actual
  // scientific surface and keep a separate normal-viewport context image.
  await view.evaluate((element) =>
    element.scrollIntoView({
      behavior: "instant",
      block: "center",
      inline: "nearest",
    }),
  );
  const measure = () =>
    view.evaluate(async (element) => {
      let frames = 0,
        frame = 0;
      const tick = () => {
        frames++;
        frame = requestAnimationFrame(tick);
      };
      frame = requestAnimationFrame(tick);
      const samples = [];
      for (let index = 0; index < 4; index++) {
        const rect = element.getBoundingClientRect();
        samples.push({
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height,
          scrollTop: element.closest(".lesson-reader")?.scrollTop || 0,
        });
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      cancelAnimationFrame(frame);
      return { frames, visibility: document.visibilityState, samples };
    });
  let shift = Infinity;
  for (let attempt = 0; attempt < 5; attempt++) {
    const diagnostic = await measure();
    const initial = diagnostic.samples[0];
    shift = Math.max(
      ...diagnostic.samples.flatMap((sample) =>
        ["x", "y", "width", "height", "scrollTop"].map((key) =>
          Math.abs(
            sample[key as keyof typeof sample] -
              initial[key as keyof typeof initial],
          ),
        ),
      ),
    );
    await appendFile(
      "docs/v23-capture-diagnostics.jsonl",
      JSON.stringify({
        path,
        packaged: !!process.env.STUDIO_TEST_EXECUTABLE,
        attempt,
        shift,
        ...diagnostic,
      }) + "\n",
    );
    if (shift <= 0.5) break;
    // Theme/session restoration can finish its one delayed scroll after load.
    // Reposition and require a fresh stable interval, rather than capturing it.
    await view.evaluate((element) =>
      element.scrollIntoView({
        behavior: "instant",
        block: "center",
        inline: "nearest",
      }),
    );
  }
  expect(
    shift,
    "Scientific capture geometry must be stable across timer samples",
  ).toBeLessThanOrEqual(0.5);
  const box = (await view.boundingBox())!;
  const viewport = await view
    .page()
    .evaluate(() => ({ width: innerWidth, height: innerHeight }));
  expect(box.x).toBeGreaterThanOrEqual(-1);
  expect(box.y).toBeGreaterThanOrEqual(-1);
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
  expect(box.y + box.height).toBeLessThanOrEqual(viewport.height + 1);
  // A hidden Windows compositor can stop rAF while timer-measured geometry is
  // stable. Capture the verified bounds directly instead of waiting on rAF.
  await view.page().screenshot({ path, clip: box, animations: "disabled" });
}
async function expectResolvedSurfaceColors(lab: Locator) {
  const renderer = lab.locator(".optimization-3d-canvas");
  await expect(renderer).toHaveAttribute("data-surface-colors", /^\[/);
  const colors = JSON.parse(
    (await renderer.getAttribute("data-surface-colors"))!,
  ) as string[];
  expect(colors).toHaveLength(2);
  expect(new Set(colors).size).toBe(2);
  for (const color of colors) {
    expect(color.toLowerCase()).not.toMatch(/^#?(ffffff|000000)$/);
    const channels = color
      .replace(/^#/, "")
      .match(/../g)!
      .map((value) => parseInt(value, 16));
    expect(Math.max(...channels) - Math.min(...channels)).toBeGreaterThan(15);
  }
  return colors;
}
async function savedVisual(subjectId: string, template: string) {
  const records = await call<SubjectRecord<VisualInstance>[]>(
    "subject:record-list",
    {
      subjectId,
      recordType: "visual",
      includeData: true,
    },
  );
  return records
    .map((record) => record.data)
    .find(
      (instance) =>
        instance.block.type === "illustration" &&
        instance.block.spec.template === template,
    );
}
async function flush() {
  await page.evaluate(() =>
    window.dispatchEvent(new Event("studio:flush-visuals")),
  );
  await expect(page.locator(".titlebar-center")).toHaveText("Saved locally");
}
async function mutate(
  lab: Locator,
  kind: string,
  position: number,
  base = "C",
) {
  await lab.getByLabel("Mutation type", { exact: true }).selectOption(kind);
  await lab
    .getByLabel("Mutation position", { exact: true })
    .fill(String(position));
  if (kind !== "deletion")
    await lab.getByLabel("Mutation base", { exact: true }).selectOption(base);
  await lab
    .getByRole("button", { name: "Apply mutation", exact: true })
    .click();
}
async function setTheme(mode: "light" | "dark", custom = false) {
  const data = await call<StudioData>("data:load");
  const appearance = sanitizeAppearance(data.appearance);
  appearance.mode = mode;
  appearance.editing = mode;
  if (custom) {
    appearance[mode].colors.figure = "#192c40";
    appearance[mode].colors.text = "#f1e9db";
    appearance[mode].colors.secondary = "#d6dfe7";
    appearance[mode].colors.caption = "#c3d0dd";
  }
  await call("data:save", { ...data, appearance });
  await page.reload();
  await openDestination(page, "Learning workspace: Lesson");
  await page.evaluate(() => document.fonts.ready);
}

test.beforeEach(async () => {
  rendererErrors = [];
  await mkdir(".tools", { recursive: true });
  await mkdir(screenshots, { recursive: true });
  directory = await mkdtemp(
    join(resolve(".tools"), "interactive-explainers-native-"),
  );
  await launch();
});
test.afterEach(async () => {
  await app
    ?.evaluate(() =>
      (globalThis as any).explainerFixture?.service.cancelAll(
        "Acceptance fixture closing",
      ),
    )
    .catch(() => {});
  await app?.close().catch(() => {});
  if (
    !resolve(directory).startsWith(
      join(resolve(".tools"), "interactive-explainers-native-"),
    )
  )
    throw new Error("Refusing to remove an unexpected acceptance profile.");
  await rm(directory, {
    recursive: true,
    force: true,
    maxRetries: 8,
    retryDelay: 200,
  });
  const info = test.info();
  const receiptPath = process.env.STUDIO_TEST_EXECUTABLE
    ? "docs/v23-interactive-packaged-results.json"
    : "docs/v23-interactive-native-results.json";
  const earlier = await readFile(receiptPath, "utf8")
    .then((value) => JSON.parse(value).results as typeof receipts)
    .catch(() => []);
  const current = {
    title: info.title,
    status: info.status,
    expectedStatus: info.expectedStatus,
    durationMs: info.duration,
    errors: info.errors.map((error) =>
      (error.message || String(error)).slice(0, 3500),
    ),
  };
  receipts.splice(
    0,
    receipts.length,
    ...earlier.filter((result) => result.title !== current.title),
  );
  receipts.push(current);
  await writeFile(
    receiptPath,
    JSON.stringify(
      {
        capturedAt: new Date().toISOString(),
        appVersion: "2.3.0",
        platform: process.platform,
        electron: electronVersion,
        executable: process.env.STUDIO_TEST_EXECUTABLE
          ? "packaged application"
          : "development Electron production build",
        profile: "isolated synthetic acceptance profiles",
        liveConnectedModelTested: false,
        providerTransport:
          "Controlled prose-only fixture only in the explicitly named tutoring-pipeline test",
        results: receipts,
      },
      null,
      2,
    ) + "\n",
  );
});

test("the real welcome lesson opens a paused inline mechanism and DNA edits change actual RNA and protein", async () => {
  test.setTimeout(120000);
  await page
    .getByRole("button", { name: "Explore DNA, RNA and protein" })
    .click();
  const lab = page.locator('[data-explainer="gene-expression"]');
  await expect(lab).toBeVisible();
  await noSideLab();
  const position = lab.getByRole("slider", {
    name: "Gene process position",
    exact: true,
  });
  await expect(position).toHaveValue("0");
  await expect(
    lab.getByRole("button", { name: "Play process", exact: true }),
  ).toBeVisible();
  const polymerase = lab.locator(".gene-polymerase");
  const before = await polymerase.getAttribute("transform");
  await lab.getByRole("button", { name: "Step", exact: true }).click();
  await expect(position).toHaveValue("1");
  await expect(polymerase).not.toHaveAttribute("transform", before!);
  await expect(lab.locator(".gene-rna-base")).toHaveCount(1);
  await lab
    .getByRole("button", { name: "Inspect RNA polymerase", exact: true })
    .click();
  const inspector = page.getByRole("dialog", {
    name: "RNA polymerase",
    exact: true,
  });
  await expect(inspector).toBeVisible();
  const rect = (await inspector.boundingBox())!;
  expect(rect.y).toBeGreaterThanOrEqual(0);
  expect(rect.y + rect.height).toBeLessThanOrEqual(1120);
  await page.keyboard.press("Escape");
  await lab
    .getByRole("button", { name: "2. Build an amino-acid chain", exact: true })
    .click();
  await expect(lab.locator(".gene-trna")).toBeVisible();
  expect(
    (await lab.locator(".gene-anticodon").allTextContents()).join(" "),
  ).toContain("U A C");
  await lab.getByRole("button", { name: "Step", exact: true }).click();
  await expect(lab.locator(".gene-amino")).toHaveCount(2);
  await captureScientific(
    lab.locator(".gene-canvas-wrap"),
    `${screenshots}/gene-expression-translation-light.png`,
  );
  await page.screenshot({
    path: `${screenshots}/gene-expression-lesson-context.png`,
  });

  await expect(lab.locator("[data-gene-reference-rna]")).toHaveText(
    "AUGGCUUUUGAAUAA",
  );
  await expect(lab.locator("[data-gene-reference-peptide]")).toHaveText(
    "Met · Ala · Phe · Glu",
  );
  await mutate(lab, "substitution", 6, "C");
  await expect(lab.locator("[data-mutation-effect]")).toHaveAttribute(
    "data-mutation-effect",
    "synonymous",
  );
  await expect(lab.locator("[data-gene-current-rna]")).toHaveText(
    "AUGGCCUUUGAAUAA",
  );
  await expect(lab.locator("[data-gene-current-peptide]")).toHaveText(
    "Met · Ala · Phe · Glu",
  );
  await mutate(lab, "substitution", 5, "T");
  await expect(lab.locator("[data-mutation-effect]")).toHaveAttribute(
    "data-mutation-effect",
    "missense",
  );
  await expect(lab.locator("[data-gene-current-peptide]")).toHaveText(
    "Met · Val · Phe · Glu",
  );
  await mutate(lab, "substitution", 10, "T");
  await expect(lab.locator("[data-mutation-effect]")).toHaveAttribute(
    "data-mutation-effect",
    "nonsense",
  );
  await expect(lab.locator("[data-gene-current-peptide]")).toHaveText(
    "Met · Ala · Phe",
  );
  await mutate(lab, "insertion", 7, "C");
  await expect(lab.locator("[data-mutation-effect]")).toHaveAttribute(
    "data-mutation-effect",
    "frameshift",
  );
  await expect(lab.locator("[data-gene-current-rna]")).toHaveText(
    "AUGGCUCUUUGAAUAA",
  );
  await expect(lab.locator("[data-gene-current-peptide]")).toHaveText(
    "Met · Ala · Leu",
  );
  await captureScientific(
    lab.locator(".gene-canvas-wrap"),
    `${screenshots}/gene-expression-mutation-light.png`,
  );
  await captureScientific(
    lab.locator(".gene-comparison"),
    `${screenshots}/gene-expression-mutation-readouts.png`,
  );
  await mutate(lab, "deletion", 1);
  await expect(lab.locator("[data-mutation-effect]")).toHaveAttribute(
    "data-mutation-effect",
    "start-loss",
  );
  await expect(lab.locator("[data-gene-current-peptide]")).toHaveText(
    "No start",
  );
  await lab
    .getByRole("button", { name: "Restore original", exact: true })
    .click();
  await expect(position).toHaveValue("0");
  await expect(
    lab.getByRole("button", { name: "Play process", exact: true }),
  ).toBeVisible();
  await lab.locator(".gene-sequence-editor > summary").click();
  const longDna = "ATG" + "GCT".repeat(12) + "TAA" + "GCT".repeat(3);
  await lab.getByLabel("Coding DNA sequence", { exact: true }).fill(longDna);
  await lab.getByRole("button", { name: "Use sequence", exact: true }).click();
  await lab
    .getByRole("slider", { name: "Gene process position", exact: true })
    .fill(String(longDna.length + 6));
  await expect(lab.locator(".gene-svg")).toContainText(
    "Computed sequence; chain attachment not shown.",
  );
  await expect(lab.locator(".gene-svg")).toContainText("…");
  const chainBottom = await lab
    .locator(".gene-svg .gene-amino")
    .first()
    .evaluate((element) => element.getBoundingClientRect().bottom);
  const adaptorTop = await lab
    .locator(".gene-trna")
    .evaluate((element) => element.getBoundingClientRect().top);
  expect(chainBottom).toBeLessThan(adaptorTop);
  await captureScientific(
    lab.locator(".gene-canvas-wrap"),
    `${screenshots}/gene-expression-long-sequence.png`,
  );
  expect(rendererErrors).toEqual([]);
});

test("calculated descent, direct manipulation and real 3D camera retain the same figure through fullscreen and application restart", async () => {
  test.setTimeout(150000);
  const { subject, lesson } = await seed([optimizationBlock]);
  const lab = page.locator(".optimization-lab");
  await expect(lab).toBeVisible();
  await noSideLab();
  const rate = lab.getByRole("slider", {
    name: "Optimization learning rate",
    exact: true,
  });
  await expect(rate).toHaveValue("0.18");
  await expect(
    lab.getByRole("button", { name: "Play updates", exact: true }),
  ).toBeVisible();
  await lab.getByRole("button", { name: "Take one step", exact: true }).click();
  await expect(lab.getByTestId("optimization-position")).toHaveText(
    "(-2.46, 0.7)",
  );
  await expect(lab.getByTestId("optimization-loss")).toHaveText("4.0058");
  const path = lab.getByTestId("optimization-trajectory");
  const originalPath = await path.getAttribute("d");
  await rate.fill("0.05");
  await lab.getByRole("button", { name: "Take one step", exact: true }).click();
  await expect(lab.getByTestId("optimization-position")).toHaveText(
    "(-2.85, 2)",
  );
  await expect(path).not.toHaveAttribute("d", originalPath!);
  const start = lab.getByRole("button", {
    name: "Move optimization starting point. Use arrow keys or the X and Y controls.",
    exact: true,
  });
  await start.focus();
  await start.press("ArrowRight");
  await expect(
    lab.getByRole("slider", { name: "Optimization starting X", exact: true }),
  ).toHaveValue("-2.9");
  await lab.getByRole("button", { name: "Take one step", exact: true }).click();
  await lab.getByRole("button", { name: "Explore in 3D", exact: true }).click();
  const canvas = lab.locator(".optimization-3d-canvas canvas");
  await expect(canvas).toBeVisible();
  const lightSurfaceColors = await expectResolvedSurfaceColors(lab);
  await expect
    .poll(async () => (await canvas.boundingBox())?.width || 0)
    .toBeGreaterThan(200);
  await flush();
  await expect
    .poll(
      async () =>
        (await savedVisual(subject.id, "optimization-lab"))?.state[
          "optimization.camera"
        ],
    )
    .toBeTruthy();
  const cameraBefore = (await savedVisual(subject.id, "optimization-lab"))!
    .state["optimization.camera"] as {
    position: number[];
    target: number[];
    zoom: number;
  };
  const box = (await canvas.boundingBox())!;
  await canvas.scrollIntoViewIfNeeded();
  const renderedCamera = lab.locator(".optimization-3d-canvas");
  await expect(renderedCamera).toHaveAttribute("data-camera-position", /^\[/);
  const initialCameraAttribute = await renderedCamera.getAttribute(
    "data-camera-position",
  );
  expect(box.width).toBeGreaterThan(200);
  await lab
    .getByRole("button", { name: "Rotate 3D right", exact: true })
    .click();
  await expect(renderedCamera).not.toHaveAttribute(
    "data-camera-position",
    initialCameraAttribute!,
  );
  await lab.getByRole("button", { name: "Zoom in 3D", exact: true }).click();
  await flush();
  await expect
    .poll(
      async () =>
        (await savedVisual(subject.id, "optimization-lab"))?.state[
          "optimization.camera"
        ],
    )
    .not.toEqual(cameraBefore);
  const saved = (await savedVisual(subject.id, "optimization-lab"))!;
  const chosenCamera = saved.state["optimization.camera"] as {
    position: number[];
    zoom: number;
  };
  expect(chosenCamera.zoom).toBeGreaterThan(cameraBefore.zoom);
  expect(chosenCamera.position).not.toEqual(cameraBefore.position);
  const visualHost = page.locator(`[data-visual-host="${saved.id}"]`);
  await visualHost.evaluate((element) => {
    (window as any).__explainerLiveHost = element;
    (window as any).__explainerCanvas = element.querySelector("canvas");
  });
  for (const placement of ["fullscreen", "inline"]) {
    await visualHost
      .getByRole("button", { name: `Move visual ${placement}`, exact: true })
      .click();
    await expect(visualHost).toHaveAttribute("data-placement", placement);
    await expect(rate).toHaveValue("0.05");
    expect(
      await visualHost.evaluate(
        (element) =>
          element === (window as any).__explainerLiveHost &&
          element.querySelector("canvas") === (window as any).__explainerCanvas,
      ),
    ).toBe(true);
  }
  await captureScientific(
    lab.locator(".optimization-chart-scroll"),
    `${screenshots}/gradient-descent-light.png`,
  );
  await captureScientific(
    lab.locator(".optimization-3d"),
    `${screenshots}/gradient-descent-3d-light.png`,
  );
  await flush();
  const positionBeforeRestart = await lab
    .getByTestId("optimization-position")
    .innerText();
  await app.close();
  await launch();
  await openDestination(page, "Learning workspace: Lesson");
  const restoredLab = page.locator(".optimization-lab");
  await expect(page.locator(".lesson-top h1")).toHaveText(lesson.title);
  await expect(
    restoredLab.getByRole("slider", {
      name: "Optimization learning rate",
      exact: true,
    }),
  ).toHaveValue("0.05");
  await expect(restoredLab.getByTestId("optimization-position")).toHaveText(
    positionBeforeRestart,
  );
  await expect(
    restoredLab.locator(".optimization-3d-canvas canvas"),
  ).toBeVisible();
  const expectedCamera = saved.state["optimization.camera"] as {
    position: number[];
    target: number[];
    zoom: number;
  };
  await expect
    .poll(async () => {
      const actual = (await savedVisual(subject.id, "optimization-lab"))?.state[
        "optimization.camera"
      ] as typeof expectedCamera | undefined;
      if (!actual) return Infinity;
      return Math.max(
        ...actual.position.map((value, index) =>
          Math.abs(value - expectedCamera.position[index]),
        ),
        ...actual.target.map((value, index) =>
          Math.abs(value - expectedCamera.target[index]),
        ),
        Math.abs(actual.zoom - expectedCamera.zoom),
      );
    })
    .toBeLessThan(1e-8);
  const restored = await call<StudioData>("data:load");
  expect(restored.lessons.find((item) => item.id === lesson.id)?.notes).toBe(
    "PRIVATE_NOTE_NOT_SELECTED_FOR_EXPORT",
  );
  await setTheme("dark");
  const darkLab = page.locator(".optimization-lab");
  await expect(darkLab.locator(".optimization-3d-canvas canvas")).toBeVisible();
  const darkSurfaceColors = await expectResolvedSurfaceColors(darkLab);
  expect(darkSurfaceColors).not.toEqual(lightSurfaceColors);
  await captureScientific(
    darkLab.locator(".optimization-3d"),
    `${screenshots}/gradient-descent-3d-dark.png`,
  );
  await noSideLab();
  expect(rendererErrors).toEqual([]);
});

test("reusable circuit and chemistry experiments change geometry and exact calculated values rather than only swapping prose", async () => {
  await seed([
    { type: "illustration", spec: circuitExperiment },
    { type: "illustration", spec: equilibriumExperiment },
  ]);
  const circuit = page.locator(".learning-experiment").nth(0);
  const equilibrium = page.locator(".learning-experiment").nth(1);
  await expect(circuit.locator('[data-derived="current"]')).toHaveText("1 A");
  const particles = circuit.locator(
    '[data-experiment-element="carriers"] circle',
  );
  await expect(particles).toHaveCount(2);
  await circuit
    .getByRole("slider", { name: "Voltage", exact: true })
    .fill("12");
  await expect(circuit.locator('[data-derived="current"]')).toHaveText("2 A");
  await expect(circuit.locator('[data-derived="power"]')).toHaveText("24 W");
  await expect(particles).toHaveCount(4);
  await circuit
    .getByRole("slider", { name: "Resistance", exact: true })
    .fill("12");
  await expect(circuit.locator('[data-derived="current"]')).toHaveText("1 A");
  await expect(circuit.locator('[data-derived="power"]')).toHaveText("12 W");
  await expect(
    circuit.getByRole("button", { name: "Play experiment", exact: true }),
  ).toBeVisible();
  await circuit
    .getByRole("button", { name: "Step experiment", exact: true })
    .click();
  await expect(
    circuit.getByRole("slider", { name: "Experiment time", exact: true }),
  ).toHaveValue("0.1");
  await expect(equilibrium.locator('[data-derived="reactant"]')).toHaveText(
    "1 mol/L",
  );
  await expect(equilibrium.locator('[data-derived="product"]')).toHaveText(
    "1 mol/L",
  );
  const reactant = equilibrium.locator(
    '[data-experiment-element="reactantBar"] rect',
  );
  const product = equilibrium.locator(
    '[data-experiment-element="productBar"] rect',
  );
  const initialHeight = await product.getAttribute("height");
  await equilibrium
    .getByRole("slider", { name: "Equilibrium constant K", exact: true })
    .fill("3");
  await expect(equilibrium.locator('[data-derived="reactant"]')).toHaveText(
    "0.5 mol/L",
  );
  await expect(equilibrium.locator('[data-derived="product"]')).toHaveText(
    "1.5 mol/L",
  );
  await expect(product).not.toHaveAttribute("height", initialHeight!);
  expect(Number(await product.getAttribute("height"))).toBeCloseTo(
    3 * Number(await reactant.getAttribute("height")),
    6,
  );
  await equilibrium
    .getByRole("button", { name: "Inspect A at equilibrium", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: "A at equilibrium", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await captureScientific(
    equilibrium.locator(".experiment-viewport").first(),
    `${screenshots}/reversible-reaction-light.png`,
  );
  await captureScientific(
    equilibrium.locator(".experiment-viewport").last(),
    `${screenshots}/reversible-reaction-calculated-curves.png`,
  );
  await noSideLab();
  expect(rendererErrors).toEqual([]);
});

async function controlledProvider() {
  const fixture = join(directory, "production-model-request-service.cjs");
  await build({
    entryPoints: ["tests/v21-request-service-fixture.ts"],
    bundle: true,
    outfile: fixture,
    platform: "node",
    format: "cjs",
    external: ["electron", "better-sqlite3"],
    logLevel: "silent",
  });
  await app.evaluate(({ ipcMain, BrowserWindow }, fixture) => {
    const production = process
      .getBuiltinModule("node:module")
      .createRequire(process.cwd() + "/package.json")(fixture);
    const window = BrowserWindow.getAllWindows()[0];
    const state = { calls: 0, imageSearches: 0 };
    const service = new production.ModelRequestService({
      timeoutMs: 30000,
      onDelta: (event: unknown) =>
        window.webContents.send("studio:stream", event),
      onState: (event: unknown) =>
        window.webContents.send("studio:request-state", event),
      respond: async (_request: unknown, onDelta: (text: string) => void) => {
        state.calls++;
        // Put a display equation across the old 240-character insertion point.
        // This is synthetic Markdown, not a live model or authored science claim.
        const text = [
          "This controlled prose-only response checks the actual teaching pipeline. This is not a live connected-model response.".padEnd(
            220,
            " ",
          ),
          String.raw`$$
\nabla L(x,y)=\begin{bmatrix}x\\4y\end{bmatrix}
$$`,
          "```text\nFORMATTING_INTEGRITY_SENTINEL = [x, y]\n```",
          "[Formatting source](https://www.deeplearningbook.org/contents/numerical.html)",
          "This final paragraph deliberately makes the controlled response longer than the short-orientation allowance. It verifies that the trusted interactive figure appears before the intact explanation, while the complete equation, fenced code and reference remain unchanged. No part of this response comes from a live model.",
        ].join("\n\n");
        onDelta(text);
        return text;
      },
    });
    const original = (ipcMain as any)._invokeHandlers.get("studio:invoke");
    ipcMain.removeHandler("studio:invoke");
    ipcMain.handle("studio:invoke", (event, action, payload) => {
      if (action === "auth:status")
        return {
          connected: true,
          account: "Explicit explainer acceptance fixture; no live account",
        };
      if (action === "auth:models")
        return [
          {
            id: "explainer-fixture",
            name: "Controlled prose-only acceptance fixture",
            reasoningLevels: ["low"],
          },
        ];
      if (action === "model:send") return service.send(payload);
      if (action === "model:cancel") {
        service.cancel(payload.requestId);
        return true;
      }
      if (action === "images:search") {
        state.imageSearches++;
        throw new Error(
          "An unsolicited image search is not part of this lesson.",
        );
      }
      return original(event, action, payload);
    });
    (globalThis as any).explainerFixture = { state, service };
  }, fixture);
  await page.reload();
  await openDestination(page, "Learning workspace: Lesson");
  await expect(page.locator(".account-pill")).toContainText(
    "ChatGPT connected",
  );
}

test("ordinary learning questions acquire the appropriate trusted inline interaction even when the controlled model emits only prose", async () => {
  test.setTimeout(120000);
  const { subject } = await seed([]);
  await controlledProvider();
  await openTutor(page);
  await page
    .getByLabel("Message the tutor", { exact: true })
    .fill(
      "How does information in DNA become an amino-acid chain, and what happens if a base changes?",
    );
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await expect(
    page.locator(
      '.lesson-message.assistant [data-explainer="gene-expression"]',
    ),
  ).toBeVisible();
  await expect(page.locator(".lesson-message.assistant").last()).toContainText(
    "controlled prose-only response",
  );
  const explanation = page.locator(".lesson-message.assistant").last();
  await expect(explanation.locator(".katex")).toHaveCount(1);
  await expect(explanation.locator("pre code")).toHaveText(
    "FORMATTING_INTEGRITY_SENTINEL = [x, y]\n",
  );
  await expect(
    explanation.getByRole("link", { name: "Formatting source", exact: true }),
  ).toHaveAttribute(
    "href",
    "https://www.deeplearningbook.org/contents/numerical.html",
  );
  expect(
    await explanation.locator(".gene-lab").evaluate((element) => {
      const equation = element
        .closest(".lesson-message")
        ?.querySelector(".katex");
      return (
        !!equation &&
        !!(
          element.compareDocumentPosition(equation) &
          Node.DOCUMENT_POSITION_FOLLOWING
        )
      );
    }),
  ).toBe(true);
  await noSideLab();
  const lesson = await call<Lesson>("subject:conversation-create", {
    subjectId: subject.id,
    title: "How optimization chooses its next point",
    mode: "Learn",
  });
  const data = await call<StudioData>("data:load");
  await call("data:save", {
    ...data,
    activeSubjectId: subject.id,
    activeLessonId: lesson.id,
  });
  await page.reload();
  await openDestination(page, "Learning workspace: Lesson");
  await openTutor(page);
  await page
    .getByLabel("Message the tutor", { exact: true })
    .fill(
      "Teach me gradient descent and why the learning rate can overshoot a minimum.",
    );
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await expect(
    page.locator(".lesson-message.assistant .optimization-lab"),
  ).toBeVisible();
  await expect
    .poll(() =>
      app.evaluate(() => (globalThis as any).explainerFixture.state.calls),
    )
    .toBe(2);
  expect(
    await app.evaluate(
      () => (globalThis as any).explainerFixture.state.imageSearches,
    ),
  ).toBe(0);
  await page.screenshot({
    path: `${screenshots}/ordinary-question-automatic-inline-lab.png`,
  });
  await noSideLab();
  expect(rendererErrors).toEqual([]);
});

test("native HTML export opens without network or Learning Studio and preserves all three trusted interactive renderer types", async () => {
  test.setTimeout(150000);
  const { subject, lesson } = await seed(
    [
      geneBlock,
      optimizationBlock,
      { type: "illustration", spec: equilibriumExperiment },
    ],
    "Portable computed mechanisms",
  );
  await page
    .locator(".optimization-lab")
    .getByRole("slider", { name: "Optimization learning rate", exact: true })
    .fill("0.07");
  await mutate(page.locator(".gene-lab"), "substitution", 5, "T");
  await flush();
  const output = join(directory, "portable-mechanisms.html");
  await app.evaluate(({ dialog }, filePath) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath });
  }, output);
  const result = await call<{ path: string }>("export:html", {
    title: "Portable computed mechanisms",
    subjectId: subject.id,
    lessonIds: [lesson.id],
    chapterIds: [],
    includeNotes: false,
    includeUserMessages: false,
    embedCachedResources: true,
  });
  expect(result.path).toBe(output);
  const html = await readFile(output, "utf8");
  expect(html).not.toContain("PRIVATE_NOTE_NOT_SELECTED_FOR_EXPORT");
  expect(html).toContain("studio-book-data");
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    const context = await browser.newContext({
      offline: true,
      viewport: { width: 1300, height: 1000 },
    });
    const offline = await context.newPage();
    const externalRequests: string[] = [];
    offline.on("request", (request) => {
      if (/^https?:/.test(request.url())) externalRequests.push(request.url());
    });
    await offline.goto(pathToFileURL(output).href);
    const gene = offline.locator(".gene-lab"),
      optimization = offline.locator(".optimization-lab"),
      equilibrium = offline.locator(".learning-experiment");
    await expect(gene).toBeVisible();
    await expect(gene.locator("[data-gene-current-peptide]")).toHaveText(
      "Met · Val · Phe · Glu",
    );
    await gene
      .getByRole("button", { name: "Restore original", exact: true })
      .click();
    await expect(
      gene.getByRole("slider", { name: "Gene process position", exact: true }),
    ).toHaveValue("0");
    await gene.getByRole("button", { name: "Step", exact: true }).click();
    await expect(gene.locator(".gene-rna-base")).toHaveCount(1);
    await expect(
      optimization.getByRole("slider", {
        name: "Optimization learning rate",
        exact: true,
      }),
    ).toHaveValue("0.07");
    await optimization
      .getByRole("slider", { name: "Optimization learning rate", exact: true })
      .fill("0.05");
    await optimization
      .getByRole("button", { name: "Take one step", exact: true })
      .click();
    await expect(optimization.getByTestId("optimization-position")).toHaveText(
      "(-2.85, 2)",
    );
    await equilibrium
      .getByRole("slider", { name: "Equilibrium constant K", exact: true })
      .fill("3");
    await expect(equilibrium.locator('[data-derived="product"]')).toHaveText(
      "1.5 mol/L",
    );
    await captureScientific(
      optimization.locator(".optimization-chart-scroll"),
      `${screenshots}/offline-html-gradient-descent.png`,
    );
    expect(externalRequests).toEqual([]);
    await context.close();
  } finally {
    await browser.close();
  }
  expect(rendererErrors).toEqual([]);
});

test("new lesson figures retain readable sans-serif typography and independent light, dark, custom and narrow-window layouts", async () => {
  test.setTimeout(120000);
  await seed([
    geneBlock,
    optimizationBlock,
    { type: "illustration", spec: equilibriumExperiment },
  ]);
  for (const mode of ["light", "dark"] as const) {
    await setTheme(mode);
    const gene = page.locator(".gene-lab");
    await gene
      .getByRole("button", {
        name: "2. Build an amino-acid chain",
        exact: true,
      })
      .click();
    const font = await gene
      .locator(".gene-lead p")
      .evaluate((element) => getComputedStyle(element).fontFamily);
    expect(font).toMatch(/Inter|Segoe UI|sans-serif/i);
    expect(font).not.toMatch(/Georgia/i);
    await captureScientific(
      gene.locator(".gene-canvas-wrap"),
      `${screenshots}/gene-expression-${mode}.png`,
    );
    await captureScientific(
      page.locator(".optimization-chart-scroll"),
      `${screenshots}/gradient-descent-${mode}.png`,
    );
  }
  await setTheme("dark", true);
  await expect
    .poll(() =>
      page
        .locator(".learning-experiment")
        .evaluate((element) =>
          getComputedStyle(element).getPropertyValue("--figure").trim(),
        ),
    )
    .toBe("#192c40");
  await captureScientific(
    page.locator(".learning-experiment .experiment-viewport").first(),
    `${screenshots}/reversible-reaction-custom.png`,
  );
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setContentSize(860, 1120),
  );
  const reading = page.locator(".lesson-reader");
  const overflow = await reading.evaluate(
    (element) => element.scrollWidth - element.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(2);
  for (const selector of [
    ".gene-canvas-wrap",
    ".optimization-chart-scroll",
    ".experiment-viewport",
  ]) {
    const elements = page.locator(selector);
    for (let index = 0; index < (await elements.count()); index++) {
      const box = (await elements.nth(index).boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(862);
    }
  }
  await captureScientific(
    page.locator(".gene-canvas-wrap"),
    `${screenshots}/gene-expression-narrow-custom.png`,
  );
  await openReadingControls(page);
  await expect(page.locator("details.folio-reading-menu")).toHaveAttribute(
    "open",
    "",
  );
  await noSideLab();
  expect(rendererErrors).toEqual([]);
});
