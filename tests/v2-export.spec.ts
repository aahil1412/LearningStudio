import {
  test,
  expect,
  chromium,
  type Browser,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import { existsSync, mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, basename, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { writeOfflineTextbook } from "../electron/exporter";
import { exportFixture } from "./v2-export-fixture";
let browser: Browser, context: BrowserContext, page: Page, directory: string;
test.beforeEach(async () => {
  directory = mkdtempSync(join(tmpdir(), "studio-offline-export-"));
  const fixture = exportFixture();
  await writeOfflineTextbook(
    join(directory, "textbook.html"),
    fixture.payload,
    {
      assets: fixture.assets,
      assetRecords: fixture.assetRecords,
      offlineOnly: true,
    },
  );
  const installed = [
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  ].find((path) => existsSync(path));
  browser = await chromium.launch({
    headless: true,
    executablePath: installed,
    args: ["--enable-unsafe-swiftshader"],
  });
  context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  await context.setOffline(true);
  page = await context.newPage();
});
test.afterEach(async () => {
  await browser?.close();
  const target = resolve(directory);
  if (
    !target.startsWith(resolve(tmpdir()) + sep) ||
    !basename(target).startsWith("studio-offline-export-")
  )
    throw new Error("Unexpected export test path.");
  rmSync(target, {
    recursive: true,
    force: true,
    maxRetries: 8,
    retryDelay: 200,
  });
});
test("ordinary browser opens a standalone offline textbook with real math, interactive plots, diagrams, answer reveals, images, and molecular controls", async () => {
  const requests: string[] = [],
    errors: string[] = [];
  page.on("request", (request) => {
    if (/^https?:/.test(request.url())) requests.push(request.url());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(pathToFileURL(join(directory, "textbook.html")).href);
  await expect(
    page.getByRole("heading", {
      name: "A portable study of change",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", {
      name: "Understanding local change",
      exact: true,
    }),
  ).toBeVisible();
  await expect.poll(() => page.locator(".katex").count()).toBeGreaterThan(2);
  expect(
    await page.evaluate(
      () => (window as unknown as { __exportAttack?: boolean }).__exportAttack,
    ),
  ).toBeUndefined();
  await expect(page.locator(".plot-canvas .main-svg").first()).toBeVisible();
  mkdirSync("docs/screenshots", { recursive: true });
  await page.screenshot({
    path: "docs/screenshots/v2-offline-textbook-light.png",
  });
  await expect(
    page.getByRole("slider", { name: "Tangent at x", exact: true }),
  ).toHaveValue("2");
  await page
    .getByRole("slider", { name: "Tangent at x", exact: true })
    .press("End");
  await expect
    .poll(() =>
      page.locator(".plot-canvas").evaluate((element) => {
        const plot = element as unknown as {
            data: { x: number[]; y: number[] }[];
          },
          trace = plot.data?.[1];
        return trace
          ? (trace.y.at(-1)! - trace.y[0]) / (trace.x.at(-1)! - trace.x[0])
          : null;
      }),
    )
    .toBeCloseTo(6, 5);
  await page
    .getByRole("button", { name: "Explain Take the limit", exact: true })
    .click();
  await expect(
    page.getByText("Let h approach zero after forming the quotient.", {
      exact: true,
    }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Show explanation", exact: true })
    .click();
  await expect(
    page.getByText("The slope is 6.", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("img", {
      name: "An authored raster fixture with explicit attribution, used to verify offline embedding.",
    }),
  ).toBeVisible();
  await expect(page.getByText("CC0", { exact: true })).toBeVisible();
  await expect(page.locator(".molecule-canvas canvas")).toBeVisible();
  await expect(
    page.getByRole("combobox", {
      name: "Molecular representation",
      exact: true,
    }),
  ).toHaveValue("stick");
  await page
    .getByRole("combobox", { name: "Molecular representation", exact: true })
    .selectOption("cartoon");
  const canvas = page.locator(".molecule-canvas canvas"),
    bounds = await canvas.boundingBox();
  await page.mouse.move(bounds!.x + 50, bounds!.y + 50);
  await page.mouse.down();
  await page.mouse.move(bounds!.x + 120, bounds!.y + 80, { steps: 10 });
  await page.mouse.up();
  await page
    .getByRole("button", { name: "Dark appearance", exact: true })
    .click();
  await expect
    .poll(() => page.locator("html").getAttribute("data-theme"))
    .toBe("dark");
  await page.locator(".molecule-canvas").scrollIntoViewIfNeeded();
  await page.screenshot({
    path: "docs/screenshots/v2-offline-molecule-dark.png",
  });
  await page
    .getByLabel("Search chapters", { exact: true })
    .fill("neighborhoods");
  await expect(
    page
      .getByRole("navigation", { name: "Textbook chapters" })
      .getByRole("button"),
  ).toHaveCount(1);
  await page.getByRole("button", { name: /Limits and neighborhoods/ }).click();
  await expect(
    page.getByRole("heading", {
      name: "Limits and neighborhoods",
      exact: true,
    }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => (window as unknown as { __exportAttack?: boolean }).__exportAttack,
    ),
  ).toBeUndefined();
  await page
    .getByLabel("Chapter annotations", { exact: true })
    .fill("A portable annotation.");
  expect(requests).toEqual([]);
  expect(errors).toEqual([]);
});
