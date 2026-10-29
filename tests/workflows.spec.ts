import {
  seedReferenceLesson,
  createLearningSession,
} from "./learning-fixtures";
import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
  type Page,
} from "@playwright/test";
import { basename, join, resolve, sep } from "node:path";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import type { StudioData } from "../src/types";
import {
  openRoadmap,
  openTutor,
  openDestination,
  openConversationRecord,
} from "./ui-navigation";

// These tests run the real production Electron app and SQLite store. They do
// not authenticate an account, mock a successful tutor, or spend plan usage.
let app: ElectronApplication;
let page: Page;
let directory: string;
let rendererErrors: string[];
const screenshots = join(process.cwd(), "docs", "screenshots");

async function launch(dataDirectory: string) {
  const environment: Record<string, string> = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
  environment.STUDIO_DATA_DIR = dataDirectory;
  delete environment.ELECTRON_RUN_AS_NODE;
  delete environment.STUDIO_DEV_URL;
  app = await electron.launch({
    args: [".", "--start-hidden"],
    cwd: process.cwd(),
    env: environment,
  });
  page = await app.firstWindow();
  page.on("pageerror", (error) => rendererErrors.push(error.message));
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0].webContents.setBackgroundThrottling(false);
    BrowserWindow.getAllWindows()[0].setContentSize(1500, 980);
  });
  await expect(
    page.getByText("Learning Studio", { exact: true }).first(),
  ).toBeVisible();
  await expect(page.locator(".titlebar-center")).toHaveText("Saved locally");
  await page.evaluate(() => document.fonts.ready);
}

async function stored() {
  return page.evaluate(() => window.studio!.invoke<StudioData>("data:load"));
}
async function saved(predicate: (data: StudioData) => boolean) {
  await expect
    .poll(async () => predicate(await stored()), { timeout: 10000 })
    .toBe(true);
}
async function screenshot(name: string) {
  mkdirSync(screenshots, { recursive: true });
  await page.screenshot({
    path: join(screenshots, name),
    animations: "disabled",
  });
}
async function settings() {
  await page
    .locator(".sidebar-bottom")
    .getByRole("button", { name: "Settings", exact: true })
    .click();
  return page.getByRole("region", { name: "Settings", exact: true });
}
async function closeSettings() {
  await page
    .getByRole("button", { name: "Close settings", exact: true })
    .click();
}
async function cssToken(key: string) {
  return page.evaluate(
    (key) => document.documentElement.style.getPropertyValue("--" + key),
    key,
  );
}
async function range(
  label: string,
  from: "Home" | "End",
  steps: number,
  key: "ArrowLeft" | "ArrowRight" = "ArrowRight",
) {
  const input = page.getByRole("slider", { name: label, exact: true });
  await input.focus();
  await input.press(from);
  for (let i = 0; i < steps; i++) await input.press(key);
}

test.beforeEach(async () => {
  directory = mkdtempSync(join(tmpdir(), "studio-e2e-"));
  rendererErrors = [];
  await launch(directory);
});
test.afterEach(async () => {
  if (
    page &&
    !page.isClosed() &&
    test.info().status !== test.info().expectedStatus
  )
    await test.info().attach("Electron failure screenshot", {
      body: await page.screenshot(),
      contentType: "image/png",
    });
  if (app) await app.close().catch(() => {});
  // Guard the final absolute cleanup path before any recursive removal.
  const target = resolve(directory);
  if (
    !target.startsWith(resolve(tmpdir()) + sep) ||
    !basename(target).startsWith("studio-e2e-")
  )
    throw new Error("Refusing to remove an unexpected test path.");
  rmSync(target, {
    recursive: true,
    force: true,
    maxRetries: 8,
    retryDelay: 200,
  });
  expect(rendererErrors, "Unhandled renderer exceptions").toEqual([]);
});

test("a broad learning goal needs no assessment and survives a real restart with notes and mode", async () => {
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect(page.locator(".laboratory")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Open visual laboratory", exact: true }),
  ).toHaveCount(0);
  await screenshot("welcome-light.png");
  await createLearningSession(page, "Understand the natural world");
  await expect(page.locator(".lesson-top h1")).toHaveText(
    "Understand the natural world",
  );
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    page.getByText("Your broad goal is saved.", { exact: false }),
  ).toBeVisible();
  await expect(page.getByLabel("Your practice answer")).toHaveCount(0);
  await page
    .getByLabel("Learning mode", { exact: true })
    .selectOption("Explore");
  await page.getByRole("button", { name: "Notes", exact: true }).click();
  await page
    .getByLabel("Session notes")
    .fill("Continue with a broad map of matter, living systems, and evidence.");
  await saved(
    (data) =>
      data.lessons.length === 1 &&
      data.lessons[0].mode === "Explore" &&
      data.lessons[0].notes.includes("broad map"),
  );
  const first = await stored();
  expect(first.settings.assessments).toBe(false);
  expect(first.lessons[0].objective).toBe("Understand the natural world");
  expect(first.lessons[0].messages).toEqual([]);

  // No account is connected; the UI must explain that, preserving the lesson.
  await openTutor(page);
  await page
    .getByLabel("Message the tutor")
    .fill("Begin with a useful overview.");
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  const connection = page.getByRole("region", {
    name: "Settings",
    exact: true,
  });
  await expect(
    connection.getByText("Disconnected", { exact: true }),
  ).toBeVisible();
  await expect(
    connection.getByText(
      "Learning Studio never switches to paid API billing.",
      { exact: false },
    ),
  ).toBeVisible();
  await expect(
    connection.getByRole("checkbox", { name: /Allow background model usage/ }),
  ).not.toBeChecked();
  await closeSettings();
  await expect(page.locator(".lesson-top h1")).toHaveText(
    "Understand the natural world",
  );
  await app.close();
  await launch(directory);
  await openDestination(page, "Learning workspace: Lesson");
  await expect(page.locator(".lesson-top h1")).toHaveText(
    "Understand the natural world",
  );
  await expect(page.getByLabel("Learning mode", { exact: true })).toHaveValue(
    "Explore",
  );
  await page.getByRole("button", { name: "Notes", exact: true }).click();
  await expect(page.getByLabel("Session notes")).toHaveValue(
    "Continue with a broad map of matter, living systems, and evidence.",
  );
  const reopened = await stored();
  expect(reopened.activeLessonId).toBe(first.activeLessonId);
  expect(reopened.lessons[0].position).toBe(first.lessons[0].position);
  await page
    .getByLabel("Learning mode", { exact: true })
    .selectOption("Deep Dive");
  await saved(
    (data) =>
      data.lessons[0].mode === "Deep Dive" &&
      data.lessons[0].id === first.lessons[0].id,
  );
});

test("the clearly labeled reference lesson renders mathematics, calculated plots, SVG diagrams, and optional practice", async () => {
  await seedReferenceLesson(page);
  await expect(page.locator(".lesson-top h1")).toHaveText(
    "The shape of change",
  );
  await openConversationRecord(page);
  await expect(
    page.getByText(
      "This is a built-in reference example, written to demonstrate the workspace.",
      { exact: false },
    ),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Return to lesson", exact: true })
    .click();
  await expect
    .poll(() => page.locator(".reading-column .katex").count())
    .toBeGreaterThan(3);
  await expect(page.locator(".reading-column .katex-error")).toHaveCount(0);
  const plot = page.locator(".reading-column .plot-canvas");
  await expect(plot.locator(".main-svg").first()).toBeVisible();
  await page
    .getByRole("slider", { name: "Tangent at x", exact: true })
    .press("End");
  await expect
    .poll(() =>
      plot.evaluate((element) => {
        const trace = (
          element as HTMLElement & { data?: { x: number[]; y: number[] }[] }
        ).data?.[1];
        return trace
          ? (trace.y.at(-1)! - trace.y[0]) / (trace.x.at(-1)! - trace.x[0])
          : null;
      }),
    )
    .toBeCloseTo(6, 5);
  await plot
    .locator("..")
    .getByRole("button", { name: "Animate", exact: true })
    .click();
  await plot
    .locator("..")
    .getByRole("button", { name: "Pause", exact: true })
    .click();
  await plot
    .locator("..")
    .getByRole("button", { name: "Reset", exact: true })
    .click();
  await expect(
    page.getByRole("slider", { name: "Tangent at x", exact: true }),
  ).toHaveValue("1");
  const diagram = page.getByRole("region", {
    name: "From change to a local model",
    exact: true,
  });
  await diagram
    .getByRole("button", { name: "Explain Average rate", exact: true })
    .click();
  await expect(
    diagram.getByText("Divide by h while h ≠ 0.", { exact: true }),
  ).toBeVisible();
  await diagram
    .getByRole("button", { name: "Expand visualization", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", {
      name: "From change to a local model",
      exact: true,
    }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("dialog", {
      name: "From change to a local model",
      exact: true,
    }),
  ).toHaveCount(0);
  await expect(page.getByLabel("Your practice answer")).toHaveValue("");
  await expect(
    page.getByText("You can continue without answering.", { exact: false }),
  ).toBeVisible();
  await page
    .getByLabel("Learning mode", { exact: true })
    .selectOption("Practice");
  await page.getByLabel("Learning mode", { exact: true }).selectOption("Learn");
  await page.locator(".lesson-reader").evaluate((el) => {
    el.scrollTop = 0;
  });
  await screenshot("lesson-light.png");
  await settings();
  await page
    .locator(".appearance-modes")
    .getByRole("button", { name: "Dark", exact: true })
    .click();
  await page.getByRole("button", { name: /Warm Mocha/ }).click();
  await closeSettings();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect
    .poll(() =>
      plot.evaluate(
        (el) =>
          (el as HTMLElement & { layout?: { paper_bgcolor: string } }).layout
            ?.paper_bgcolor,
      ),
    )
    .toBe("#39312a");
  await screenshot("lesson-dark.png");
  expect((await stored()).concepts).toEqual([]);
});

test("roadmap goals, lesson position, optional practice, and reading progress survive restart", async () => {
  await seedReferenceLesson(page);
  await openRoadmap(page);
  await page
    .getByLabel("Lesson position", { exact: true })
    .fill("Linking the difference quotient to local slope");
  await page
    .getByLabel("New roadmap goal", { exact: true })
    .fill("Limits and neighborhoods");
  await page
    .getByRole("button", { name: "Add roadmap goal", exact: true })
    .click();
  await page
    .getByRole("button", {
      name: "Mark Limits and neighborhoods visited",
      exact: true,
    })
    .click();
  await page
    .getByLabel("New roadmap goal", { exact: true })
    .fill("Tangent applications");
  await page
    .getByRole("button", { name: "Add roadmap goal", exact: true })
    .click();
  const answer =
    "At x = 3, the derivative is 6. A small input change gives approximately six times that output change.";
  await page.getByLabel("Your practice answer", { exact: true }).fill(answer);
  await page
    .getByRole("button", { name: "Skip this exercise", exact: true })
    .click();
  await expect(
    page.getByLabel("Your practice answer", { exact: true }),
  ).toBeDisabled();
  await page
    .getByLabel("Learning mode", { exact: true })
    .selectOption("Review");
  await saved(
    (data) =>
      data.lessons[0].position ===
        "Linking the difference quotient to local slope" &&
      data.lessons[0].goals?.length === 2 &&
      Object.values(data.lessons[0].exerciseResponses || {}).some(
        (response) => response.answer === answer && response.skipped,
      ),
  );
  await expect
    .poll(async () => {
      await page.locator(".lesson-reader").evaluate((el) => {
        el.scrollTop = (el.scrollHeight - el.clientHeight) * 0.7;
        el.dispatchEvent(new Event("scroll"));
      });
      return (await stored()).lessons[0].readingProgress || 0;
    })
    .toBeCloseTo(0.7, 1);
  await app.close();
  await launch(directory);
  await openDestination(page, "Learning workspace: Lesson");
  await expect(page.locator(".lesson-top h1")).toHaveText(
    "The shape of change",
  );
  await expect
    .poll(() =>
      page
        .locator(".lesson-reader")
        .evaluate((el) => el.scrollTop / (el.scrollHeight - el.clientHeight)),
    )
    .toBeCloseTo(0.7, 1);
  await expect(page.getByLabel("Learning mode", { exact: true })).toHaveValue(
    "Review",
  );
  await expect(
    page.getByLabel("Your practice answer", { exact: true }),
  ).toHaveValue(answer);
  await expect(
    page.getByLabel("Your practice answer", { exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Resume exercise", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Resume exercise", exact: true })
    .click();
  await expect(
    page.getByLabel("Your practice answer", { exact: true }),
  ).toBeEnabled();
  await openRoadmap(page);
  await expect(page.getByLabel("Lesson position", { exact: true })).toHaveValue(
    "Linking the difference quotient to local slope",
  );
  await expect(
    page.getByRole("button", {
      name: "Mark Limits and neighborhoods planned",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", {
      name: "Mark Tangent applications visited",
      exact: true,
    }),
  ).toBeVisible();
  expect((await stored()).concepts).toEqual([]);
});

test("library resources and an editable evidence-based knowledge graph connect back to a saved lesson", async () => {
  await seedReferenceLesson(page);
  await expect(page.locator(".laboratory")).toHaveCount(0);
  await page
    .locator(".main-nav")
    .getByRole("button", { name: /Your library/ })
    .click();
  await page
    .getByRole("button", { name: "Add to library", exact: true })
    .click();
  await page.getByLabel("Resource title").fill("Curiosity Studies");
  await page
    .getByLabel("Resource type", { exact: true })
    .selectOption("subject");
  await page
    .getByLabel("Resource content")
    .fill("An entirely custom subject area.");
  await page
    .getByRole("button", { name: "Save resource", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Add to library", exact: true })
    .click();
  await page.getByLabel("Resource title").fill("Change journal");
  await page.getByLabel("Resource subject").fill("Curiosity Studies");
  await page
    .getByLabel("Resource content")
    .fill("A first impression is not evidence of understanding.");
  await page
    .getByRole("button", { name: "Save resource", exact: true })
    .click();
  await page.getByLabel("Search library").fill("Change journal");
  await expect(page.locator(".lib-resource")).toHaveCount(1);
  await expect(page.locator(".lib-resource h2")).toHaveText("Change journal");
  await page
    .getByRole("button", { name: "Edit resource", exact: true })
    .click();
  await page
    .getByLabel("Resource content")
    .fill(
      "A first impression is not evidence of understanding. Revisit the derivation.",
    );
  await page
    .getByRole("button", { name: "Save resource", exact: true })
    .click();
  await saved(
    (data) =>
      data.library.length === 2 &&
      data.library.some((item) =>
        item.content.endsWith("Revisit the derivation."),
      ),
  );
  await page
    .locator(".main-nav")
    .getByRole("button", { name: /Knowledge graph/ })
    .click();
  await page.getByRole("button", { name: "Add concept", exact: true }).click();
  await page.getByLabel("Concept name").fill("Rate of change");
  await page.getByLabel("Concept understanding").selectOption("demonstrated");
  await page
    .getByRole("button", { name: "Create concept", exact: true })
    .click();
  await expect(page.getByRole("alert")).toHaveText(
    /Add evidence of understanding/,
  );
  await page
    .getByLabel("Evidence of understanding")
    .fill(
      "Explained local change and solved a separate tangent-slope problem.",
    );
  await page
    .getByRole("button", { name: "Create concept", exact: true })
    .click();
  await page.getByRole("button", { name: "Add concept", exact: true }).click();
  await page.getByLabel("Concept name").fill("Derivative");
  await page
    .getByLabel("Linked lesson")
    .selectOption({ label: "The shape of change" });
  await page
    .getByRole("button", { name: "Create concept", exact: true })
    .click();
  await page
    .locator(".react-flow__node")
    .filter({ hasText: "Rate of change" })
    .click();
  await page
    .getByLabel("Connection type", { exact: true })
    .selectOption("prerequisite");
  await page
    .getByLabel("Connect to concept")
    .selectOption({ label: "Derivative" });
  await page
    .getByRole("button", { name: "Connect concepts", exact: true })
    .click();
  await saved(
    (data) =>
      data.relations.length === 1 && data.relations[0].kind === "prerequisite",
  );
  const graph = await stored();
  expect(graph.concepts.find((c) => c.label === "Derivative")?.status).toBe(
    "unassessed",
  );
  expect(graph.concepts.find((c) => c.label === "Derivative")?.evidence).toBe(
    "",
  );
  expect(graph.relations[0].source).toBe(
    graph.concepts.find((c) => c.label === "Rate of change")?.id,
  );
  await page.locator(".ks-details").evaluate((el) => {
    el.scrollTop = 0;
  });
  await page.locator(".react-flow__controls-fitview").click();
  await screenshot("graph.png");
  await page
    .getByRole("button", {
      name: "Reset understanding & evidence",
      exact: true,
    })
    .click();
  await saved((data) =>
    data.concepts.some(
      (c) =>
        c.label === "Rate of change" &&
        c.status === "unassessed" &&
        c.evidence === "",
    ),
  );
  await page.getByLabel("Search concepts").fill("Derivative");
  await expect(
    page.locator(".react-flow__node").filter({ hasText: "Rate of change" }),
  ).toHaveCount(0);
  await page
    .locator(".react-flow__node")
    .filter({ hasText: "Derivative" })
    .click();
  await page
    .getByRole("button", { name: "Open linked lesson", exact: true })
    .click();
  await expect(page.locator(".lesson-top h1")).toHaveText(
    "The shape of change",
  );
});

test("independent custom light and dark palettes, typography, presets, and system appearance persist", async () => {
  await settings();
  await page.getByRole("button", { name: /Warm Beige/ }).click();
  await page.getByRole("button", { name: "Colors", exact: true }).click();
  const light = {
    Application: "#e7ded2",
    "Lesson reading": "#f4eadf",
    "Body text": "#322e29",
    "Bold text": "#70442d",
    "Italic text": "#6c5c50",
    Headings: "#4f453c",
    "Primary accent": "#6c573f",
  };
  for (const [label, value] of Object.entries(light))
    await page.getByLabel(label + " hex", { exact: true }).fill(value);
  await expect.poll(() => cssToken("bg")).toBe(light.Application);
  await expect.poll(() => cssToken("text")).toBe(light["Body text"]);
  await expect.poll(() => cssToken("bold")).toBe(light["Bold text"]);
  await expect.poll(() => cssToken("italic")).toBe(light["Italic text"]);
  await expect.poll(() => cssToken("heading")).toBe(light.Headings);
  await expect.poll(() => cssToken("accent")).toBe(light["Primary accent"]);
  await page.getByRole("button", { name: "Typography", exact: true }).click();
  await page
    .getByRole("combobox", { name: "Reading font", exact: true })
    .selectOption("Cambria, serif");
  await range("Reading size", "Home", 7);
  await range("Line height", "Home", 15);
  await range("Heading weight", "End", 2, "ArrowLeft");
  await expect.poll(() => cssToken("reading-font")).toBe("Cambria, serif");
  await expect.poll(() => cssToken("reading-size")).toBe("20px");
  await expect.poll(() => cssToken("line-height")).toBe("2");
  await expect.poll(() => cssToken("heading-weight")).toBe("700");
  await page.getByRole("button", { name: "Presets", exact: true }).click();
  await page.getByLabel("Preset name").fill("My light reading");
  await page.getByRole("button", { name: "Save preset", exact: true }).click();
  await page.getByLabel("Preset name").fill("Light copy");
  await page.getByRole("button", { name: "Duplicate", exact: true }).click();
  await page.getByLabel("Preset name").fill("Light reading room");
  await page.getByRole("button", { name: "Save preset", exact: true }).click();
  await expect(
    page.getByRole("button", { name: /Light reading room/ }),
  ).toBeVisible();
  await page
    .locator(".appearance-modes")
    .getByRole("button", { name: "Dark", exact: true })
    .click();
  await page.getByRole("button", { name: /Warm Mocha/ }).click();
  await page.getByRole("button", { name: "Colors", exact: true }).click();
  await page.getByLabel("Application hex", { exact: true }).fill("#302923");
  await page.getByLabel("Body text hex", { exact: true }).fill("#ebe2d5");
  await page.getByLabel("Bold text hex", { exact: true }).fill("#efc69a");
  await page.getByRole("button", { name: "Typography", exact: true }).click();
  await expect(
    page.getByRole("slider", { name: "Reading size", exact: true }),
  ).toHaveValue("18");
  await page.getByRole("button", { name: "Presets", exact: true }).click();
  await page.getByLabel("Preset name").fill("My dark reading");
  await page.getByRole("button", { name: "Save preset", exact: true }).click();
  await page.locator(".settings-content").evaluate((el) => {
    el.scrollTop = 0;
  });
  await screenshot("appearance.png");
  await page
    .locator(".appearance-modes")
    .getByRole("button", { name: "Light", exact: true })
    .click();
  await expect.poll(() => cssToken("bg")).toBe(light.Application);
  await expect.poll(() => cssToken("reading-size")).toBe("20px");
  await page
    .locator(".appearance-modes")
    .getByRole("button", { name: "System", exact: true })
    .click();
  // Remove Playwright's default light-media emulation before exercising the
  // native host theme; otherwise it masks Windows/Electron theme changes.
  await page.emulateMedia({ colorScheme: null });
  await app.evaluate(({ nativeTheme }) => {
    nativeTheme.themeSource = "dark";
  });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect.poll(() => cssToken("bg")).toBe("#302923");
  await app.evaluate(({ nativeTheme }) => {
    nativeTheme.themeSource = "light";
  });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await saved((data) => {
    const appearance = data.appearance as {
      mode: string;
      light: { colors: Record<string, string>; typography: { size: number } };
      dark: { colors: Record<string, string>; typography: { size: number } };
      saved: { name: string }[];
    };
    return (
      appearance.mode === "system" &&
      appearance.light.colors.bg === light.Application &&
      appearance.dark.colors.bold === "#efc69a" &&
      appearance.light.typography.size === 20 &&
      appearance.dark.typography.size === 18 &&
      appearance.saved.some((p) => p.name === "Light reading room") &&
      appearance.saved.some((p) => p.name === "My dark reading")
    );
  });
  await app.close();
  await launch(directory);
  await settings();
  await page
    .locator(".appearance-modes")
    .getByRole("button", { name: "Light", exact: true })
    .click();
  await expect.poll(() => cssToken("bg")).toBe(light.Application);
  await expect.poll(() => cssToken("reading-font")).toBe("Cambria, serif");
  await expect.poll(() => cssToken("reading-size")).toBe("20px");
  await page.getByRole("button", { name: "Colors", exact: true }).click();
  for (const [label, value] of Object.entries(light))
    await expect(page.getByLabel(label + " hex", { exact: true })).toHaveValue(
      value,
    );
  await page
    .locator(".appearance-modes")
    .getByRole("button", { name: "Dark", exact: true })
    .click();
  await expect(page.getByLabel("Application hex", { exact: true })).toHaveValue(
    "#302923",
  );
  await expect(page.getByLabel("Body text hex", { exact: true })).toHaveValue(
    "#ebe2d5",
  );
  await expect(page.getByLabel("Bold text hex", { exact: true })).toHaveValue(
    "#efc69a",
  );
});
