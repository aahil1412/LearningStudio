import { seedReferenceLesson } from "./learning-fixtures";
import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page,
} from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { openDestination } from "./ui-navigation";
let app: ElectronApplication;
let page: Page;
let directory: string;
test.beforeEach(async () => {
  directory = await mkdtemp(join(process.cwd(), ".accessibility-test-"));
  app = await electron.launch({
    args: ["."],
    cwd: process.cwd(),
    env: { ...process.env, STUDIO_DATA_DIR: directory },
    timeout: 30000,
  });
  page = await app.firstWindow();
  await expect(page.locator(".brand")).toContainText("Learning Studio");
});
test.afterEach(async () => {
  await app?.close();
  await rm(directory, { recursive: true, force: true });
});
test("WCAG audits cover the learning workspace and settings in both appearance schemes", async () => {
  test.setTimeout(180000);
  const results: {
    view: string;
    scheme: string;
    violations: {
      id: string;
      impact: string | null | undefined;
      help: string;
      nodes: { target: unknown; summary: string | undefined }[];
    }[];
  }[] = [];
  const scan = async (view: string, scheme: string) => {
    const result = await new AxeBuilder({ page })
      .setLegacyMode(true)
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    results.push({
      view,
      scheme,
      violations: result.violations.map((violation) => ({
        id: violation.id,
        impact: violation.impact,
        help: violation.help,
        nodes: violation.nodes.map((node) => ({
          target: node.target,
          summary: node.failureSummary,
        })),
      })),
    });
  };
  for (const scheme of ["Light", "Dark"]) {
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page
      .locator(".appearance-modes")
      .getByRole("button", { name: scheme, exact: true })
      .click();
    await expect(page.locator("html")).toHaveAttribute(
      "data-theme",
      scheme.toLowerCase(),
    );
    await scan("Appearance", scheme);
    await page
      .getByRole("button", { name: "Close settings", exact: true })
      .click();
    await openDestination(page, "Learning workspace: Lesson");
    if (
      await page
        .getByRole("button", { name: "Session actions", exact: true })
        .isVisible()
    ) {
      await page
        .getByRole("button", { name: "Session actions", exact: true })
        .click();
      await page
        .getByRole("button", { name: "Return to welcome", exact: true })
        .click();
    }
    await openDestination(page, "Subject workspaces: My learning");
    await scan("Learning home", scheme);
    await seedReferenceLesson(page);
    await expect(page.locator(".lesson-top")).toBeVisible();
    await scan("Lesson", scheme);
    for (const [label, view] of [
      [/^Practice & review/, "Review"],
      ["Research & sources", "Research"],
      [/^Your library/, "Library"],
      [/^Knowledge graph/, "Knowledge graph"],
    ] as const) {
      await openDestination(page, label);
      await scan(view, scheme);
    }
  }
  await mkdir(join(process.cwd(), "docs"), { recursive: true });
  await writeFile(
    join(process.cwd(), "docs", "accessibility-results.json"),
    JSON.stringify(
      {
        testedAt: new Date().toISOString(),
        standard:
          "WCAG2/2.1 A+AA automated axe scan; manual review still needed",
        results,
      },
      null,
      2,
    ),
  );
  const violations = results.flatMap((result) =>
    result.violations.map((violation) => ({
      view: result.view,
      scheme: result.scheme,
      id: violation.id,
      impact: violation.impact,
      targets: violation.nodes.map((node) => node.target),
    })),
  );
  expect(violations).toEqual([]);
});
