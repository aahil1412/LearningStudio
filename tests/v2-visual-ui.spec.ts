import { openDestination } from "./ui-navigation";
import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page,
} from "@playwright/test";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import AxeBuilder from "@axe-core/playwright";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { StudioData, Lesson, ContentBlock } from "../src/types";
import type { Subject, SubjectRecord } from "../src/v2types";
let app: ElectronApplication, page: Page, directory: string;
async function launch() {
  const env: Record<string, string> = Object.fromEntries(
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
    BrowserWindow.getAllWindows()[0].setContentSize(1550, 1020);
  });
  await expect(page.locator(".titlebar-center")).toHaveText("Saved locally");
}
async function call<T = unknown>(action: string, payload?: unknown) {
  return page.evaluate(
    ({ action, payload }) => window.studio!.invoke<T>(action, payload),
    { action, payload },
  );
}
async function seed(
  block: ContentBlock = {
    type: "plot",
    spec: { kind: "wave", title: "Persistent wave" },
  },
) {
  const subject = await call<Subject>("subject:create", {
    name: "Scientific visual workspace",
    objective: "Explore mathematics and scientific representations",
    depth: "comprehensive",
  });
  const lesson = await call<Lesson>("subject:conversation-create", {
    subjectId: subject.id,
    title: "A stateful visual explanation",
    mode: "Explore",
  });
  const data = await call<StudioData>("data:load"),
    now = new Date().toISOString();
  await call("data:save", {
    ...data,
    activeSubjectId: subject.id,
    activeLessonId: lesson.id,
    lessons: data.lessons.map((item) =>
      item.id === lesson.id
        ? {
            ...item,
            messages: [
              {
                id: "visual-origin",
                role: "assistant",
                text: "A reusable, adjustable explanation.",
                createdAt: now,
                status: "complete",
                blocks: [
                  { type: "text", text: "Before the figure." },
                  block,
                  { type: "text", text: "After the figure." },
                ],
              },
            ],
          }
        : item,
    ),
  });
  await page.reload();
  await openDestination(page, "Learning workspace: Lesson");
  const host = page.locator('[data-visual-host="visual-origin:1"]');
  await expect(host.locator(".visual-instance-toolbar")).toBeVisible();
  return { subject, lesson, host };
}
async function openNotebook(subject: Subject) {
  await openDestination(page, "Subject workspaces: My learning");
  await page.locator(".subject-tile").filter({ hasText: subject.name }).click();
  await openDestination(page, "Visual notebook");
  await expect(
    page.getByRole("heading", { name: "Visual notebook", exact: true }),
  ).toBeVisible();
}
test.beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "studio-v2-visual-"));
  await launch();
});
test.afterEach(async () => {
  await app?.close().catch(() => {});
});
test("one mounted plot moves inline, fullscreen, collapses and restores parameters and axes after restart", async () => {
  const { subject, host } = await seed();
  await host
    .getByRole("slider", { name: "Amplitude", exact: true })
    .press("End");
  await expect(host.locator("output").first()).toHaveText("3.00");
  await host.evaluate((element) => {
    (window as any).__sameVisualHost = element;
    (window as any).__samePlotElement = element.querySelector(".plot-canvas");
  });
  const plot = host.locator(".plot-canvas");
  await expect(plot.locator(".main-svg").first()).toBeVisible();
  const box = await plot.boundingBox();
  await page.mouse.move(box!.x + 100, box!.y + 65);
  await page.mouse.down();
  await page.mouse.move(box!.x + 250, box!.y + 175, { steps: 7 });
  await page.mouse.up();
  const range = await plot.evaluate(
    (element) => (element as any).layout.xaxis.range as number[],
  );
  for (const placement of ["fullscreen", "inline"]) {
    await host
      .getByRole("button", { name: `Move visual ${placement}`, exact: true })
      .click();
    await expect(
      host.getByRole("slider", { name: "Amplitude", exact: true }),
    ).toHaveValue("3");
    expect(
      await host.evaluate(
        (element) =>
          element === (window as any).__sameVisualHost &&
          element.querySelector(".plot-canvas") ===
            (window as any).__samePlotElement,
      ),
    ).toBe(true);
    const current = await plot.evaluate(
      (element) => (element as any).layout.xaxis.range as number[],
    );
    expect(current[0]).toBeCloseTo(range[0], 7);
    expect(current[1]).toBeCloseTo(range[1], 7);
  }
  await host
    .getByRole("button", { name: "Save visual to notebook", exact: true })
    .click();
  await expect
    .poll(async () => {
      const record = await call<SubjectRecord<any>>("subject:record-get", {
        subjectId: subject.id,
        id: "visual-origin:1",
        recordType: "visual",
      });
      return record?.data.state["plot.parameters"]?.amplitude;
    })
    .toBe(3);
  await host
    .getByRole("button", { name: "Move visual collapsed", exact: true })
    .click();
  await expect(host).toBeHidden();
  expect(
    await host.evaluate(
      (element) => element === (window as any).__sameVisualHost,
    ),
  ).toBe(true);
  await page
    .locator('[data-visual-instance="visual-origin:1"]')
    .getByRole("button", { name: "Show inline", exact: true })
    .click();
  await expect(
    host.getByRole("slider", { name: "Amplitude", exact: true }),
  ).toHaveValue("3");
  await host
    .getByRole("button", { name: "Move visual fullscreen", exact: true })
    .click();
  await expect(host).toBeVisible();
  await host
    .getByRole("button", { name: "Move visual inline", exact: true })
    .click();
  await app.close();
  await launch();
  await openDestination(page, "Learning workspace: Lesson");
  const restored = page.locator('[data-visual-host="visual-origin:1"]');
  await expect(
    page.locator('.lesson-reader [data-visual-host="visual-origin:1"]'),
  ).toBeVisible();
  await expect(
    restored.getByRole("slider", { name: "Amplitude", exact: true }),
  ).toHaveValue("3");
  await expect
    .poll(() =>
      restored
        .locator(".plot-canvas")
        .evaluate((element) => (element as any).layout?.xaxis.range?.[0]),
    )
    .toBeCloseTo(range[0], 7);
  await expect(
    restored.getByRole("button", { name: "Move visual inline", exact: true }),
  ).toBeHidden();
  await mkdir("docs/screenshots", { recursive: true });
  await page.screenshot({ path: "docs/screenshots/v2-visual-inline.png" });
});
test("notebook annotations, tags, duplication and authored canvas survive a real app restart", async () => {
  const { subject, host } = await seed();
  await host
    .getByRole("button", { name: "Save visual to notebook", exact: true })
    .click();
  await openNotebook(subject);
  await page
    .getByRole("button", { name: /Persistent wave/ })
    .first()
    .click();
  await page
    .getByLabel("Saved visual title", { exact: true })
    .fill("A wave worth revisiting");
  await page
    .getByLabel("Saved visual tags", { exact: true })
    .fill("saved, waves, mathematics");
  await page
    .getByLabel("Visual annotation", { exact: true })
    .fill(
      "Amplitude changes vertical displacement while the period stays fixed.",
    );
  await page
    .getByRole("button", { name: "Add annotation", exact: true })
    .click();
  await expect(page.locator(".visual-annotation")).toContainText(
    "period stays fixed",
  );
  await page
    .getByLabel("Search visual notebook", { exact: true })
    .fill("waves");
  await expect(page.locator(".visual-gallery-card")).toHaveCount(1);
  await page.getByRole("button", { name: "Duplicate", exact: true }).click();
  await expect(page.locator(".visual-gallery-card")).toHaveCount(2);
  await mkdir("docs/screenshots", { recursive: true });
  await page.screenshot({ path: "docs/screenshots/v2-visual-notebook.png" });
  await page
    .getByRole("button", { name: "Open learning canvas", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Learning canvas", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Add note", exact: true }).click();
  await page
    .getByLabel("Canvas note", { exact: true })
    .fill("An explanation connected to a reusable scientific model.");
  await page
    .getByLabel("Saved visual for canvas", { exact: true })
    .selectOption({ label: "A wave worth revisiting" });
  await page.getByRole("button", { name: "Add visual", exact: true }).click();
  await expect(
    page.locator(".canvas-visual .plot-canvas .main-svg").first(),
  ).toBeVisible();
  await expect
    .poll(async () => {
      const record = await call<SubjectRecord<any>>("subject:record-get", {
        subjectId: subject.id,
        id: subject.id + ":canvas:main",
        recordType: "canvas",
      });
      return record?.data.nodes.length;
    })
    .toBe(2);
  await page.screenshot({ path: "docs/screenshots/v2-learning-canvas.png" });
  const canvasRecord = await call<SubjectRecord<any>>("subject:record-get", {
      subjectId: subject.id,
      id: subject.id + ":canvas:main",
    }),
    visualId = canvasRecord.data.nodes.find(
      (node: any) => node.kind === "visual",
    ).visualId,
    visualRecord = await call<SubjectRecord<any>>("subject:record-get", {
      subjectId: subject.id,
      id: visualId,
    });
  visualRecord.data.state["plot.parameters"].amplitude = 2.7;
  await page
    .locator(".learning-canvas-toolbar input[type=file]")
    .setInputFiles({
      name: "reusable-canvas.json",
      mimeType: "application/json",
      buffer: Buffer.from(
        JSON.stringify({
          schema: "learning-studio/canvas-v2",
          data: canvasRecord.data,
          visuals: [visualRecord.data],
          assets: {},
        }),
      ),
    });
  await expect(
    page
      .locator(".canvas-visual")
      .getByRole("slider", { name: "Amplitude", exact: true }),
  ).toHaveValue("2.7");
  await app.close();
  await launch();
  await openNotebook(subject);
  await page
    .getByRole("button", { name: "Open learning canvas", exact: true })
    .click();
  await expect(page.getByLabel("Canvas note", { exact: true })).toHaveValue(
    "An explanation connected to a reusable scientific model.",
  );
  await expect(page.locator(".canvas-visual .plot-canvas")).toHaveCount(1);
  await expect(
    page
      .locator(".canvas-visual")
      .getByRole("slider", { name: "Amplitude", exact: true }),
  ).toHaveValue("2.7");
});
test("a single mounted Three.js scene keeps its orientation through docking and rehydrates its camera after restart", async () => {
  const { subject, host } = await seed({
    type: "plot",
    spec: {
      kind: "surface",
      title: "A durable 3D surface",
      expressions: ["sin(x)*cos(y)"],
      domain: [-4, 4],
    },
  });
  const canvas = host.locator(".science-three-canvas canvas");
  await expect(canvas).toBeVisible();
  await canvas.evaluate((element) => {
    (window as any).__oneThreeCanvas = element;
  });
  await canvas.scrollIntoViewIfNeeded();
  const box = await canvas.boundingBox();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + 150);
  await page.mouse.down();
  await page.mouse.move(box!.x + box!.width / 2 + 60, box!.y + 190, {
    steps: 9,
  });
  await page.mouse.up();
  await expect
    .poll(async () => {
      const record = await call<SubjectRecord<any>>("subject:record-get", {
        subjectId: subject.id,
        id: "visual-origin:1",
      });
      return !!record?.data.state["three.camera"]?.position;
    })
    .toBe(true);
  await host
    .getByRole("button", { name: "Move visual fullscreen", exact: true })
    .click();
  expect(
    await canvas.evaluate(
      (element) => element === (window as any).__oneThreeCanvas,
    ),
  ).toBe(true);
  await host
    .getByRole("button", { name: "Move visual inline", exact: true })
    .click();
  await app.close();
  // OrbitControls damping is still an interaction after pointer-up. Compare
  // the final close checkpoint on disk, rather than an earlier moving frame.
  const database = new DatabaseSync(join(directory, "learning-studio.sqlite"), {
    readOnly: true,
  });
  let saved: {
    position: number[];
    quaternion: number[];
    target: number[];
    zoom: number;
  };
  try {
    const record = database
      .prepare("SELECT value FROM subject_records WHERE id=? AND subject_id=?")
      .get("visual-origin:1", subject.id) as { value: string };
    saved = JSON.parse(record.value).state["three.camera"];
  } finally {
    database.close();
  }
  await launch();
  await openDestination(page, "Learning workspace: Lesson");
  await expect(
    page.locator(
      '[data-visual-host="visual-origin:1"] .science-three-canvas canvas',
    ),
  ).toBeVisible();
  const restored = (
    await call<SubjectRecord<any>>("subject:record-get", {
      subjectId: subject.id,
      id: "visual-origin:1",
    })
  ).data.state["three.camera"];
  expect(restored.position).toEqual(saved.position);
  expect(restored.quaternion).toEqual(saved.quaternion);
  expect(restored.target).toEqual(saved.target);
  expect(restored.zoom).toEqual(saved.zoom);
});
test("ODE time and model parameters survive a real restart without resetting to the completed trajectory", async () => {
  const { subject, host } = await seed({
    type: "plot",
    spec: {
      kind: "ode",
      title: "A persistent oscillator",
      parameters: { k: 1 },
      ode: {
        variables: ["x", "v"],
        derivatives: ["v", "-k*x"],
        initial: [1, 0],
        duration: 10,
        step: 0.02,
      },
    },
  });
  const time = host.getByLabel("Simulation time", { exact: true });
  await expect(time).toBeVisible();
  await time.press("Home");
  await time.press("ArrowRight");
  await time.press("ArrowRight");
  await time.press("ArrowRight");
  await expect(time).toHaveValue("3");
  await expect
    .poll(async () => {
      const record = await call<SubjectRecord<any>>("subject:record-get", {
        subjectId: subject.id,
        id: "visual-origin:1",
      });
      return record?.data.state["advanced.timeIndex"];
    })
    .toBe(3);
  await app.close();
  await launch();
  await openDestination(page, "Learning workspace: Lesson");
  await expect(
    page
      .locator('[data-visual-host="visual-origin:1"]')
      .getByLabel("Simulation time", { exact: true }),
  ).toHaveValue("3");
});
test("a molecular source, representation, selection and camera restore from immutable subject assets @network", async () => {
  test.skip(
    !process.env.STUDIO_NETWORK_TESTS,
    "Enable real RCSB source acquisition with STUDIO_NETWORK_TESTS=1.",
  );
  const { subject, host } = await seed({
    type: "molecule",
    source: "pdb",
    id: "1CRN",
    caption: "Persistent crambin",
  });
  await expect(host.locator(".molecule-canvas canvas")).toBeVisible({
    timeout: 30000,
  });
  await host
    .getByLabel("Molecular representation", { exact: true })
    .selectOption("stick");
  await host.getByLabel("Atom serial number", { exact: true }).fill("2");
  await host
    .getByRole("button", { name: "Select source atom", exact: true })
    .click();
  const canvas = host.locator(".molecule-canvas canvas").first(),
    box = await canvas.boundingBox();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + 130);
  await page.mouse.down();
  await page.mouse.move(box!.x + box!.width / 2 + 30, box!.y + 160, {
    steps: 7,
  });
  await page.mouse.up();
  await expect
    .poll(async () => {
      const record = await call<SubjectRecord<any>>("subject:record-get", {
        subjectId: subject.id,
        id: "visual-origin:1",
      });
      return record?.data.state["molecule.structure"]?.assetId;
    })
    .toContain(":asset:");
  const before = (
    await call<SubjectRecord<any>>("subject:record-get", {
      subjectId: subject.id,
      id: "visual-origin:1",
    })
  ).data.state;
  await app.close();
  await launch();
  await openDestination(page, "Learning workspace: Lesson");
  const restored = page.locator('[data-visual-host="visual-origin:1"]');
  await expect(restored.locator(".molecule-canvas canvas")).toBeVisible();
  await expect(
    restored.getByLabel("Molecular representation", { exact: true }),
  ).toHaveValue("stick");
  await expect(restored.locator(".molecule-selection")).toContainText("CA");
  const assets = await call<SubjectRecord[]>("subject:record-list", {
    subjectId: subject.id,
    recordType: "asset",
    includeData: false,
  });
  expect(assets.length).toBeGreaterThan(0);
  const state = (
    await call<SubjectRecord<any>>("subject:record-get", {
      subjectId: subject.id,
      id: "visual-origin:1",
    })
  ).data.state;
  expect(state["molecule.structure"]).toEqual(before["molecule.structure"]);
  const sourceAsset = await call<SubjectRecord<{ value: unknown }>>(
      "subject:record-get",
      {
        subjectId: subject.id,
        id: state["molecule.structure"].assetId,
        recordType: "asset",
      },
    ),
    sourceVisual = await call<SubjectRecord<any>>("subject:record-get", {
      subjectId: subject.id,
      id: "visual-origin:1",
    });
  sourceVisual.data.state["molecule.structure"] = {
    assetId: "other-subject:asset:real-source",
  };
  await openNotebook(subject);
  await page
    .getByRole("button", { name: "Open learning canvas", exact: true })
    .click();
  await page
    .locator(".learning-canvas-toolbar input[type=file]")
    .setInputFiles({
      name: "molecular-canvas.json",
      mimeType: "application/json",
      buffer: Buffer.from(
        JSON.stringify({
          schema: "learning-studio/canvas-v2",
          data: {
            nodes: [
              {
                id: "molecular-node",
                kind: "visual",
                visualId: sourceVisual.data.id,
                block: sourceVisual.data.block,
                x: 30,
                y: 30,
                width: 600,
                height: 950,
              },
            ],
            edges: [],
            viewport: { x: 0, y: 0, zoom: 0.8 },
            annotations: [],
          },
          visuals: [sourceVisual.data],
          assets: { "other-subject:asset:real-source": sourceAsset.data.value },
        }),
      ),
    });
  await expect(
    page.locator(".canvas-visual .molecule-canvas canvas"),
  ).toBeVisible();
  await expect(
    page
      .locator(".canvas-visual")
      .getByLabel("Molecular representation", { exact: true }),
  ).toHaveValue("stick");
});

test("visual notebook and canvas have consistent light, dark and edited custom themes with accessible controls", async () => {
  test.setTimeout(180000);
  const { subject, host } = await seed();
  await host
    .getByRole("button", { name: "Save visual to notebook", exact: true })
    .click();
  await openNotebook(subject);
  await page
    .getByRole("button", { name: /Persistent wave/ })
    .first()
    .click();
  const scans: { theme: string; view: string; violations: unknown[] }[] = [];
  const scan = async (theme: string, view: string, selector: string) => {
    const result = await new AxeBuilder({ page })
      .setLegacyMode(true)
      .include(selector)
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    scans.push({
      theme,
      view,
      violations: result.violations.map((violation) => ({
        id: violation.id,
        impact: violation.impact,
        nodes: violation.nodes.map((node) => ({
          target: node.target,
          summary: node.failureSummary,
        })),
      })),
    });
    await page.screenshot({ path: `docs/screenshots/v2-${view}-${theme}.png` });
  };
  await mkdir("docs/screenshots", { recursive: true });
  for (const theme of ["light", "dark", "custom"]) {
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page
      .locator(".appearance-modes")
      .getByRole("button", {
        name: theme === "dark" ? "Dark" : "Light",
        exact: true,
      })
      .click();
    await page
      .getByRole("button", {
        name: theme === "dark" ? /Warm Mocha/ : /Warm Beige/,
      })
      .click();
    if (theme === "custom") {
      await page.getByRole("button", { name: "Colors", exact: true }).click();
      for (const [label, value] of Object.entries({
        Application: "#e7ded2",
        "Body text": "#322e29",
        "Primary accent": "#465a3b",
      }))
        await page.getByLabel(label + " hex", { exact: true }).fill(value);
      await expect
        .poll(() =>
          page
            .locator("html")
            .evaluate((element) =>
              getComputedStyle(element).getPropertyValue("--accent").trim(),
            ),
        )
        .toBe("#465a3b");
    }
    await page
      .getByRole("button", { name: "Close settings", exact: true })
      .click();
    await openNotebook(subject);
    await page
      .getByRole("button", { name: /Persistent wave/ })
      .first()
      .click();
    await scan(theme, "notebook", ".visual-notebook");
    await page
      .getByRole("button", { name: "Open learning canvas", exact: true })
      .click();
    if (theme === "light") {
      await page.getByRole("button", { name: "Add note", exact: true }).click();
      await page
        .getByLabel("Canvas note", { exact: true })
        .fill("A connected explanation.");
      await page
        .getByLabel("Saved visual for canvas", { exact: true })
        .selectOption({ label: "Persistent wave" });
      await page
        .getByRole("button", { name: "Add visual", exact: true })
        .click();
    }
    await expect(
      page.locator(".canvas-visual .plot-canvas .main-svg").first(),
    ).toBeVisible();
    await scan(theme, "canvas", ".learning-canvas-workspace");
  }
  await writeFile(
    "docs/v2-visual-accessibility-results.json",
    JSON.stringify(
      {
        testedAt: new Date().toISOString(),
        standard:
          "Automated axe WCAG2/2.1 A+AA; scoped notebook and authored canvas controls",
        scans,
      },
      null,
      2,
    ),
  );
  expect(scans.flatMap((scan) => scan.violations)).toEqual([]);
});
