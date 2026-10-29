import { openDestination } from "./ui-navigation";
import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page,
} from "@playwright/test";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { ContentBlock, Lesson, StudioData } from "../src/types";
import type { Subject, SubjectRecord, VisualInstance } from "../src/v2types";
import { makeVisualInstance } from "../src/lib/visualState";

let app: ElectronApplication, page: Page, directory: string;
async function launch() {
  const env = Object.fromEntries(
    Object.entries({ ...process.env, STUDIO_DATA_DIR: directory }).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.STUDIO_DEV_URL;
  app = await electron.launch({
    args: [".", "--start-hidden"],
    cwd: process.cwd(),
    env,
  });
  page = await app.firstWindow();
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0].webContents.setBackgroundThrottling(false);
    BrowserWindow.getAllWindows()[0].setContentSize(1500, 1100);
  });
  await expect(page.locator(".titlebar-center")).toHaveText("Saved locally");
}
const call = <T = unknown>(action: string, payload?: unknown) =>
  page.evaluate(
    ({ action, payload }) => window.studio!.invoke<T>(action, payload),
    { action, payload },
  );
test.beforeEach(async () => {
  await mkdir(".tools", { recursive: true });
  directory = await mkdtemp(join(resolve(".tools"), "inline-only-"));
  await launch();
});
test.afterEach(async () => {
  await app?.close().catch(() => {});
  if (!resolve(directory).startsWith(join(resolve(".tools"), "inline-only-")))
    throw new Error(
      "Refusing to remove a fixture outside the inline test directory.",
    );
  await rm(directory, { recursive: true, force: true });
});

test("new and legacy lessons remain inline without a lab or unrelated example, retaining interactive state through fullscreen and restart", async () => {
  await expect(
    page.locator(
      ".laboratory,.visual-lab,[data-visual-dock=side],[data-visual-dock=split]",
    ),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Open visual laboratory", exact: true }),
  ).toHaveCount(0);
  await expect(page.locator(".plot-canvas,.science-plot-canvas")).toHaveCount(
    0,
  );
  const subject = await call<Subject>("subject:create", {
    name: "An inline scientific explanation",
    objective: "Understand a deliberately chosen oscillation",
    depth: "overview",
  });
  const lesson = await call<Lesson>("subject:conversation-create", {
    subjectId: subject.id,
    title: "An actual chosen figure",
    mode: "Learn",
  });
  const block: ContentBlock = {
    type: "plot",
    spec: { kind: "wave", title: "The oscillation in this lesson" },
  };
  const id = "legacy-inline-message:1";
  const instance = makeVisualInstance(subject.id, block, {
    id,
    originMessageId: "legacy-inline-message",
    placement: "side",
    state: {
      "plot.parameters": { amplitude: 2.4, frequency: 0.7, phase: 0.2 },
      "plot.layout": {
        xaxis: { range: [-2, 2], autorange: false },
        yaxis: { range: [-3, 3], autorange: false },
      },
    },
  });
  await call("subject:record-put", {
    subjectId: subject.id,
    recordType: "visual",
    id,
    title: instance.title,
    data: instance,
    expectedRevision: 0,
  });
  const unrelated = makeVisualInstance(
    subject.id,
    {
      type: "plot",
      spec: { kind: "wave", title: "An unrelated legacy example" },
    },
    { id: "unrelated-legacy-wave", placement: "side" },
  );
  await call("subject:record-put", {
    subjectId: subject.id,
    recordType: "visual",
    id: unrelated.id,
    title: unrelated.title,
    data: unrelated,
    expectedRevision: 0,
  });
  const data = await call<StudioData>("data:load"),
    at = new Date().toISOString();
  await call("data:save", {
    ...data,
    activeSubjectId: subject.id,
    activeLessonId: lesson.id,
    settings: {
      ...data.settings,
      labOpen: true,
      visualizationPlacement: "side",
    },
    lessons: data.lessons.map((item) =>
      item.id === lesson.id
        ? {
            ...item,
            messages: [
              {
                id: "legacy-inline-message",
                role: "assistant",
                text: "",
                content: [
                  { type: "text", text: "Before this chosen figure." },
                  block,
                  { type: "text", text: "After this chosen figure." },
                ],
                status: "complete",
                createdAt: at,
              },
            ],
          }
        : item,
    ),
  });
  await page.reload();
  await openDestination(page, "Learning workspace: Lesson");
  const host = page.locator(`[data-visual-host="${id}"]`);
  await expect(host).toHaveAttribute("data-placement", "inline");
  await expect(page.locator(".lesson-reader [data-visual-host]")).toHaveCount(
    1,
  );
  await expect(
    page.locator('[data-visual-host="unrelated-legacy-wave"]'),
  ).toHaveCount(0);
  await expect(
    page.locator(
      ".laboratory,.visual-lab,[data-visual-dock=side],[data-visual-dock=split]",
    ),
  ).toHaveCount(0);
  await expect(
    host.getByRole("slider", { name: "Amplitude", exact: true }),
  ).toHaveValue("2.4");
  await expect(
    host.getByRole("button", { name: "Move visual side", exact: true }),
  ).toHaveCount(0);
  await expect(
    host.getByRole("button", { name: "Move visual split", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByText("Explore a harmonic wave", { exact: true }),
  ).toHaveCount(0);
  const saved = await call<SubjectRecord<VisualInstance>>(
    "subject:record-get",
    { subjectId: subject.id, id, recordType: "visual" },
  );
  expect(saved.data.placement).toBe("side");
  expect(saved.data.state["plot.parameters"]).toMatchObject({
    amplitude: 2.4,
    frequency: 0.7,
  });
  await host.evaluate((el) => {
    (window as any).__inlineHost = el;
    (window as any).__inlinePlot = el.querySelector(".plot-canvas");
  });
  for (const placement of ["fullscreen", "inline"]) {
    await host
      .getByRole("button", { name: `Move visual ${placement}`, exact: true })
      .click();
    await expect(
      host.getByRole("slider", { name: "Amplitude", exact: true }),
    ).toHaveValue("2.4");
    expect(
      await host.evaluate(
        (el) =>
          el === (window as any).__inlineHost &&
          el.querySelector(".plot-canvas") === (window as any).__inlinePlot,
      ),
    ).toBe(true);
  }
  await app.close();
  await launch();
  await openDestination(page, "Learning workspace: Lesson");
  await expect(page.locator(`[data-visual-host="${id}"]`)).toHaveAttribute(
    "data-placement",
    "inline",
  );
  await expect(
    page.getByRole("slider", { name: "Amplitude", exact: true }),
  ).toHaveValue("2.4");
  await mkdir("docs/screenshots", { recursive: true });
  await page.screenshot({
    path: "docs/screenshots/2.1.2-inline-only-lesson.png",
  });
});

test("manual figure authoring is available in the notebook and creates no preset plot before an explicit model choice", async () => {
  const subject = await call<Subject>("subject:create", {
    name: "A deliberate visual notebook",
    objective: "Author and save a chosen mathematical figure",
    depth: "overview",
  });
  await openDestination(page, "Subject workspaces: My learning");
  await page.locator(".subject-tile").filter({ hasText: subject.name }).click();
  await openDestination(page, "Visual notebook");
  await expect(page.locator(".visual-lab")).toHaveCount(0);
  await page
    .getByRole("button", { name: "Author a figure", exact: true })
    .click();
  const tools = page.getByRole("region", {
    name: "Figure authoring tools",
    exact: true,
  });
  await expect(tools).toBeVisible();
  await expect(page.locator(".plot-canvas")).toHaveCount(0);
  await tools.getByRole("tab", { name: "Plots", exact: true }).click();
  await expect(page.locator(".plot-canvas")).toHaveCount(0);
  await tools
    .getByRole("combobox", { name: "Mathematical model", exact: true })
    .selectOption("wave");
  await expect(tools.locator(".plot-canvas .main-svg").first()).toBeVisible();
  await tools
    .getByRole("slider", { name: "Amplitude", exact: true })
    .fill("1.8");
  await tools
    .getByRole("button", { name: "Save visual to notebook", exact: true })
    .click();
  await expect
    .poll(async () => {
      const records = await call<SubjectRecord<VisualInstance>[]>(
        "subject:record-list",
        { subjectId: subject.id, recordType: "visual", includeData: true },
      );
      return records.some(
        (record) =>
          (
            record.data.state["plot.parameters"] as
              { amplitude?: number } | undefined
          )?.amplitude === 1.8 && record.data.tags.includes("saved"),
      );
    })
    .toBe(true);
  await page.getByRole("button", { name: "Open live", exact: true }).click();
  await expect(tools).toHaveCount(0);
  const live = page.getByRole("region", {
    name: "Live saved figure",
    exact: true,
  });
  await expect(
    live.getByRole("slider", { name: "Amplitude", exact: true }),
  ).toHaveValue("1.8");
  await expect(
    page.locator(
      ".laboratory,[data-visual-dock=side],[data-visual-dock=split]",
    ),
  ).toHaveCount(0);
});
