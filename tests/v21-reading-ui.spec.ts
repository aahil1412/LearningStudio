import {
  openDestination,
  openReadingControls,
  openTutor,
} from "./ui-navigation";
import {
  test,
  expect,
  _electron as electron,
  chromium,
  type ElectronApplication,
  type Page,
} from "@playwright/test";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { StudioData, Lesson } from "../src/types";
import type { Subject } from "../src/v2types";
import { defaultAppearance } from "../src/lib/themes";

let app: ElectronApplication, page: Page, directory: string;
async function launch() {
  const env: Record<string, string> = Object.fromEntries(
    Object.entries({ ...process.env, STUDIO_DATA_DIR: directory }).filter(
      (item): item is [string, string] => typeof item[1] === "string",
    ),
  );
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.STUDIO_DEV_URL;
  app = await electron.launch({ args: ["."], cwd: process.cwd(), env });
  page = await app.firstWindow();
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setContentSize(1440, 980),
  );
  await expect(page.locator(".titlebar-center")).toHaveText("Saved locally");
  await page.bringToFront();
}
async function call<T>(action: string, payload?: unknown) {
  return page.evaluate(
    ({ action, payload }) => window.studio!.invoke<T>(action, payload),
    { action, payload },
  );
}
test.beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "studio-v21-reading-"));
  await launch();
});
test.afterEach(async () => {
  await app?.close().catch(() => {});
  await rm(directory, {
    recursive: true,
    force: true,
    maxRetries: 8,
    retryDelay: 200,
  });
});
test("real Electron reading controls, keyboard zoom and portable offline font settings survive restart", async () => {
  test.setTimeout(120000);
  const subject = await call<Subject>("subject:create", {
    name: "Readable scientific study",
    objective: "Understand assumptions and equations",
    depth: "comprehensive",
  });
  const lesson = await call<Lesson>("subject:conversation-create", {
    subjectId: subject.id,
    title: "Reading and equations",
    mode: "Learn",
  });
  const data = await call<StudioData>("data:load");
  const appearance = defaultAppearance();
  appearance.mode = "light";
  await call("data:save", {
    ...data,
    appearance,
    activeSubjectId: subject.id,
    activeLessonId: lesson.id,
    lessons: data.lessons.map((l) =>
      l.id === lesson.id
        ? {
            ...l,
            messages: [
              {
                id: "reading-source",
                role: "assistant",
                text: "A normalized density has total probability one.",
                content: [
                  {
                    type: "text",
                    text: "A normalized density has total probability one. Its assumptions determine the calculation.",
                  },
                  { type: "equation", latex: "\\int_0^\\infty p(x)\\,dx=1" },
                  {
                    type: "text",
                    text: "Check the units before applying the equation.",
                  },
                ],
                createdAt: new Date().toISOString(),
                status: "complete",
              },
            ],
          }
        : l,
    ),
  });
  await page.reload();
  await openDestination(page, "Learning workspace: Lesson");
  let paragraph = page
    .locator('[data-message-id="reading-source"] .markdown p')
    .first();
  await expect(paragraph).toBeVisible();
  await expect(paragraph).toHaveCSS("font-size", "18px");
  expect(
    await paragraph.evaluate((el) => getComputedStyle(el).fontFamily),
  ).toContain("Segoe UI");
  await expect(page.locator(".visual-lab")).toHaveCount(0);
  await openReadingControls(page);
  await page.getByRole("button", { name: "A+ Larger", exact: true }).click();
  await page.getByRole("button", { name: "A+ Larger", exact: true }).click();
  await expect(paragraph).toHaveCSS("font-size", "20px");
  await openTutor(page);
  await page
    .getByLabel("Message the tutor")
    .fill("An input remains editable: x=1");
  await page.keyboard.press("Control+=");
  await expect
    .poll(
      async () =>
        (await call<{ zoomFactor: number }>("app:diagnostics")).zoomFactor,
    )
    .toBeCloseTo(1.1, 2);
  await page.keyboard.press("Control+-");
  await expect
    .poll(
      async () =>
        (await call<{ zoomFactor: number }>("app:diagnostics")).zoomFactor,
    )
    .toBeCloseTo(1, 2);
  await page.keyboard.press("Control+=");
  await page.keyboard.press("Control+=");
  await expect
    .poll(
      async () =>
        (await call<{ zoomFactor: number }>("app:diagnostics")).zoomFactor,
    )
    .toBeCloseTo(1.2, 2);
  await page.keyboard.press("Control+0");
  await expect
    .poll(
      async () =>
        (await call<{ zoomFactor: number }>("app:diagnostics")).zoomFactor,
    )
    .toBe(1);
  await openReadingControls(page);
  await page.getByLabel("Open typography settings").press("Enter");
  await expect(
    page.getByRole("combobox", { name: "Reading font", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("combobox", { name: "Reading font", exact: true })
    .selectOption("Consolas, monospace");
  await page
    .getByRole("button", { name: "Close settings", exact: true })
    .click();
  await expect(paragraph).toHaveCSS("font-family", /Consolas/);
  await page.keyboard.press("Control+=");
  await page.keyboard.press("Control+=");
  await expect
    .poll(
      async () =>
        (await call<{ zoomFactor: number }>("app:diagnostics")).zoomFactor,
    )
    .toBeCloseTo(1.2, 2);
  await expect(page.locator(".titlebar-center")).toHaveText("Saved locally");
  await mkdir(join(process.cwd(), "docs/screenshots"), { recursive: true });
  await page.screenshot({
    path: "docs/screenshots/v21-reading-controls-light.png",
  });
  await app.close();
  await launch();
  await openDestination(page, "Learning workspace: Lesson");
  paragraph = page
    .locator('[data-message-id="reading-source"] .markdown p')
    .first();
  await expect(paragraph).toHaveCSS("font-family", /Consolas/);
  await expect(paragraph).toHaveCSS("font-size", "20px");
  await expect
    .poll(
      async () =>
        (await call<{ zoomFactor: number }>("app:diagnostics")).zoomFactor,
    )
    .toBeCloseTo(1.2, 2);
  await page.keyboard.press("Control+0");
  await expect
    .poll(
      async () =>
        (await call<{ zoomFactor: number }>("app:diagnostics")).zoomFactor,
    )
    .toBe(1);
  const preview = await call<{ url: string }>("export:preview", {
    scope: "selection",
    subjectId: subject.id,
    title: "Readable offline lesson",
    lessonIds: [lesson.id],
    chapterIds: [],
    includeUserMessages: true,
    includeNotes: true,
    embedCachedResources: false,
  });
  const browser = await chromium.launch({ channel: "chrome" });
  try {
    const context = await browser.newContext({ offline: true });
    const offline = await context.newPage();
    await offline.goto(preview.url);
    await expect(
      offline.locator(".offline-main .markdown p").first(),
    ).toHaveCSS("font-family", /Consolas/);
    await expect(offline.locator(".katex").first()).toBeVisible();
  } finally {
    await browser.close();
  }
  await openReadingControls(page);
  await page.getByLabel("Open typography settings").click();
  await page
    .locator(".appearance-modes")
    .getByRole("button", { name: "Dark", exact: true })
    .click();
  await page
    .getByRole("combobox", { name: "Reading font", exact: true })
    .selectOption('"Segoe UI", Arial, sans-serif');
  await page
    .getByRole("button", { name: "Close settings", exact: true })
    .click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await openReadingControls(page);
  await page.getByRole("button", { name: /px Reset$/ }).click();
  await expect(paragraph).toHaveCSS("font-size", "18px");
  await page.screenshot({
    path: "docs/screenshots/v21-reading-controls-dark.png",
  });
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setContentSize(900, 740),
  );
  await page.keyboard.press("Control+=");
  await openTutor(page);
  await expect(page.getByLabel("Message the tutor")).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("a document highlight opens its exact original page", async () => {
  const subject = await call<Subject>("subject:create", {
    name: "Document annotations",
    objective: "Study source pages",
    depth: "overview",
  });
  const data = await call<StudioData>("data:load");
  await call("data:save", {
    ...data,
    activeSubjectId: subject.id,
    library: [
      ...data.library,
      {
        id: "two-pages",
        kind: "document",
        subjectId: subject.id,
        subject: subject.name,
        title: "Two source pages",
        content: "First page.\n\nA precise second-page quotation.",
        createdAt: new Date().toISOString(),
        pages: [
          { page: 1, text: "First page." },
          { page: 2, text: "A precise second-page quotation." },
        ],
      },
    ],
  });
  await call("annotations:create", {
    subjectId: subject.id,
    sourceKind: "document",
    sourceId: "two-pages",
    page: 2,
    quote: "A precise second-page quotation.",
    prefix: "",
    suffix: "",
    color: "green",
    note: "An exact location",
    tags: [],
  });
  await page.reload();
  await openDestination(page, "Highlights & annotations");
  await page
    .getByRole("button", { name: "Jump to source", exact: true })
    .click();
  await expect(
    page.getByRole("combobox", { name: "Document page", exact: true }),
  ).toHaveValue("2");
  await expect(
    page.locator('[data-annotation-kind="document"][data-annotation-page="2"]'),
  ).toContainText("A precise second-page quotation.");
  await expect
    .poll(() =>
      page.evaluate(
        () => (CSS as any).highlights?.get("studio-green")?.size || 0,
      ),
    )
    .toBe(1);
});
