import { openDestination } from "./ui-navigation";
import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page,
} from "@playwright/test";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { Subject } from "../src/v2types";
import type { SubjectIntake, PathwayJob } from "../src/v21types";
import type { StudioData } from "../src/types";
import { sanitizeAppearance } from "../src/lib/themes";

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
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setContentSize(1510, 1000),
  );
  await expect(page.locator(".titlebar-center")).toHaveText("Saved locally");
}
async function call<T = unknown>(action: string, payload?: unknown) {
  return page.evaluate(
    ({ action, payload }) => window.studio!.invoke<T>(action, payload),
    { action, payload },
  );
}
async function subjects() {
  await openDestination(page, "Subject workspaces: My learning");
}
async function create() {
  await subjects();
  await page.getByRole("button", { name: "New subject", exact: true }).click();
  await page
    .getByLabel("Subject workspace name")
    .fill("A whole scientific discipline");
  await page
    .getByLabel("Subject learning objective")
    .fill("Understand biology from first principles to advanced relationships");
  await page
    .getByRole("button", { name: "Create subject", exact: true })
    .click();
  await expect(
    page.getByRole("region", { name: "Conversational learning setup" }),
  ).toBeVisible();
  return (await call<Subject[]>("subject:list")).find(
    (subject) => subject.name === "A whole scientific discipline",
  )!;
}
async function reopenSubject() {
  await subjects();
  await page
    .locator(".subject-tile")
    .filter({ hasText: "A whole scientific discipline" })
    .click();
}
test.beforeEach(async () => {
  directory = await mkdtemp(
    join(process.cwd(), ".provider-test-planning-native-"),
  );
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

test("broad conversational setup remains optional, persists preferences, and never launches planning prematurely", async () => {
  const subject = await create(),
    setup = page.getByRole("region", { name: "Conversational learning setup" });
  expect(await call("planning:list", { subjectId: subject.id })).toEqual([]);
  await setup
    .getByLabel("Learning motivation")
    .fill("I want coherent understanding, with no artificial narrowing");
  await setup.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(
    setup.getByText("Where should we meet you?", { exact: true }),
  ).toBeVisible();
  await setup.getByLabel("Prior familiarity").fill("New to molecular biology");
  await setup
    .getByLabel("Areas needing support")
    .fill("How small molecular mechanisms create a living system");
  await setup.getByRole("button", { name: "Continue", exact: true }).click();
  await setup.getByRole("radio", { name: /Visual first/ }).check();
  await setup.getByLabel("Learning setup depth").selectOption("comprehensive");
  await setup.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(setup.getByLabel("Practice format")).toHaveValue("mcq");
  await setup
    .getByLabel("Understanding check frequency")
    .selectOption("topic-end");
  await setup.getByRole("radio", { name: /Skip the baseline/ }).check();
  await setup.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(
    setup.getByRole("heading", { name: "Your learning setup", exact: true }),
  ).toBeVisible();
  expect(await call("planning:list", { subjectId: subject.id })).toEqual([]);
  await mkdir(join(process.cwd(), "docs", "screenshots"), { recursive: true });
  await page.screenshot({
    path: "docs/screenshots/2.1-onboarding-light.png",
    fullPage: true,
  });
  await setup
    .getByRole("button", { name: "Save preferences only", exact: true })
    .click();
  await expect(setup).not.toBeVisible();
  const intake = await call<SubjectIntake>("learning:intake-get", {
    subjectId: subject.id,
  });
  expect(intake).toMatchObject({
    status: "ready",
    familiarity: "New to molecular biology",
    depth: "comprehensive",
    assessment: "skipped",
    preferences: {
      delivery: "visual-first",
      practice: "mcq",
      checkFrequency: "topic-end",
    },
  });
  expect(await call("planning:list", { subjectId: subject.id })).toEqual([]);
  await page
    .getByRole("button", { name: "Construct a learning pathway", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText("Connect ChatGPT");
  await app.close();
  await launch();
  await reopenSubject();
  await page
    .getByRole("button", { name: "Learning setup", exact: true })
    .click();
  await expect(
    page.getByRole("region", { name: "Conversational learning setup" }),
  ).toContainText("visual first");
  expect(
    await call<SubjectIntake>("learning:intake-get", { subjectId: subject.id }),
  ).toMatchObject({
    assessment: "skipped",
    preferences: { practice: "mcq", delivery: "visual-first" },
  });
});

test("a checkpointed main-process job survives navigation and restart with explicit safe recovery", async () => {
  const subject = await create();
  await page
    .getByRole("button", { name: "Skip setup and use defaults", exact: true })
    .click();
  await app.close();
  const at = new Date().toISOString(),
    outline = [
      {
        id: "module-foundations",
        title: "Foundations of life",
        description: "Starting ideas and prerequisite relationships",
        priorities: ["Cells and molecules"],
        prerequisites: [],
      },
      {
        id: "module-processes",
        title: "Living processes",
        description: "Connect molecular mechanisms to cells",
        priorities: ["Protein translation"],
        prerequisites: ["module-foundations"],
      },
    ];
  const job: PathwayJob = {
    id: "persisted-planning-job",
    subjectId: subject.id,
    status: "running",
    stage: "constructing-module",
    model: "test-catalog-model",
    reasoning: "medium",
    completedModules: 1,
    totalModules: 2,
    outline,
    chunks: [],
    requestState: "possibly-admitted",
    cancelRequested: false,
    retryCount: 0,
    createdAt: at,
    updatedAt: at,
    startedAt: at,
  };
  const chunk = {
    moduleId: "module-foundations",
    nodes: [
      {
        id: "module-foundations",
        kind: "module",
        title: "Foundations of life",
        description: "Starting ideas",
        prerequisites: [],
      },
      {
        id: "topic-cells",
        parentId: "module-foundations",
        kind: "topic",
        title: "Cells as systems",
        description: "Boundaries and coordinated processes",
        prerequisites: [],
      },
    ],
    completedAt: at,
  };
  const db = new DatabaseSync(join(directory, "learning-studio.sqlite"));
  db.prepare(
    "INSERT INTO planning_jobs(id,subject_id,status,stage,model,request_state,completed_modules,total_modules,cancel_requested,value,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
  ).run(
    job.id,
    subject.id,
    job.status,
    job.stage,
    job.model,
    job.requestState,
    1,
    2,
    0,
    JSON.stringify(job),
    at,
    at,
  );
  db.prepare(
    "INSERT INTO planning_chunks(job_id,module_id,ordinal,value,completed_at) VALUES(?,?,?,?,?)",
  ).run(job.id, chunk.moduleId, 0, JSON.stringify(chunk), at);
  db.close();
  await launch();
  await expect(page.getByLabel("Background pathway tasks")).toBeVisible();
  await reopenSubject();
  const panel = page.getByRole("region", {
    name: "Persistent pathway progress",
  });
  await expect(panel).toContainText(
    "1 of 2 modules completed and checkpointed",
  );
  await expect(panel).toContainText("Foundations of life");
  await expect(panel).toContainText("Resume explicitly");
  await expect(
    panel.getByRole("button", { name: "Resume saved work", exact: true }),
  ).toBeEnabled();
  const restored = await call<PathwayJob>("planning:get", { jobId: job.id });
  expect(restored.status).toBe("interrupted");
  expect(restored.requestState).toBe("possibly-admitted");
  expect(restored.chunks).toHaveLength(1);
  expect(restored.retryCount).toBe(0);
  // This is real Electron IPC + SQLite with a deliberately persisted checkpoint,
  // not a live provider-success claim. Review/apply must work before all modules exist.
  await panel.getByRole("button", { name: "Review saved modules now" }).click();
  const savedReview = panel.getByRole("region", {
    name: "Review saved pathway modules",
  });
  await expect(savedReview).toBeVisible();
  await expect(savedReview).toContainText("Cells as systems");
  await savedReview
    .getByRole("button", { name: "Apply saved modules", exact: true })
    .click();
  await expect(savedReview).not.toBeVisible();
  await expect(
    panel.getByRole("button", { name: "Study saved pathway", exact: true }),
  ).toBeEnabled();
  const checkpointApplied = await call<{ curriculum: { id: string }[] }>(
    "subject:get",
    { subjectId: subject.id },
  );
  expect(
    checkpointApplied.curriculum.some((node) => node.id === "topic-cells"),
  ).toBe(true);
  expect(
    (await call<PathwayJob>("planning:get", { jobId: job.id })).status,
  ).toBe("interrupted");
  await page
    .locator(".main-nav")
    .getByRole("button", { name: /Your library/ })
    .click();
  await expect(page.getByLabel("Background pathway tasks")).toBeVisible();
  await page.getByLabel("Background pathway tasks").locator("summary").click();
  await page
    .getByLabel("Background pathway tasks")
    .getByRole("button")
    .first()
    .click();
  await expect(panel).toContainText("1 of 2 modules");
  await mkdir(join(process.cwd(), "docs", "screenshots"), { recursive: true });
  await page.screenshot({
    path: "docs/screenshots/2.1-pathway-progress-light.png",
    fullPage: true,
  });
  const data = await call<StudioData>("data:load"),
    appearance = sanitizeAppearance(data.appearance);
  appearance.mode = "dark";
  await call("data:save", { ...data, appearance });
  await page.reload();
  await reopenSubject();
  await expect(panel).toContainText(
    "1 of 2 modules completed and checkpointed",
  );
  await page.screenshot({
    path: "docs/screenshots/2.1-pathway-progress-dark.png",
    fullPage: true,
  });
  const failed = await call<PathwayJob>("planning:retry", { jobId: job.id });
  expect(failed.status).toBe("failed");
  await expect(
    panel.getByRole("button", { name: "Retry unfinished work", exact: true }),
  ).toBeVisible();
  await expect(panel.getByRole("alert")).toBeVisible();
  expect(
    (await call<PathwayJob>("planning:get", { jobId: job.id })).chunks,
  ).toHaveLength(1);
});
