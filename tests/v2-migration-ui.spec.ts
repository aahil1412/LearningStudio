import {
  openDestination,
  openSubjectTab,
  startSubjectLesson,
} from "./ui-navigation";
import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page,
} from "@playwright/test";
import { build } from "esbuild";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, mkdir } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { createHash } from "node:crypto";
import type { StudioData } from "../src/types";
import type { Subject, SubjectContext, SubjectSnapshot } from "../src/v2types";
let app: ElectronApplication | undefined,
  page: Page,
  directory: string,
  fixtureScript: string;
const digest = (bytes: Buffer) =>
  createHash("sha256").update(bytes).digest("hex");
const electronExecutable = resolve("node_modules/electron/dist/electron.exe");
function fixtureProcess(args: string[]) {
  const result = spawnSync(electronExecutable, [fixtureScript, ...args], {
    cwd: process.cwd(),
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
    encoding: "utf8",
    timeout: 30000,
  });
  if (result.error) throw result.error;
  expect(result.status, result.stderr || result.stdout).toBe(0);
}
async function launch() {
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
  page = await app.firstWindow();
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setContentSize(1550, 1000),
  );
  await expect(page.locator(".titlebar-center")).toHaveText("Saved locally");
}
const call = <T = unknown>(action: string, payload?: unknown) =>
  page.evaluate(
    ({ action, payload }) => window.studio!.invoke<T>(action, payload),
    { action, payload },
  );
test.beforeEach(async () => {
  directory = await mkdtemp(join(process.cwd(), ".v2-migration-ui-"));
  fixtureScript = join(directory, "legacy-fixture.cjs");
  await build({
    entryPoints: ["tests/v2-legacy-fixture.ts"],
    outfile: fixtureScript,
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node22",
    external: ["better-sqlite3"],
  });
});
test.afterEach(async () => {
  await app?.close().catch(() => {});
  app = undefined;
  const path = resolve(directory),
    root = resolve(process.cwd()) + sep;
  if (!path.startsWith(root) || !path.includes(".v2-migration-ui-"))
    throw new Error("Refusing cleanup outside the test workspace.");
  await rm(path, { recursive: true, force: true });
});
test("an actual v1.1 library upgrades with a pre-migration backup and remains editable across restart", async () => {
  const databasePath = join(directory, "learning-studio.sqlite"),
    expectedPath = join(directory, "expected.json");
  fixtureProcess([databasePath, expectedPath]);
  const original = JSON.parse(
    await readFile(expectedPath, "utf8"),
  ) as StudioData;
  await launch();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  expect(await call<{ databaseVersion: number }>("app:diagnostics")).toEqual(
    expect.objectContaining({ databaseVersion: 4 }),
  );
  const data = await call<StudioData>("data:load"),
    lesson = data.lessons.find((lesson) => lesson.id === "v11-physics")!;
  expect(lesson.messages).toEqual(original.lessons[0].messages);
  expect(lesson.notes).toBe(original.lessons[0].notes);
  expect(lesson.position).toBe(original.lessons[0].position);
  expect(data.relations).toEqual(original.relations);
  expect(data.library).toEqual(original.library);
  expect(data.reviewCards).toEqual(original.reviewCards);
  expect(data.reviewHistory).toEqual(original.reviewHistory);
  expect(data.settings.profile).toBe(original.settings.profile);
  expect(data.settings.assessments).toBe(false);
  expect((data.appearance as any).light.typography.size).toBe(19);
  await expect
    .poll(() =>
      page
        .locator("html")
        .evaluate((element) =>
          getComputedStyle(element).getPropertyValue("--bg").trim(),
        ),
    )
    .toBe("#e6ded0");
  const backupName = (await readdir(directory)).find((name) =>
    name.startsWith("learning-studio.sqlite.pre-v4-"),
  )!;
  expect(backupName).toBeTruthy();
  const backupPath = join(directory, backupName),
    before = digest(await readFile(backupPath)),
    inspectionPath = join(directory, "inspection.json");
  fixtureProcess(["--inspect", backupPath, inspectionPath]);
  const inspected = JSON.parse(await readFile(inspectionPath, "utf8"));
  expect(inspected.version).toBe(2);
  expect(inspected.hasSubjects).toBe(false);
  expect(inspected.data).toEqual(original);
  expect(digest(await readFile(backupPath))).toBe(before);
  await openDestination(page, "Learning workspace: Lesson");
  await page.getByRole("button", { name: "Notes", exact: true }).click();
  await page
    .getByLabel("Session notes", { exact: true })
    .fill("Original notes continued after the version 2 migration.");
  await expect
    .poll(
      async () =>
        (await call<StudioData>("data:load")).lessons.find(
          (lesson) => lesson.id === "v11-physics",
        )?.notes,
    )
    .toContain("continued after");
  await openDestination(page, "Subject workspaces: My learning");
  await page.locator(".subject-tile").filter({ hasText: "Physics" }).click();
  await openSubjectTab(page, "Shared memory");
  await expect(
    page.getByRole("heading", { name: "Conservation", exact: true }),
  ).toBeVisible();
  await page
    .getByLabel("Memory title", { exact: true })
    .fill("Boundary condition continuation");
  await page
    .getByLabel("Memory content", { exact: true })
    .fill(
      "Use the isolated-system boundary condition before extending the conservation argument.",
    );
  await page
    .getByRole("button", { name: "Save memory record", exact: true })
    .click();
  await expect(
    page.getByRole("heading", {
      name: "Boundary condition continuation",
      exact: true,
    }),
  ).toBeVisible();
  const subject = (await call<Subject[]>("subject:list")).find(
    (subject) => subject.name === "Physics",
  )!;
  await startSubjectLesson(page);
  await expect
    .poll(async () => (await call<StudioData>("data:load")).lessons.length)
    .toBe(2);
  const context = await call<SubjectContext>("subject:context", {
    subjectId: subject.id,
    query: "Boundary condition",
    tokenBudget: 1200,
  });
  expect(context.findings).toContainEqual(
    expect.objectContaining({ title: "Boundary condition continuation" }),
  );
  expect(context.usage.estimatedTokens).toBeLessThanOrEqual(1200);
  await expect(page.locator(".titlebar-center")).toHaveText("Saved locally");
  await app!.close();
  app = undefined;
  await launch();
  const reopened = await call<StudioData>("data:load");
  expect(reopened.lessons).toHaveLength(2);
  expect(
    reopened.lessons.find((lesson) => lesson.id === "v11-physics")?.notes,
  ).toContain("continued after");
  expect(
    reopened.lessons.find((lesson) => lesson.id === "v11-physics")?.messages,
  ).toEqual(original.lessons[0].messages);
  const snapshot = await call<SubjectSnapshot>("subject:get", {
    subjectId: subject.id,
  });
  expect(snapshot.conversations).toHaveLength(2);
  expect(
    snapshot.memory.some(
      (memory) => memory.title === "Boundary condition continuation",
    ),
  ).toBe(true);
  expect(
    snapshot.concepts.find((concept) => concept.id === "v11-conservation")
      ?.status,
  ).toBe("partial");
  expect((reopened.appearance as any).dark.colors.bg).toBe("#302923");
  expect(digest(await readFile(backupPath))).toBe(before);
  expect(errors).toEqual([]);
  await mkdir("docs/screenshots", { recursive: true });
  await page.screenshot({
    path: "docs/screenshots/v2-migration-restarted.png",
  });
});
