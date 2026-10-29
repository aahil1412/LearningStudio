import { openTutor, openDestination } from "./ui-navigation";
import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page,
} from "@playwright/test";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { StudioData, Lesson } from "../src/types";
import type { Subject, SubjectSnapshot, SubjectRecord } from "../src/v2types";
import { sanitizeAppearance } from "../src/lib/themes";

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
    BrowserWindow.getAllWindows()[0].setContentSize(1600, 1120);
  });
  await expect(page.locator(".titlebar-center")).toHaveText("Saved locally");
}
async function call<T = unknown>(action: string, payload?: unknown) {
  return page.evaluate(
    ({ action, payload }) => window.studio!.invoke<T>(action, payload),
    { action, payload },
  );
}
async function seed() {
  const subject = await call<Subject>("subject:create", {
    name: "Molecular biology",
    objective:
      "Understand translation and how codons determine a protein sequence",
    depth: "overview",
  });
  await call("subject:apply", {
    subjectId: subject.id,
    baseRevision: subject.revision,
    label: "Acceptance-test source concept",
    operations: [
      {
        entity: "concept",
        op: "put",
        id: "translation-decoding",
        value: {
          label: "Codon recognition",
          status: "unassessed",
          coverage: "covered",
          evidence:
            "An explanation is coverage, not demonstrated understanding.",
        },
      },
      {
        entity: "curriculum",
        op: "put",
        id: "translation-topic",
        value: {
          kind: "concept",
          title: "Codon recognition",
          position: 0,
          description: "How the tRNA adaptor is selected",
          status: "covered",
          conceptId: "translation-decoding",
        },
      },
    ],
  });
  const lesson = await call<Lesson>("subject:conversation-create", {
    subjectId: subject.id,
    title: "Reading RNA to build a protein",
    mode: "Learn",
    objective: "Understand translation and codon recognition",
    curriculumNodeId: "translation-topic",
  });
  const data = await call<StudioData>("data:load");
  await call("data:save", {
    ...data,
    activeSubjectId: subject.id,
    activeLessonId: lesson.id,
    settings: {
      ...data.settings,
      teaching: {
        delivery: "visual-first",
        practice: "mcq",
        checkFrequency: "topic-end",
        sentenceStyle: "clean",
        avoidEmDashes: true,
      },
    },
  });
  return { subject, lesson };
}
async function fixtureTutor() {
  await app.evaluate(({ ipcMain }) => {
    const original = (ipcMain as any)._invokeHandlers.get("studio:invoke");
    ipcMain.removeHandler("studio:invoke");
    ipcMain.handle("studio:invoke", async (event, action, payload) => {
      if (action === "auth:status")
        return {
          connected: true,
          account: "Explicit teaching protocol fixture",
        };
      if (action === "auth:models")
        return [
          {
            id: "fixture-model",
            name: "Teaching protocol fixture",
            reasoningLevels: ["medium"],
          },
        ];
      if (action === "model:send") {
        if (payload.input?.at(-1)?.content?.includes("SIMULATE_INTERRUPTION"))
          throw new Error(
            "Explicit teaching fixture interruption. Retry without losing the saved lesson.",
          );
        return JSON.stringify({
          text: "A ribosome reads a codon while a tRNA presents its anticodon. This interaction selects an amino acid — the ribosome then joins it to the growing protein. This is an explicitly authored provider fixture used to verify presentation and recovery, not a live subscription response.",
          blocks: [
            {
              type: "diagram",
              spec: {
                title: "Translation",
                nodes: [
                  { id: "rna", label: "mRNA" },
                  { id: "protein", label: "Protein" },
                ],
                edges: [{ from: "rna", to: "protein" }],
              },
            },
          ],
        });
      }
      return original(event, action, payload);
    });
  });
  await page.reload();
  await openDestination(page, "Learning workspace: Lesson");
  await expect(page.locator(".lesson-top")).toContainText(
    "Reading RNA to build a protein",
  );
}
test.beforeEach(async () => {
  directory = mkdtempSync(join(tmpdir(), "studio-v21-teaching-"));
  await launch();
});
test.afterEach(async () => {
  await app?.close().catch(() => {});
  rmSync(directory, {
    recursive: true,
    force: true,
    maxRetries: 8,
    retryDelay: 200,
  });
});

test("actual Electron teaching controller orders definitions and an inline translation illustration, with canonical optional MCQ feedback, review evidence and restart", async () => {
  const { subject } = await seed();
  await fixtureTutor();
  await openTutor(page);
  await page
    .getByLabel("Message the tutor")
    .fill("Teach translation. I am unfamiliar with molecular biology.");
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  const message = page.locator(".lesson-message.assistant").last();
  await expect(message.locator(".teaching-terms")).toContainText("anticodon");
  await expect(message.locator(".scientific-svg")).toBeVisible();
  await expect(message.locator(".diagram-canvas")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Close laboratory", exact: true }),
  ).toHaveCount(0);
  expect(
    await message.evaluate((el) =>
      Boolean(
        el
          .querySelector(".teaching-terms")!
          .compareDocumentPosition(el.querySelector(".scientific-svg")!) &
        Node.DOCUMENT_POSITION_FOLLOWING,
      ),
    ),
  ).toBe(true);
  await expect(message.locator(".translation-svg")).toContainText(/A\s*U\s*G/);
  await expect(message.locator(".translation-svg")).toContainText(/U\s*A\s*C/);
  await expect(message.locator(".translation-svg")).toContainText("Ribosome");
  const text = message
    .locator(".lesson-term")
    .filter({ hasText: "tRNA" })
    .first();
  await text.click();
  await expect(
    page.getByRole("dialog", { name: "Definition of tRNA", exact: true }),
  ).toContainText("adaptor");
  await page.getByRole("button", { name: "Close term definition" }).click();
  const figure = page.locator("[data-visual-host]").first();
  await figure.getByRole("button", { name: "Next step", exact: true }).click();
  await expect(figure.getByText("Step 2 of 3", { exact: true })).toBeVisible();
  await figure
    .getByRole("button", { name: "Move visual fullscreen", exact: true })
    .click();
  await expect(figure.getByText("Step 2 of 3", { exact: true })).toBeVisible();
  await figure
    .getByRole("button", { name: "Move visual inline", exact: true })
    .click();
  await expect(page.locator(".laboratory,.visual-lab")).toHaveCount(0);
  mkdirSync("docs/screenshots", { recursive: true });
  await figure.locator(".scientific-svg").scrollIntoViewIfNeeded();
  await page.screenshot({
    path: "docs/screenshots/v21-translation-inline-light.png",
  });
  expect(
    await message
      .locator(".markdown p")
      .first()
      .evaluate((el) => getComputedStyle(el).fontFamily),
  ).not.toMatch(/Georgia|Times New Roman/);
  const mcq = message.locator(".mcq-checkpoint");
  await expect(mcq).toBeVisible();
  await expect(mcq.getByText(/A tRNA is an adaptor:/)).toHaveCount(0);
  await mcq.getByRole("radio").first().check();
  await mcq.getByRole("button", { name: "Check answer", exact: true }).click();
  await expect(mcq.locator(".mcq-feedback")).toContainText(
    "Correct for this checkpoint",
  );
  const after = await call<SubjectSnapshot>("subject:get", {
    subjectId: subject.id,
  });
  expect(after.curriculum[0].status).toBe("partial");
  expect(after.concepts[0].status).toBe("partial");
  expect(
    after.evidence.some((e) => e.messageId && e.kind === "assessment"),
  ).toBe(true);
  await mcq.getByRole("button", { name: "Try again", exact: true }).click();
  await mcq
    .getByRole("button", { name: "Skip checkpoint", exact: true })
    .click();
  await expect(mcq).toContainText("skipped");
  await mcq.getByRole("button", { name: "Try again", exact: true }).click();
  await mcq
    .getByRole("button", { name: "I don't know yet", exact: true })
    .click();
  await expect(mcq.locator(".mcq-feedback")).toContainText("No problem");
  await mcq.scrollIntoViewIfNeeded();
  await page.screenshot({
    path: "docs/screenshots/v21-translation-inline-mcq-light.png",
  });
  const canonical = await call<StudioData>("data:load");
  await call("data:save", {
    ...canonical,
    appearance: { ...sanitizeAppearance(canonical.appearance), mode: "dark" },
  });
  await page.reload();
  await openDestination(page, "Learning workspace: Lesson");
  await expect(page.locator(".scientific-svg")).toBeVisible();
  await expect(page.locator(".science-step-controls")).toContainText(
    "Step 2 of 3",
  );
  await page.locator(".scientific-svg").scrollIntoViewIfNeeded();
  await page.screenshot({
    path: "docs/screenshots/v21-translation-inline-dark.png",
  });
  await page.locator(".mcq-checkpoint").scrollIntoViewIfNeeded();
  await page.screenshot({
    path: "docs/screenshots/v21-translation-inline-mcq-dark.png",
  });
  await app.close();
  await launch();
  await openDestination(page, "Learning workspace: Lesson");
  await expect(page.locator(".science-step-controls")).toContainText(
    "Step 2 of 3",
  );
  await expect(page.locator(".mcq-checkpoint .mcq-feedback")).toContainText(
    "No problem",
  );
});

test("an explicit Boltzmann request works without model authentication and retains real parameters when moved inline and fullscreen and after restart", async () => {
  const { subject } = await seed();
  await page.reload();
  await openDestination(page, "Learning workspace: Lesson");
  await openTutor(page);
  await page
    .getByLabel("Message the tutor")
    .fill("Show an interactive Boltzmann distribution plot");
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  const host = page.locator("[data-visual-host]").first();
  await expect(
    host.locator(".science-plot-canvas .main-svg").first(),
  ).toBeVisible();
  const slider = host.getByRole("slider", { name: "Parameter T", exact: true });
  await slider.fill("600");
  await expect(slider).toHaveValue("600");
  await host.evaluate((el) => {
    (window as any).__originalBoltzmannHost = el;
  });
  for (const placement of ["fullscreen", "inline"]) {
    await host
      .getByRole("button", { name: `Move visual ${placement}`, exact: true })
      .click();
    await expect(slider).toHaveValue("600");
    expect(
      await host.evaluate(
        (el) => el === (window as any).__originalBoltzmannHost,
      ),
    ).toBe(true);
  }
  await expect(page.locator(".laboratory,.visual-lab")).toHaveCount(0);
  await expect
    .poll(async () => {
      const records = await call<SubjectRecord<any>[]>("subject:record-list", {
        subjectId: subject.id,
        recordType: "visual",
        includeData: true,
      });
      return records.find(
        (r) => r.data?.state?.["advanced.parameters"]?.T === 600,
      )?.data.state["advanced.parameters"].T;
    })
    .toBe(600);
  await app.close();
  await launch();
  await openDestination(page, "Learning workspace: Lesson");
  await expect(
    page.getByRole("slider", { name: "Parameter T", exact: true }),
  ).toHaveValue("600");
  await page.screenshot({ path: "docs/screenshots/v21-boltzmann-inline.png" });
});

test("image requests run free retrieval inline with source and licensing, and a real transport failure stays recoverable @network", async () => {
  test.setTimeout(120000);
  await seed();
  await page.reload();
  await openDestination(page, "Learning workspace: Lesson");
  await openTutor(page);
  await page
    .getByLabel("Message the tutor")
    .fill("Search for a real image of a tRNA");
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  const image = page.locator(".visual-figure").filter({
    has: page.getByLabel("Search educational images", { exact: true }),
  });
  await expect(image).toBeVisible();
  await expect(
    image.locator(".image-viewport img, .visual-error").first(),
  ).toBeVisible({ timeout: 80000 });
  await expect(image.locator(".visual-status")).toHaveCount(0, {
    timeout: 80000,
  });
  const results = await image.locator(".image-viewport img").count();
  if (results) {
    await expect(image.getByRole("link", { name: "Source ↗" })).toHaveAttribute(
      "href",
      /^https:\/\//,
    );
    await expect(image.locator("figcaption")).toContainText(
      /CC|Public domain|license/i,
    );
  } else await expect(image.locator(".visual-error")).toBeVisible();
  mkdirSync("docs/screenshots", { recursive: true });
  writeFileSync(
    "docs/v21-image-network-result.json",
    JSON.stringify(
      {
        testedAt: new Date().toISOString(),
        actualElectron: true,
        actualExternalSearch: true,
        query: "a tRNA",
        renderedImage: results > 0,
        renderedFailure: results === 0,
      },
      null,
      2,
    ),
  );
  await page.screenshot({ path: "docs/screenshots/v21-image-inline.png" });
  // Real transport is above. A narrow synthetic failure verifies independent nonblocking recovery.
  await app.evaluate(({ ipcMain }) => {
    const original = (ipcMain as any)._invokeHandlers.get("studio:invoke");
    ipcMain.removeHandler("studio:invoke");
    ipcMain.handle("studio:invoke", (event, action, payload) => {
      if (action === "images:search")
        throw new Error("Explicit image transport interruption fixture");
      return original(event, action, payload);
    });
  });
  await image.getByRole("button", { name: "Search", exact: true }).click();
  await expect(image.locator(".visual-error")).toContainText(
    "Explicit image transport interruption fixture",
  );
  await openTutor(page);
  await expect(page.getByLabel("Message the tutor")).toBeEnabled();
  await openTutor(page);
  await page
    .getByLabel("Message the tutor")
    .fill("Show an interactive Boltzmann distribution plot");
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await expect(
    page.getByRole("slider", { name: "Parameter T", exact: true }),
  ).toBeVisible();
});
