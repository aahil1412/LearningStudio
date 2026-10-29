import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page,
} from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { build } from "esbuild";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import type { ContentBlock, Lesson, StudioData } from "../src/types";
import type { Subject, SubjectSnapshot } from "../src/v2types";
import { sanitizeAppearance } from "../src/lib/themes";
import {
  openDestination,
  openReadingControls,
  openSubjectTab,
} from "./ui-navigation";

// Actual Windows Electron, renderer, IPC, SQLite and visual instances. Only the
// explicitly named provider fixture substitutes remote transport. No normal
// learner profile, authentication state or account credentials are loaded.
let app: ElectronApplication;
let page: Page;
let directory: string;
let rendererErrors: string[];
const shots = "docs/screenshots/learning-redesign";
const receiptPath = "docs/learning-redesign-native-results.json";
const layoutAudits: unknown[] = [];
const runResults: {
  title: string;
  status: string | undefined;
  durationMs: number;
  errors: string[];
}[] = [];
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
  page.on("pageerror", (error) => rendererErrors.push(error.message));
  await app.evaluate(({ BrowserWindow }) => {
    const owned = BrowserWindow.getAllWindows()[0];
    owned.setContentSize(1480, 1120);
    owned.webContents.setBackgroundThrottling(false);
    // A hidden packaged Windows compositor can report visible/stable DOM while
    // delivering no animation frames. Verify the real foreground renderer.
    owned.show();
    owned.focus();
  });
  await expect(page.locator(".titlebar-center")).toHaveText("Saved locally");
  const frames = await page.evaluate(async () => {
    let count = 0,
      frame = 0;
    const next = () => {
      count++;
      frame = requestAnimationFrame(next);
    };
    frame = requestAnimationFrame(next);
    await new Promise((resolve) => setTimeout(resolve, 300));
    cancelAnimationFrame(frame);
    return count;
  });
  expect(
    frames,
    "The actual isolated test window must deliver renderer frames",
  ).toBeGreaterThan(0);
}

test.beforeEach(async () => {
  await mkdir(".tools", { recursive: true });
  await mkdir(shots, { recursive: true });
  directory = await mkdtemp(
    join(resolve(".tools"), "learning-redesign-native-"),
  );
  rendererErrors = [];
  await launch();
});
test.afterEach(async ({ baseURL: _baseURL }, info) => {
  runResults.push({
    title: info.title,
    status: info.status,
    durationMs: info.duration,
    errors: info.errors.map((error) => error.message || "Unknown test error"),
  });
  await writeFile(
    receiptPath,
    JSON.stringify(
      {
        capturedAt: new Date().toISOString(),
        appVersion: JSON.parse(await readFile("package.json", "utf8")).version,
        platform: process.platform,
        packaged: !!process.env.STUDIO_TEST_EXECUTABLE,
        profile: "Isolated synthetic acceptance profiles",
        liveConnectedModelTested: false,
        results: runResults,
      },
      null,
      2,
    ),
  );
  await app?.close().catch(() => {});
  const root = resolve(".tools") + sep,
    target = resolve(directory);
  if (!target.startsWith(root) || !target.includes("learning-redesign-native-"))
    throw new Error("Unexpected fixture cleanup path");
  await rm(target, {
    recursive: true,
    force: true,
    maxRetries: 8,
    retryDelay: 200,
  });
});

const optimization: ContentBlock = {
  type: "illustration",
  spec: {
    template: "optimization-lab",
    title: "Choose a calculated gradient step",
    optimization: {
      landscape: "quadratic",
      learningRate: 0.18,
      start: [-3, 2.5],
      iterations: 120,
    },
  },
};
const gene: ContentBlock = {
  type: "illustration",
  spec: {
    template: "gene-expression-lab",
    title: "Read the message and change a base",
  },
};

async function seedStudy() {
  const subject = await call<Subject>("subject:create", {
    name: "Mechanisms and models",
    objective:
      "Understand a mechanism by changing an input, observing a result and explaining the relationship",
    depth: "comprehensive",
  });
  await call("subject:apply", {
    subjectId: subject.id,
    baseRevision: subject.revision,
    label: "Explicit synthetic redesign acceptance material",
    operations: [
      {
        entity: "curriculum",
        op: "put",
        id: "redesign-module",
        value: {
          kind: "module",
          title: "From observations to explanations",
          description: "Connect a sequence model and a calculated method",
          position: 0,
          status: "introduced",
          prerequisites: [],
        },
      },
      {
        entity: "curriculum",
        op: "put",
        id: "redesign-sequence",
        value: {
          parentId: "redesign-module",
          kind: "topic",
          title: "Reading a genetic message",
          description: "Follow an explicitly synthetic coding sequence",
          position: 0,
          status: "covered",
          prerequisites: [],
        },
      },
      {
        entity: "curriculum",
        op: "put",
        id: "redesign-optimization",
        value: {
          parentId: "redesign-module",
          kind: "topic",
          title: "Choosing a gradient step",
          description: "Compare a calculated loss and update",
          position: 1,
          status: "introduced",
          prerequisites: [],
        },
      },
      {
        entity: "concept",
        op: "put",
        id: "redesign-concept",
        value: {
          label: "A calculated gradient update",
          status: "unassessed",
          coverage: "introduced",
          evidence: "",
          notes:
            "Explicit acceptance material. Viewing or manipulating a plot is not demonstrated understanding.",
        },
      },
    ],
  });
  await call("subject:update", {
    subjectId: subject.id,
    patch: { currentNodeId: "redesign-optimization" },
  });
  const lesson = await call<Lesson>("subject:conversation-create", {
    subjectId: subject.id,
    title: "Follow a mechanism, then test an idea",
    objective:
      "Use direct manipulation to connect an input to its calculated consequence",
    mode: "Learn",
    curriculumNodeId: "redesign-optimization",
  });
  const now = new Date().toISOString();
  const assistant = (id: string, content: ContentBlock[]) => ({
    id,
    role: "assistant" as const,
    text: "",
    content,
    blocks: content,
    status: "complete" as const,
    createdAt: now,
  });
  const user = (id: string, text: string) => ({
    id,
    role: "user" as const,
    text,
    blocks: [],
    status: "complete" as const,
    createdAt: now,
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
        tutor: { model: "learning-redesign-fixture", reasoning: "low" },
        visual: { model: "learning-redesign-fixture", reasoning: "low" },
        review: { model: "learning-redesign-fixture", reasoning: "low" },
      },
    },
    lessons: data.lessons.map((item) =>
      item.id !== lesson.id
        ? item
        : {
            ...item,
            notes:
              "Acceptance note preserved through the new learning presentation.",
            messages: [
              user(
                "redesign-question-one",
                "How does a sequence become a message?",
              ),
              assistant("redesign-unit-one", [
                {
                  type: "concept",
                  title: "Copy the message",
                  objective:
                    "Observe a synthetic sequence changing from DNA to RNA",
                  prerequisites: ["A sequence has an ordered set of bases."],
                },
                {
                  type: "text",
                  text: "Change one DNA base and compare the resulting RNA. This synthetic standard-code model makes its assumptions visible; no organism or protein structure is inferred.",
                },
                gene,
                {
                  type: "text",
                  text: "A one-base edit can change a codon or shift later groups. The visible output is a calculation, not evidence that the learner has understood it.",
                },
              ]),
              user(
                "redesign-question-two",
                "How does a numerical method choose a step?",
              ),
              assistant("redesign-unit-two", [
                {
                  type: "concept",
                  title: "Take a gradient step",
                  objective:
                    "Compare the effect of the learning rate on the next calculated position",
                  prerequisites: ["A slope describes a local rate of change."],
                },
                {
                  type: "text",
                  text: "Move the start or change the learning rate. Take one step and compare its new coordinates with the original.",
                },
                optimization,
                {
                  type: "equation",
                  latex:
                    "\\boldsymbol{x}_{k+1}=\\boldsymbol{x}_{k}-\\eta\\nabla L(\\boldsymbol{x}_{k})",
                },
                {
                  type: "text",
                  text: "The gradient points toward fastest local increase. This method steps in the opposite direction. Large finite steps can overshoot; these analytic examples do not train a neural network.",
                },
              ]),
              user(
                "redesign-question-three",
                "What should I compare across these examples?",
              ),
              assistant("redesign-unit-three", [
                {
                  type: "concept",
                  title: "Connect the ideas",
                  objective:
                    "Separate an input, a rule and an observable consequence",
                  prerequisites: [],
                },
                {
                  type: "text",
                  text: "Both models connect a specified input to a calculated output. The useful next question is what assumptions each model makes. You can ask about a particular passage, return to an earlier section, or revisit the subject pathway without losing the original record.",
                },
                {
                  type: "mcq",
                  id: "redesign-optional-check",
                  question: "What does moving a slider demonstrate by itself?",
                  choices: [
                    {
                      id: "view",
                      text: "A visible consequence of the model's rule",
                      explanation:
                        "The model recalculates its result. Understanding still needs appropriate evidence.",
                    },
                    {
                      id: "mastery",
                      text: "Durable mastery of the whole topic",
                      explanation:
                        "An interface action alone does not demonstrate durable understanding.",
                    },
                  ],
                  correctChoiceIds: ["view"],
                  allowUnknown: true,
                  explanation:
                    "This optional check is one observation, not a mastery claim.",
                },
              ]),
            ],
          },
    ),
  });
  await page.reload();
  await openCurrentStudy();
  return { subject, lesson };
}

const player = () => page.getByTestId("learning-player");
async function openCurrentStudy() {
  if (!(await player().isVisible()))
    await page
      .getByRole("button", {
        name: /^(?:Continue lesson|Resume learning session)$/,
      })
      .click();
  await expect(player()).toBeVisible();
}
async function section(number: number, title: string) {
  await player()
    .getByRole("button", {
      name: `Open section ${number} ${title}`,
      exact: true,
    })
    .click();
  await expect(player()).toHaveAttribute(
    "data-active-unit",
    `redesign-unit-${["one", "two", "three"][number - 1]}`,
  );
}
async function screenshot(name: string) {
  await page.screenshot({
    path: `${shots}/${name}.png`,
    animations: "disabled",
  });
}
async function navigationContrast() {
  const measured = await page
    .locator(".studio-global-nav > button > span")
    .evaluateAll((spans) => {
      const rgba = (value: string) => {
        const values = value.match(/[\d.]+/g)?.map(Number) || [];
        return [values[0] || 0, values[1] || 0, values[2] || 0, values[3] ?? 1];
      };
      const luminance = (values: number[]) => {
        const linear = values.slice(0, 3).map((value) => {
          const normalized = value / 255;
          return normalized <= 0.04045
            ? normalized / 12.92
            : ((normalized + 0.055) / 1.055) ** 2.4;
        });
        return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
      };
      return spans.map((span) => {
        const backgrounds: number[][] = [];
        let element: Element | null = span;
        while (element) {
          backgrounds.unshift(rgba(getComputedStyle(element).backgroundColor));
          element = element.parentElement;
        }
        const background = backgrounds.reduce(
          (under, over) =>
            over
              .slice(0, 3)
              .map(
                (value, index) =>
                  value * over[3] + under[index] * (1 - over[3]),
              ),
          [255, 255, 255],
        );
        const style = getComputedStyle(span);
        const foreground = rgba(style.color);
        const composed = foreground
          .slice(0, 3)
          .map(
            (value, index) =>
              value * foreground[3] + background[index] * (1 - foreground[3]),
          );
        const first = luminance(composed),
          second = luminance(background);
        return {
          text: span.textContent?.trim(),
          color: style.color,
          background,
          fontSize: style.fontSize,
          ratio:
            (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05),
        };
      });
    });
  expect(measured.length).toBeGreaterThan(0);
  for (const item of measured)
    expect(
      item.ratio,
      `Actual global navigation text contrast: ${JSON.stringify(item)}`,
    ).toBeGreaterThanOrEqual(4.5);
  return measured;
}
async function resetSurfaceScroll(surface: string) {
  await page.locator(surface).evaluate((element) => {
    let current: Element | null = element;
    while (current) {
      if (current instanceof HTMLElement) current.scrollTop = 0;
      current = current.parentElement;
    }
    if (document.scrollingElement) document.scrollingElement.scrollTop = 0;
  });
}
function noSideLab() {
  return expect(
    page.locator(
      ".laboratory,.visual-lab,[data-visual-dock=side],[data-visual-dock=split]",
    ),
  ).toHaveCount(0);
}
async function flush() {
  await page.waitForTimeout(800);
  await expect(page.locator(".titlebar-center")).toHaveText("Saved locally");
}

async function controlledProvider() {
  const fixture = join(directory, "request-service.cjs");
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
    const owned = BrowserWindow.getAllWindows()[0];
    const state = { calls: 0, requests: [] as unknown[] };
    const service = new production.ModelRequestService({
      timeoutMs: 30000,
      onDelta: (event: unknown) =>
        owned.webContents.send("studio:stream", event),
      onState: (event: unknown) =>
        owned.webContents.send("studio:request-state", event),
      respond: async (request: unknown, delta: (text: string) => void) => {
        state.calls++;
        state.requests.push(request);
        const text = JSON.stringify({
          content: [
            {
              type: "concept",
              title: "Compare the next step",
              objective:
                "Notice how a changed learning rate changes the calculated update",
              prerequisites: [],
            },
            {
              type: "text",
              text: "This explicitly controlled acceptance response uses the production request pipeline. It is not a live connected-model result. A smaller learning rate scales the same local negative-gradient direction; it does not change the loss function.",
            },
            { type: "equation", latex: "\\Delta x=-\\eta\\nabla L(x)" },
          ],
        });
        delta(text);
        return text;
      },
    });
    const original = (ipcMain as any)._invokeHandlers.get("studio:invoke");
    ipcMain.removeHandler("studio:invoke");
    ipcMain.handle("studio:invoke", (event, action, payload) => {
      if (action === "auth:status")
        return {
          connected: true,
          account:
            "Explicit learning-redesign acceptance fixture; no live account",
        };
      if (action === "auth:models")
        return [
          {
            id: "learning-redesign-fixture",
            name: "Controlled redesign acceptance provider",
            reasoningLevels: ["low"],
          },
        ];
      if (action === "model:send") return service.send(payload);
      if (action === "model:cancel") {
        service.cancel(payload.requestId);
        return true;
      }
      return original(event, action, payload);
    });
    (globalThis as any).learningRedesignFixture = { state, service };
  }, fixture);
  await page.reload();
  await openCurrentStudy();
}

test("learning home begins with subjects and real study actions, then adopts a supplied curriculum without an automatic model request", async () => {
  await expect(page.locator(".learning-center-home")).toBeVisible();
  await expect(
    page.locator('textarea[aria-label="Message the tutor"]:visible'),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "New subject", exact: true }),
  ).toBeVisible();
  await navigationContrast();
  await screenshot("learning-home-empty-light");
  await page.getByRole("button", { name: "New subject", exact: true }).click();
  await page
    .getByLabel("Subject workspace name", { exact: true })
    .fill("A broad mechanics course");
  await page
    .getByLabel("Subject learning objective", { exact: true })
    .fill(
      "Understand mechanics from a complete supplied course, with optional practice and room to explore",
    );
  await page
    .locator(".source-study-create-choice")
    .getByRole("button", { name: "Use a curriculum", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Create subject", exact: true })
    .click();
  const panel = page.getByRole("region", {
    name: "Curriculum and textbook study",
    exact: true,
  });
  await expect(panel).toBeVisible();
  await panel
    .getByRole("button", { name: "Paste source text", exact: true })
    .click();
  await panel
    .getByLabel("Study source title", { exact: true })
    .fill("Explicit acceptance course outline");
  await panel
    .getByLabel("Study source text", { exact: true })
    .fill(
      "# Mechanics acceptance course\n\nAuthored interface-test material, not a university publication.\n\n## Module 1: Motion\nPosition, displacement and velocity.\n\n## Module 2: Forces\nMomentum, interactions and system boundaries.\n\n## Module 3: Energy\nWork and conservation.",
    );
  await panel
    .getByRole("button", { name: "Review outline", exact: true })
    .click();
  await expect(
    panel.getByRole("heading", {
      name: "Review your study outline",
      exact: true,
    }),
  ).toBeVisible();
  await screenshot("supplied-curriculum-review");
  await panel
    .getByRole("button", { name: "Apply to pathway", exact: true })
    .click();
  const subject = (await call<Subject[]>("subject:list")).find(
    (item) => item.name === "A broad mechanics course",
  )!;
  expect(subject).toBeTruthy();
  await expect
    .poll(async () =>
      (
        await call<SubjectSnapshot>("subject:get", { subjectId: subject.id })
      ).curriculum.some((node) => /Motion/.test(node.title)),
    )
    .toBe(true);
  const snapshot = await call<SubjectSnapshot>("subject:get", {
    subjectId: subject.id,
  });
  expect(snapshot.curriculum.some((node) => /Motion/.test(node.title))).toBe(
    true,
  );
  expect(
    snapshot.curriculum.every((node) => node.status === "not-started"),
  ).toBe(true);
  expect(snapshot.evidence).toEqual([]);
  expect(await call("planning:list", { subjectId: subject.id })).toEqual([]);
  await expect(page.locator(".learning-center-subject")).toBeVisible();
  await openSubjectTab(page, "Overview");
  await expect(
    page.getByRole("region", { name: "Pathway overview", exact: true }),
  ).toBeVisible();
  await resetSurfaceScroll(".learning-center-subject");
  await screenshot("subject-course-overview");
  expect(rendererErrors).toEqual([]);
});

test("lesson sections replace the default transcript and preserve the mounted interactive figure and camera across navigation", async () => {
  test.setTimeout(120000);
  const { subject } = await seedStudy();
  await expect(player()).toBeVisible();
  await section(2, "Take a gradient step");
  await expect(
    page.locator('textarea[aria-label="Message the tutor"]:visible'),
  ).toHaveCount(0);
  await expect(page.locator(".message-label:visible")).toHaveCount(0);
  await expect(
    page.locator('[data-message-id="redesign-question-one"]:visible'),
  ).toHaveCount(0);
  const lab = page.locator(".optimization-lab");
  await lab
    .getByRole("slider", { name: "Optimization learning rate", exact: true })
    .fill("0.05");
  await lab.getByRole("button", { name: "Take one step", exact: true }).click();
  await expect(lab.getByTestId("optimization-position")).toHaveText(
    "(-2.85, 2)",
  );
  await lab.getByRole("button", { name: "Explore in 3D", exact: true }).click();
  const canvas = lab.locator(".optimization-3d-canvas canvas");
  await expect(canvas).toBeVisible();
  const cameraHost = lab.locator(".optimization-3d-canvas");
  await expect(cameraHost).toHaveAttribute("data-camera-position", /^\[/);
  const cameraBeforeRotation = await cameraHost.getAttribute(
    "data-camera-position",
  );
  await lab
    .getByRole("button", { name: "Rotate 3D right", exact: true })
    .click();
  await expect(cameraHost).not.toHaveAttribute(
    "data-camera-position",
    cameraBeforeRotation!,
  );
  const camera = JSON.parse(
    (await cameraHost.getAttribute("data-camera-position"))!,
  ) as number[];
  await lab.evaluate((element) => {
    (window as any).__redesignHost = element.closest("[data-visual-host]");
    (window as any).__redesignCanvas = element.querySelector("canvas");
  });
  await section(1, "Copy the message");
  await expect(page.locator(".gene-lab")).toBeVisible();
  await expect(lab).toBeHidden();
  await player()
    .getByRole("button", { name: "Next section in lesson", exact: true })
    .click();
  await expect(player()).toHaveAttribute(
    "data-active-unit",
    "redesign-unit-two",
  );
  await expect(lab).toBeVisible();
  await expect(
    lab.getByRole("slider", {
      name: "Optimization learning rate",
      exact: true,
    }),
  ).toHaveValue("0.05");
  await expect
    .poll(async () => {
      const actual = JSON.parse(
        (await cameraHost.getAttribute("data-camera-position"))!,
      ) as number[];
      return Math.max(
        ...actual.map((value, index) => Math.abs(value - camera[index])),
      );
    })
    .toBeLessThan(1e-8);
  expect(
    await lab.evaluate(
      (element) =>
        element.closest("[data-visual-host]") ===
          (window as any).__redesignHost &&
        element.querySelector("canvas") === (window as any).__redesignCanvas,
    ),
  ).toBe(true);
  const snapshot = await call<SubjectSnapshot>("subject:get", {
    subjectId: subject.id,
  });
  expect(
    snapshot.concepts.find((concept) => concept.id === "redesign-concept")
      ?.status,
  ).toBe("unassessed");
  expect(snapshot.evidence).toEqual([]);
  await noSideLab();
  const chart = await lab.locator(".optimization-chart").boundingBox();
  const viewport = await page.evaluate(() => ({
    width: innerWidth,
    height: innerHeight,
  }));
  expect(
    chart,
    "The first viewport must contain the actual calculated figure",
  ).toBeTruthy();
  expect(chart!.y).toBeLessThan(viewport.height - 300);
  layoutAudits.push({
    surface: "focused lesson first viewport",
    viewport,
    chart,
  });
  await writeFile(
    "docs/learning-redesign-layout-results.json",
    JSON.stringify(
      { executedAt: new Date().toISOString(), layoutAudits },
      null,
      2,
    ),
  );
  await screenshot("focused-learning-unit-light");
  expect(rendererErrors).toEqual([]);
});

test("asking is an explicit contextual action and a completed tutor response becomes a usable next learning section", async () => {
  const { lesson } = await seedStudy();
  await controlledProvider();
  await section(2, "Take a gradient step");
  await expect(
    page.locator('textarea[aria-label="Message the tutor"]:visible'),
  ).toHaveCount(0);
  await player()
    .getByRole("button", { name: "Ask about this page", exact: true })
    .click();
  const question = page.getByLabel("Message the tutor", { exact: true });
  await expect(question).toBeVisible();
  await question.fill(
    "Why does changing this learning rate change the next step without changing the loss function?",
  );
  await screenshot("contextual-ask-open");
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await expect(
    page.getByRole("button", {
      name: /^Open section 4 Compare the next step$/,
    }),
  ).toBeVisible();
  await player()
    .getByRole("button", {
      name: "Open section 4 Compare the next step",
      exact: true,
    })
    .click();
  await expect(
    page
      .locator(
        '[data-message-id] :text("This explicitly controlled acceptance response")',
      )
      .first(),
  ).toBeVisible();
  await expect(player().locator(".katex:visible")).toHaveCount(1);
  expect(
    await app.evaluate(
      () => (globalThis as any).learningRedesignFixture.state.calls,
    ),
  ).toBe(1);
  await flush();
  const saved = await call<StudioData>("data:load");
  const result = saved.lessons.find((item) => item.id === lesson.id)!;
  expect(
    result.messages.filter((message) => message.role === "assistant"),
  ).toHaveLength(4);
  expect(
    result.messages.some(
      (message) =>
        message.role === "user" &&
        message.text.includes("changing this learning rate"),
    ),
  ).toBe(true);
  expect(result.position).toBe(lesson.position);
  await screenshot("new-section-from-contextual-question");
  expect(rendererErrors).toEqual([]);
});

test("the original conversation remains accessible and branching preserves its transcript", async () => {
  const { subject, lesson } = await seedStudy();
  const original = (await call<StudioData>("data:load")).lessons.find(
    (item) => item.id === lesson.id,
  )!;
  await player().getByTestId("learning-player-history").click();
  await expect(
    page.locator('[data-message-id="redesign-question-one"]'),
  ).toBeVisible();
  await expect(
    page.locator('[data-message-id="redesign-unit-one"]'),
  ).toBeVisible();
  await expect(
    page.locator('[data-message-id="redesign-question-two"]'),
  ).toBeVisible();
  await screenshot("conversation-record-secondary");
  const message = page.locator('[data-message-id="redesign-unit-one"]');
  const menu = message.locator("details.studio-message-actions");
  await menu.locator("summary").click();
  await message
    .getByRole("button", {
      name: "Branch conversation from this message",
      exact: true,
    })
    .click();
  await flush();
  const data = await call<StudioData>("data:load");
  expect(data.lessons.find((item) => item.id === lesson.id)?.messages).toEqual(
    original.messages,
  );
  const branch = data.lessons.find(
    (item) => item.parentConversationId === lesson.id,
  );
  expect(branch).toBeTruthy();
  expect(branch!.branchMessageId).toBe("redesign-unit-one");
  const snapshot = await call<SubjectSnapshot>("subject:get", {
    subjectId: subject.id,
  });
  expect(snapshot.conversations.some((item) => item.id === branch!.id)).toBe(
    true,
  );
  expect(rendererErrors).toEqual([]);
});

test("notes, appearance, selected lesson section and scientific controls survive SQLite restart", async () => {
  const { lesson } = await seedStudy();
  await section(2, "Take a gradient step");
  await page
    .locator(".optimization-lab")
    .getByRole("slider", { name: "Optimization learning rate", exact: true })
    .fill("0.08");
  await page.getByRole("button", { name: "Notes", exact: true }).click();
  await page
    .getByLabel("Session notes", { exact: true })
    .fill("A learning note kept independently of conversation presentation.");
  await page.getByRole("button", { name: "Notes", exact: true }).click();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page
    .locator(".appearance-modes")
    .getByRole("button", { name: "Dark", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Close settings", exact: true })
    .click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await openReadingControls(page);
  const larger = page
    .getByRole("button", { name: /A\+ Larger|Increase reading size/ })
    .first();
  await larger.click();
  await page.keyboard.press("Escape");
  await flush();
  await app.close();
  await launch();
  if (!(await player().isVisible()))
    await page
      .getByRole("button", {
        name: /^(?:Continue lesson|Resume learning session)$/,
      })
      .click();
  await expect(player()).toHaveAttribute(
    "data-active-unit",
    "redesign-unit-two",
  );
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(
    page
      .locator(".optimization-lab")
      .getByRole("slider", { name: "Optimization learning rate", exact: true }),
  ).toHaveValue("0.08");
  const data = await call<StudioData>("data:load");
  expect(data.lessons.find((item) => item.id === lesson.id)?.notes).toBe(
    "A learning note kept independently of conversation presentation.",
  );
  const appearance = sanitizeAppearance(data.appearance);
  expect(appearance.dark.typography.size).toBeGreaterThan(18);
  await screenshot("learning-resume-dark");
  expect(rendererErrors).toEqual([]);
});

test("the redesigned learning surfaces remain usable in light, dark, custom and compact layouts with preserved tools", async () => {
  test.setTimeout(180000);
  await seedStudy();
  const audits: {
    scheme: string;
    violations: unknown[];
    navigation: unknown[];
  }[] = [];
  const blockingAccessibilityFindings: unknown[] = [];
  for (const scheme of ["Light", "Dark"] as const) {
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page
      .locator(".appearance-modes")
      .getByRole("button", { name: scheme, exact: true })
      .click();
    await screenshot(`preferences-${scheme.toLowerCase()}`);
    await page
      .getByRole("button", { name: "Close settings", exact: true })
      .click();
    await section(1, "Copy the message");
    await expect(page.locator("html")).toHaveAttribute(
      "data-theme",
      scheme.toLowerCase(),
    );
    await screenshot(`learning-${scheme.toLowerCase()}`);
    const navigation = await navigationContrast();
    const result = await new AxeBuilder({ page })
      .setLegacyMode(true)
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    audits.push({
      scheme,
      navigation,
      violations: result.violations.map((item) => ({
        id: item.id,
        impact: item.impact,
        help: item.help,
        nodes: item.nodes.map((node) => ({
          target: node.target,
          summary: node.failureSummary,
        })),
      })),
    });
    await writeFile(
      "docs/learning-redesign-accessibility-results.json",
      JSON.stringify({ executedAt: new Date().toISOString(), audits }, null, 2),
    );
    blockingAccessibilityFindings.push(
      ...result.violations.filter(
        (item) => item.impact === "critical" || item.impact === "serious",
      ),
    );
  }
  const data = await call<StudioData>("data:load");
  const appearance = sanitizeAppearance(data.appearance);
  appearance.mode = "dark";
  appearance.dark.presetId = "redesign-acceptance-custom";
  appearance.dark.colors.bg = "#15252f";
  appearance.dark.colors.figure = "#192c40";
  await call("data:save", {
    ...data,
    appearance,
  });
  await page.reload();
  await openCurrentStudy();
  await section(2, "Take a gradient step");
  await expect
    .poll(() =>
      player().evaluate((element) =>
        getComputedStyle(element).getPropertyValue("--figure").trim(),
      ),
    )
    .toBe("#192c40");
  await screenshot("learning-custom");
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setContentSize(900, 1000),
  );
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
    )
    .toBeLessThanOrEqual(2);
  await screenshot("learning-compact-custom");
  await noSideLab();
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setContentSize(860, 1000),
  );
  const reading = page.locator("details.folio-reading-menu > summary");
  const navigation = page.getByRole("navigation", {
    name: "Main navigation",
    exact: true,
  });
  const readingBounds = await reading.boundingBox();
  const navigationBounds = await navigation.boundingBox();
  expect(readingBounds).toBeTruthy();
  expect(navigationBounds).toBeTruthy();
  const intersects =
    readingBounds!.x < navigationBounds!.x + navigationBounds!.width &&
    readingBounds!.x + readingBounds!.width > navigationBounds!.x &&
    readingBounds!.y < navigationBounds!.y + navigationBounds!.height &&
    readingBounds!.y + readingBounds!.height > navigationBounds!.y;
  expect(
    intersects,
    "Global navigation must not overlap the active lesson's Reading control at 860px",
  ).toBe(false);
  expect(
    await reading.evaluate((element) => {
      const box = element.getBoundingClientRect();
      const target = document.elementFromPoint(
        box.x + box.width / 2,
        box.y + box.height / 2,
      );
      return target === element || (!!target && element.contains(target));
    }),
    "The Reading control must receive the native pointer hit, rather than the header above it",
  ).toBe(true);
  await openReadingControls(page);
  await expect(
    page.getByRole("group", { name: "Lesson typography", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "A+ Larger", exact: true }).click();
  await expect(
    page.getByRole("group", { name: "Lesson typography", exact: true }),
  ).toContainText("19px Reset");
  layoutAudits.push({
    surface: "860px lesson Reading control",
    viewport: { width: 860, height: 1000 },
    readingBounds,
    navigationBounds,
    intersects,
    nativePointerClickOpened: true,
    readingSizeAfterClick: 19,
    escapeDismissalVerified: true,
    outsideClickDismissalVerified: true,
  });
  await screenshot("learning-860-reading-open");
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("group", { name: "Lesson typography", exact: true }),
  ).toBeHidden();
  await openReadingControls(page);
  await page.locator("details.studio-tools-menu > summary").click();
  await expect(page.locator("details.folio-reading-menu")).not.toHaveAttribute(
    "open",
    "",
  );
  await expect(
    page.getByRole("menuitem", { name: "Visual notebook", exact: true }),
  ).toBeVisible();
  await writeFile(
    "docs/learning-redesign-layout-results.json",
    JSON.stringify(
      { executedAt: new Date().toISOString(), layoutAudits },
      null,
      2,
    ),
  );
  for (const [name, selector] of [
    ["Visual notebook", ".visual-notebook"],
    ["Living textbook", ".v2-textbook"],
    ["Document study", '[aria-label="Study document"]'],
    ["Learning canvas", ".learning-canvas-workspace"],
  ] as const) {
    await openDestination(page, name);
    await expect(page.locator(selector)).toBeVisible();
  }
  await writeFile(
    "docs/learning-redesign-accessibility-results.json",
    JSON.stringify(
      {
        executedAt: new Date().toISOString(),
        standard:
          "Automated WCAG2/2.1 A+AA scan; no claim of complete manual conformance",
        audits,
      },
      null,
      2,
    ),
  );
  expect(blockingAccessibilityFindings).toEqual([]);
  expect(rendererErrors).toEqual([]);
});
