import { openDestination } from "./ui-navigation";
import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page,
} from "@playwright/test";
import { mkdtemp, rm, mkdir, copyFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { Lesson, StudioData } from "../src/types";
import type { Subject, SubjectSnapshot, SubjectRecord } from "../src/v2types";

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
  await expect(page.locator(".titlebar-center")).toHaveText("Saved locally");
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setContentSize(1500, 1080),
  );
}
const call = <T = unknown>(action: string, payload?: unknown) =>
  page.evaluate(
    ({ action, payload }) => window.studio!.invoke<T>(action, payload),
    { action, payload },
  );
function normalizedSnapshot() {
  const db = new DatabaseSync(join(directory, "learning-studio.sqlite"), {
    readOnly: true,
  });
  try {
    return [
      "subjects",
      "conversations",
      "curriculum_nodes",
      "subject_concepts",
      "annotation_highlights",
      "subject_records",
    ].map((table) => ({
      table,
      rows: db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all(),
    }));
  } finally {
    db.close();
  }
}
test.beforeEach(async () => {
  directory = await mkdtemp(join(process.cwd(), ".storage-test-restore-ui-"));
  await launch();
});
test.afterEach(async () => {
  await app?.close().catch(() => {});
  if (!resolve(directory).startsWith(resolve(process.cwd()) + sep))
    throw new Error("Test directory escaped workspace");
  await rm(directory, {
    recursive: true,
    force: true,
    maxRetries: 8,
    retryDelay: 200,
  });
});

test("actual Settings restore previews and cancels safely, then commits reviewed normalized data and survives autosave/restart", async () => {
  const source = await call<Subject>("subject:create", {
    name: "Restore acceptance source",
    objective: "Preserve the reviewed library",
    depth: "overview",
  });
  const lesson = await call<Lesson>("subject:conversation-create", {
    subjectId: source.id,
    title: "Original saved explanation",
    mode: "Learn",
  });
  const data = await call<StudioData>("data:load");
  data.activeSubjectId = source.id;
  data.activeLessonId = lesson.id;
  const saved = data.lessons.find((item) => item.id === lesson.id)!;
  saved.notes = "Original reviewed notes";
  saved.messages = [
    {
      id: "restore-message",
      role: "assistant",
      text: "An explanation preserved with its highlight.",
      blocks: [
        { type: "text", text: "An explanation preserved with its highlight." },
        {
          type: "plot",
          spec: { kind: "wave", title: "Restored visual parameters" },
        },
      ],
      createdAt: new Date().toISOString(),
      status: "complete",
    },
  ];
  await call("data:save", data);
  const snapshot = await call<SubjectSnapshot>("subject:get", {
    subjectId: source.id,
  });
  await call("subject:apply", {
    subjectId: source.id,
    baseRevision: snapshot.subject.revision,
    label: "Original pathway",
    origin: "learner",
    operations: [
      {
        entity: "curriculum",
        op: "put",
        id: "restore-node",
        value: {
          kind: "concept",
          title: "Original concept",
          status: "covered",
          position: 0,
        },
      },
    ],
  });
  await call("annotations:create", {
    subjectId: source.id,
    sourceKind: "message",
    sourceId: "restore-message",
    conversationId: lesson.id,
    quote: "An explanation",
    prefix: "",
    suffix: " preserved with its highlight.",
    start: 0,
    end: 14,
    color: "blue",
    note: "Original annotation",
    tags: ["restore"],
  });
  await page.reload();
  await openDestination(page, "Learning workspace: Lesson");
  await expect(page.locator(".titlebar-center")).toHaveText("Saved locally");
  const visual = page.locator('[data-visual-host="restore-message:1"]');
  await expect(
    visual.getByRole("slider", { name: "Amplitude", exact: true }),
  ).toHaveValue("1");
  await visual
    .getByRole("slider", { name: "Amplitude", exact: true })
    .press("Home");
  await expect(
    visual.getByRole("slider", { name: "Amplitude", exact: true }),
  ).toHaveValue("0.1");
  await expect
    .poll(async () => {
      const record = await call<SubjectRecord<any> | null>(
        "subject:record-get",
        { subjectId: source.id, recordType: "visual", id: "restore-message:1" },
      );
      return record?.data.state["plot.parameters"]?.amplitude;
    })
    .toBe(0.1);
  const backup = join(directory, "reviewed-backup.sqlite");
  await app.evaluate(({ dialog }, file) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: file });
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [file],
    });
  }, backup);
  expect(await call("data:backup")).toBe(true);
  await visual
    .getByRole("slider", { name: "Amplitude", exact: true })
    .press("End");
  await expect(
    visual.getByRole("slider", { name: "Amplitude", exact: true }),
  ).toHaveValue("3");
  await expect
    .poll(async () => {
      const record = await call<SubjectRecord<any> | null>(
        "subject:record-get",
        { subjectId: source.id, recordType: "visual", id: "restore-message:1" },
      );
      return record?.data.state["plot.parameters"]?.amplitude;
    })
    .toBe(3);
  const later = await call<Subject>("subject:create", {
    name: "Current library only",
    objective: "Must survive canceled restore",
    depth: "overview",
  });
  const changed = await call<StudioData>("data:load");
  changed.lessons.find((item) => item.id === lesson.id)!.notes =
    "Current unswapped notes";
  await call("data:save", changed);
  await page.reload();
  await expect(page.locator(".titlebar-center")).toHaveText("Saved locally");
  await page
    .locator(".sidebar-bottom")
    .getByRole("button", { name: "Settings", exact: true })
    .click();
  const settings = page.getByRole("region", { name: "Settings", exact: true });
  await settings
    .getByRole("button", {
      name: "Data & privacy: Library, backups and privacy",
      exact: true,
    })
    .click();
  const before = normalizedSnapshot();
  await settings
    .getByRole("button", { name: "Restore backup", exact: true })
    .click();
  const review = settings.getByRole("region", {
    name: "Review SQLite backup restoration",
  });
  await expect(review).toBeVisible();
  await expect(review).toContainText("The current library has not changed");
  expect(normalizedSnapshot()).toEqual(before);
  await mkdir(resolve("docs/figure-repair/screenshots"), { recursive: true });
  await settings.screenshot({
    path: resolve("docs/figure-repair/screenshots/restore-review-native.png"),
  });
  await review
    .getByRole("button", { name: "Cancel restore", exact: true })
    .click();
  await expect(review).toHaveCount(0);
  expect(normalizedSnapshot()).toEqual(before);
  expect(
    (await call<Subject[]>("subject:list")).some(
      (item) => item.id === later.id,
    ),
  ).toBe(true);
  // Real post-unmount failure: the selected backup changes after its preview.
  // No fake response or injected model is involved. Recovery must remount the
  // current SDK state and leave the active database usable instead of spinning.
  const alteredBackup = join(directory, "changed-after-preview.sqlite");
  await copyFile(backup, alteredBackup);
  await app.evaluate(({ dialog }, file) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [file],
    });
  }, alteredBackup);
  await settings
    .getByRole("button", { name: "Restore backup", exact: true })
    .click();
  await expect(review).toBeVisible();
  const altered = new DatabaseSync(alteredBackup);
  const changedRow = altered
    .prepare("SELECT value FROM lessons WHERE id=?")
    .get(lesson.id) as { value: string };
  const changedLesson = JSON.parse(changedRow.value);
  changedLesson.notes = "Changed after review";
  altered
    .prepare("UPDATE lessons SET value=? WHERE id=?")
    .run(JSON.stringify(changedLesson), lesson.id);
  altered.close();
  await review
    .getByRole("button", { name: "Restore reviewed backup", exact: true })
    .click();
  await expect(
    page.getByText(/backup changed since your preview/i),
  ).toBeVisible();
  await expect(
    page.getByText("Reopening the reviewed library…", { exact: true }),
  ).toHaveCount(0);
  await expect(
    visual.getByRole("slider", { name: "Amplitude", exact: true }),
  ).toHaveValue("3");
  expect(
    (await call<StudioData>("data:load")).lessons.find(
      (item) => item.id === lesson.id,
    )?.notes,
  ).toBe("Current unswapped notes");
  expect(
    (await call<Subject[]>("subject:list")).some(
      (item) => item.id === later.id,
    ),
  ).toBe(true);
  await app.evaluate(({ dialog }, file) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [file],
    });
  }, backup);
  await page
    .locator(".sidebar-bottom")
    .getByRole("button", { name: "Settings", exact: true })
    .click();
  await settings
    .getByRole("button", {
      name: "Data & privacy: Library, backups and privacy",
      exact: true,
    })
    .click();
  await settings
    .getByRole("button", { name: "Restore backup", exact: true })
    .click();
  await expect(review).toBeVisible();
  await review
    .getByRole("button", { name: "Restore reviewed backup", exact: true })
    .click();
  await expect(
    page.getByText("Backup restored. Its saved library is now open.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(settings).toHaveCount(0);
  await expect(page.locator(".titlebar-center")).toHaveText("Saved locally");
  await page.waitForTimeout(800);
  // The current mounted SDK must show restored parameters immediately. A valid
  // database alone is insufficient when its old runtime cache still displays 3.
  await expect(
    visual.getByRole("slider", { name: "Amplitude", exact: true }),
  ).toHaveValue("0.1");
  const restored = await call<StudioData>("data:load");
  expect(restored.lessons.find((item) => item.id === lesson.id)?.notes).toBe(
    "Original reviewed notes",
  );
  expect(
    (await call<Subject[]>("subject:list")).some(
      (item) => item.id === later.id,
    ),
  ).toBe(false);
  expect(
    (await call<SubjectSnapshot>("subject:get", { subjectId: source.id }))
      .curriculum[0].title,
  ).toBe("Original concept");
  expect(await call("annotations:list", { subjectId: source.id })).toHaveLength(
    1,
  );
  await app.close();
  await launch();
  await openDestination(page, "Learning workspace: Lesson");
  await expect(
    page
      .locator('[data-visual-host="restore-message:1"]')
      .getByRole("slider", { name: "Amplitude", exact: true }),
  ).toHaveValue("0.1");
  expect(
    (await call<StudioData>("data:load")).lessons.find(
      (item) => item.id === lesson.id,
    )?.notes,
  ).toBe("Original reviewed notes");
  expect(
    (await call<Subject[]>("subject:list")).some(
      (item) => item.id === later.id,
    ),
  ).toBe(false);
});
