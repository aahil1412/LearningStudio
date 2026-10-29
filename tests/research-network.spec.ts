import { openDestination } from "./ui-navigation";
import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page,
} from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mkdtemp, rm, mkdir } from "node:fs/promises";
import { join, resolve, basename, sep } from "node:path";
let app: ElectronApplication;
let page: Page;
let directory: string;
let diagnostics: { events: string[]; errors: string[] };
test.beforeEach(async () => {
  test.skip(
    process.env.STUDIO_NETWORK_TESTS !== "1",
    "Enable STUDIO_NETWORK_TESTS for actual public provider integration tests.",
  );
  directory = await mkdtemp(join(process.cwd(), ".research-ui-test-"));
  diagnostics = { events: [], errors: [] };
  const env: Record<string, string> = Object.fromEntries(
    Object.entries({ ...process.env, STUDIO_DATA_DIR: directory }).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.STUDIO_DEV_URL;
  app = await electron.launch({
    args: ["."],
    cwd: process.cwd(),
    env,
    timeout: 30000,
  });
  app
    .process()
    .on("exit", (code, signal) =>
      diagnostics.events.push(
        `Electron exited: code=${code}, signal=${signal}`,
      ),
    );
  app.process().stderr?.on("data", (chunk: Buffer) => {
    if (diagnostics.errors.join("").length < 12000)
      diagnostics.errors.push(chunk.toString().slice(0, 2000));
  });
  page = await app.firstWindow();
  page.on("crash", () => diagnostics.events.push("Renderer crashed"));
  page.on("close", () => diagnostics.events.push("Renderer window closed"));
  page.on("pageerror", (error) =>
    diagnostics.errors.push(error.message.slice(0, 1000)),
  );
  await expect(page.locator(".brand")).toContainText("Learning Studio");
  await expect(page.locator(".titlebar-center")).toHaveText("Saved locally");
  await openDestination(page, "Research & sources");
});
test.afterEach(async () => {
  const testInfo = test.info();
  if (testInfo.status !== testInfo.expectedStatus && diagnostics)
    await testInfo.attach("public-provider-runtime-diagnostics", {
      body: JSON.stringify(diagnostics, null, 2),
      contentType: "application/json",
    });
  await app?.close();
  if (directory) {
    const target = resolve(directory);
    if (
      !target.startsWith(resolve(process.cwd()) + sep) ||
      !basename(target).startsWith(".research-ui-test-")
    )
      throw new Error("Unexpected research test profile path.");
    await rm(target, {
      recursive: true,
      force: true,
      maxRetries: 8,
      retryDelay: 200,
    });
  }
});
test("actual public research metadata can be searched, inspected and saved @network", async () => {
  test.setTimeout(120000);
  await page.getByLabel("Research query").fill("Fourier transform");
  await page
    .locator(".research-search")
    .getByRole("button", { name: "Search", exact: true })
    .click();
  await expect(page.locator(".reference-card").first()).toBeVisible({
    timeout: 45000,
  });
  const crossref = page
    .locator(".reference-card")
    .filter({ has: page.locator(".reference-meta", { hasText: "Crossref" }) })
    .first();
  await expect(crossref).toBeVisible();
  await expect(crossref).toContainText("Metadata matched");
  await crossref
    .getByRole("button", { name: "Save reference", exact: true })
    .click();
  await expect(
    page.locator('.research-workspace [role="status"]'),
  ).toContainText("Reference saved");
  const saved = await page.evaluate(async () => {
    const data = await window.studio!.invoke<{
      library: { kind: string; source?: string; content: string }[];
      concepts: unknown[];
    }>("data:load");
    return data;
  });
  expect(saved.library[0].kind).toBe("reference");
  expect(saved.library[0].source).toContain("doi.org");
  expect(saved.concepts).toEqual([]);
  await mkdir(join(process.cwd(), "docs", "screenshots"), { recursive: true });
  for (const scheme of ["Light", "Dark"]) {
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page
      .locator(".appearance-modes")
      .getByRole("button", { name: scheme, exact: true })
      .click();
    await page
      .getByRole("button", { name: "Close settings", exact: true })
      .click();
    await expect(page.locator("html")).toHaveAttribute(
      "data-theme",
      scheme.toLowerCase(),
    );
    const accessible = await new AxeBuilder({ page })
      .setLegacyMode(true)
      .include(".research-workspace")
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    expect(
      accessible.violations.map((violation) => ({
        id: violation.id,
        targets: violation.nodes.map((node) => node.target),
      })),
    ).toEqual([]);
    await page
      .locator(".research-workspace")
      .evaluate((element) => element.scrollTo({ top: 0, behavior: "instant" }));
    await page.screenshot({
      path: `docs/screenshots/research-sources-${scheme.toLowerCase()}.png`,
    });
  }
});
test("Openverse scientific image retrieval uses Chromium transport and survives an offline-cache restart @network", async () => {
  await page
    .getByRole("tab", { name: "Educational images", exact: true })
    .click();
  await page.getByLabel("Image provider").selectOption("openverse");
  await page.getByLabel("Research query").fill("mitosis");
  await page
    .locator(".research-search")
    .getByRole("button", { name: "Search", exact: true })
    .click();
  const card = page.locator(".research-image-card").first();
  await expect(card).toBeVisible({ timeout: 45000 });
  await expect(card.locator("img")).toHaveJSProperty("complete", true);
  await card
    .getByRole("button", { name: "Cache permitted copy", exact: true })
    .click();
  await expect(
    card.getByRole("button", { name: "Available offline", exact: true }),
  ).toBeVisible({ timeout: 30000 });
  await expect(card.locator("img")).toHaveAttribute(
    "src",
    /^data:image\/(?:jpeg|png|webp);base64,/,
  );
  await app.close();
  app = await electron.launch({
    args: ["."],
    cwd: process.cwd(),
    env: { ...process.env, STUDIO_DATA_DIR: directory },
    timeout: 30000,
  });
  page = await app.firstWindow();
  await openDestination(page, "Research & sources");
  await page
    .getByRole("tab", { name: "Educational images", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Offline cache", exact: true })
    .click();
  await expect(page.locator(".research-image-card").first()).toContainText(
    "Cached",
  );
  await expect(
    page.locator(".research-image-card img").first(),
  ).toHaveAttribute("src", /^data:image\//);
  await expect(page.locator(".research-workspace")).toContainText(
    "may not reflect later source updates",
  );
});
