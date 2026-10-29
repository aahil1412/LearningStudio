import { openDestination } from "./ui-navigation";
import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page,
  type Locator,
} from "@playwright/test";
import { mkdtemp, readFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

let app: ElectronApplication;
let page: Page;
let authoring: Locator;
test.beforeEach(async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "learning-studio-visual-test-"));
  const env = Object.fromEntries(
    Object.entries({ ...process.env, STUDIO_DATA_DIR: dataDir }).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.STUDIO_DEV_URL;
  app = await electron.launch({
    args: [".", "--start-hidden"],
    cwd: process.cwd(),
    env,
    timeout: 30000,
  });
  page = await app.firstWindow();
  await app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    window.webContents.setBackgroundThrottling(false);
    window.setContentSize(1500, 1100);
  });
  await expect(
    page.getByRole("heading", { name: "Your learning", exact: true }),
  ).toBeVisible();
  const subject = await page.evaluate(async () =>
    window.studio!.invoke<{ id: string; name: string }>("subject:create", {
      name: "Scientific figure authoring",
      objective: "Inspect explicitly selected scientific rendering tools",
      depth: "overview",
    }),
  );
  await openDestination(page, "Subject workspaces: My learning");
  await page.locator(".subject-tile").filter({ hasText: subject.name }).click();
  await openDestination(page, "Visual notebook");
  await page
    .getByRole("button", { name: "Author a figure", exact: true })
    .click();
  authoring = page.getByRole("region", {
    name: "Figure authoring tools",
    exact: true,
  });
  await expect(authoring).toBeVisible();
  await expect(
    page.locator(".plot-canvas, .science-plot-canvas, .molecule-canvas"),
  ).toHaveCount(0);
});
test.afterEach(async () => {
  await app?.close();
});

test("interactive scientific plots calculate real values and support parameters without unsafe-eval", async () => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.getByRole("tab", { name: "Plots", exact: true }).click();
  await expect(authoring.locator(".plot-canvas")).toHaveCount(0);
  await page
    .getByLabel("Mathematical model", { exact: true })
    .selectOption("wave");
  const plot = authoring.locator(".plot-canvas");
  await expect(plot.locator(".main-svg").first()).toBeVisible();
  const first = await plot.evaluate((element) => {
    const data = (
      element as unknown as { data: { x: number[]; y: number[] }[] }
    ).data;
    return {
      n: data[0].x.length,
      first: data[0].y[0],
      finite: data[0].y.every(Number.isFinite),
    };
  });
  expect(first.n).toBe(401);
  expect(first.finite).toBe(true);
  await page
    .getByRole("slider", { name: "Amplitude", exact: true })
    .press("End");
  await expect(authoring.locator("output").first()).toHaveText("3.00");
  await page.getByRole("button", { name: "Animate", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Pause", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await page.getByRole("button", { name: "Reset", exact: true }).click();
  await expect(authoring.locator("output").first()).toHaveText("1.00");
  await page
    .getByLabel("Mathematical model", { exact: true })
    .selectOption("derivative");
  await expect(authoring.locator("output").first()).toHaveText("1.00");
  await expect
    .poll(() =>
      plot.evaluate(
        (element) => (element as unknown as { data: unknown[] }).data?.length,
      ),
    )
    .toBe(2);
  const curve = await plot.evaluate((element) => {
    const data = (
      element as unknown as { data: { x: number[]; y: number[] }[] }
    ).data;
    const index = data[0].x.indexOf(1);
    return [data[0].y[index], data[1].y[index]];
  });
  expect(curve).toEqual([1, 1]);
  expect(
    errors.filter((e) =>
      /unsafe-eval|Content Security Policy|EvalError/i.test(e),
    ),
  ).toEqual([]);
});

test("validated SVG diagrams support selection, pan controls, fullscreen and export", async () => {
  await page.getByRole("tab", { name: "Diagrams", exact: true }).click();
  await expect(authoring.locator(".diagram-canvas")).toBeVisible();
  await page
    .getByRole("button", { name: "Explain Build a mental model", exact: true })
    .click();
  await expect(authoring.locator(".diagram-detail")).toContainText(
    "Connect a new idea",
  );
  await page
    .getByRole("button", { name: "Zoom diagram in", exact: true })
    .click();
  await expect(authoring.locator(".diagram-tools")).toContainText("120%");
  const exportPath = join(
    await mkdtemp(join(tmpdir(), "learning-studio-svg-test-")),
    "learning-diagram.svg",
  );
  await app.evaluate(({ session }, path) => {
    session.defaultSession.once("will-download", (_event, item) => {
      item.setSavePath(path);
      item.once("done", (_done, state) => {
        (globalThis as any).__visualDownload = state;
      });
    });
  }, exportPath);
  await page.getByRole("button", { name: "Export SVG", exact: true }).click();
  await expect
    .poll(() => app.evaluate(() => (globalThis as any).__visualDownload))
    .toBe("completed");
  const svg = await readFile(exportPath, "utf8");
  expect(svg).toContain("<svg");
  expect(svg).toContain("Build a mental model");
  await page
    .getByRole("button", { name: "Expand visualization", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: "From question to understanding" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("dialog", { name: "From question to understanding" }),
  ).toHaveCount(0);
});

test("real RCSB structure loads in WebGL and remains interactive @network", async () => {
  test.skip(
    !process.env.STUDIO_NETWORK_TESTS,
    "Set STUDIO_NETWORK_TESTS=1 to verify real public scientific services.",
  );
  await page.getByRole("tab", { name: "Molecules", exact: true }).click();
  await expect(authoring.locator(".molecule-canvas canvas")).toBeVisible({
    timeout: 30000,
  });
  await expect(
    page.getByRole("link", { name: "Structure source ↗", exact: true }),
  ).toHaveAttribute("href", /rcsb|1CRN/i);
  const canvas = authoring.locator(".molecule-canvas canvas").first();
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    box!.x + box!.width / 2 + 30,
    box!.y + box!.height / 2 + 15,
    { steps: 4 },
  );
  await page.mouse.up();
  await page
    .getByLabel("Molecular representation", { exact: true })
    .selectOption("stick");
  await page.getByRole("button", { name: "Rotate", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Stop rotation", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Stop rotation", exact: true })
    .click();
  await expect(authoring.locator(".visual-error")).toHaveCount(0);
  await mkdir("docs/screenshots", { recursive: true });
  await page.screenshot({ path: "docs/screenshots/molecular-laboratory.png" });
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page
    .locator(".appearance-modes")
    .getByRole("button", { name: "Dark", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Close settings", exact: true })
    .click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(authoring.locator(".molecule-canvas canvas")).toBeVisible();
  await page
    .getByLabel("Molecular selection mode", { exact: true })
    .selectOption("residue");
  await page.getByRole("button", { name: "Surface", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Surface", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(authoring.locator(".visual-error")).toHaveCount(0);
  await page.screenshot({
    path: "docs/screenshots/molecular-laboratory-dark.png",
  });
});

test("real PubChem chemistry diagram and licensed educational image have provenance @network", async () => {
  test.setTimeout(150000);
  test.skip(
    !process.env.STUDIO_NETWORK_TESTS,
    "Set STUDIO_NETWORK_TESTS=1 to verify real public scientific services.",
  );
  await page.getByRole("tab", { name: "Molecules", exact: true }).click();
  await expect(authoring.locator(".molecule-canvas canvas")).toBeVisible({
    timeout: 30000,
  });
  await page
    .getByLabel("Molecular database", { exact: true })
    .selectOption("pubchem");
  await page.getByLabel("Structure identifier", { exact: true }).fill("2244");
  await page.getByRole("button", { name: "Load", exact: true }).click();
  await expect(authoring.locator(".visual-figure-header h4")).toContainText(
    "2244",
    {
      timeout: 30000,
    },
  );
  await page
    .getByRole("button", { name: "Chemical 2D diagram", exact: true })
    .click();
  await expect(authoring.locator(".chemical-depiction img")).toBeVisible({
    timeout: 30000,
  });
  await expect(
    page.getByRole("link", {
      name: "Authoritative 2D chemical depiction ↗",
      exact: true,
    }),
  ).toHaveAttribute("href", /pubchem/);
  await authoring.locator(".chemical-depiction").scrollIntoViewIfNeeded();
  await mkdir("docs/screenshots", { recursive: true });
  await page.screenshot({ path: "docs/screenshots/chemical-depiction.png" });
  await page.getByRole("tab", { name: "Images", exact: true }).click();
  await page
    .getByLabel("Inline image source", { exact: true })
    .selectOption("wikimedia");
  const input = page.getByLabel("Search educational images", { exact: true });
  await input.fill("mitosis diagram");
  // Wait for the initial automatic request before issuing the manual search.
  await expect(
    page.getByRole("button", { name: "Search", exact: true }),
  ).toBeEnabled({ timeout: 30000 });
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await expect(authoring.locator(".image-viewport img")).toBeVisible({
    timeout: 30000,
  });
  await authoring.locator(".image-viewport").scrollIntoViewIfNeeded();
  await expect
    .poll(
      () =>
        authoring
          .locator(".image-viewport img")
          .evaluate(
            (element) =>
              (element as HTMLImageElement).complete &&
              (element as HTMLImageElement).naturalWidth > 0,
          ),
      { timeout: 30000 },
    )
    .toBe(true);
  await expect(
    page.getByRole("link", { name: "Source ↗", exact: true }),
  ).toHaveAttribute("href", /commons.wikimedia.org/);
  await expect(authoring.locator("figcaption.visual-caption")).toContainText(
    /CC|Public domain|PD|Creative Commons/i,
  );
  await page.screenshot({
    path: "docs/screenshots/scientific-image-retrieval.png",
  });
});
