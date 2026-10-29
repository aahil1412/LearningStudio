import { seedReferenceLesson } from "./learning-fixtures";
import { openDestination } from "./ui-navigation";
import {
  _electron as electron,
  test,
  expect,
  type ElectronApplication,
  type Page,
} from "@playwright/test";
import { mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, basename, sep } from "node:path";
import type { StudioData } from "../src/types";
let app: ElectronApplication, page: Page, directory: string;
async function launch() {
  const env: Record<string, string> = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
  env.STUDIO_DATA_DIR = directory;
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.STUDIO_DEV_URL;
  app = await electron.launch({ args: ["."], cwd: process.cwd(), env });
  page = await app.firstWindow();
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setContentSize(1500, 980),
  );
  await expect(page.locator(".titlebar-center")).toHaveText("Saved locally");
}
const stored = () =>
  page.evaluate(() => window.studio!.invoke<StudioData>("data:load"));
const saved = async (check: (data: StudioData) => boolean) => {
  await expect.poll(async () => check(await stored())).toBe(true);
};
const nav = async (name: RegExp) => {
  await openDestination(
    page,
    name.source.includes("Learning workspace")
      ? "Learning workspace: Lesson"
      : name,
  );
};
async function capture(name: string) {
  const folder = join(process.cwd(), "docs/screenshots");
  mkdirSync(folder, { recursive: true });
  await page.screenshot({ path: join(folder, name), animations: "disabled" });
}
test.beforeEach(async () => {
  directory = mkdtempSync(join(tmpdir(), "studio-learning-e2e-"));
  await launch();
});
test.afterEach(async () => {
  await app?.close().catch(() => {});
  const target = resolve(directory);
  if (
    !target.startsWith(resolve(tmpdir()) + sep) ||
    !basename(target).startsWith("studio-learning-e2e-")
  )
    throw new Error("Unexpected temporary path.");
  rmSync(target, {
    recursive: true,
    force: true,
    maxRetries: 8,
    retryDelay: 200,
  });
});

test("numeric review schedules SM-2 and knowledge stays unassessed until evidence is explicitly confirmed", async () => {
  await seedReferenceLesson(page);
  await nav(/Knowledge graph/);
  await page.getByRole("button", { name: "Add concept", exact: true }).click();
  await page
    .getByLabel("Concept name", { exact: true })
    .fill("Rate calculations");
  await page
    .getByLabel("Linked lesson", { exact: true })
    .selectOption({ label: "The shape of change" });
  await page
    .getByRole("button", { name: "Create concept", exact: true })
    .click();
  await nav(/Practice & review/);
  await page
    .getByLabel("New practice collection", { exact: true })
    .fill("Calculus recall");
  await page
    .getByRole("button", { name: "Create practice collection", exact: true })
    .click();
  await page
    .locator(".review-header")
    .getByRole("button", { name: "Create practice card", exact: true })
    .click();
  await page
    .getByLabel("Practice question", { exact: true })
    .fill("Calculate 6 / 2.");
  await page
    .getByLabel("Practice reference answer", { exact: true })
    .fill("3, because division asks how many groups of two fit into six.");
  await page
    .getByLabel("Grading method", { exact: true })
    .selectOption("numeric");
  await page.getByLabel("Expected numeric value", { exact: true }).fill("3");
  await page.getByLabel("Numeric tolerance", { exact: true }).fill("0.001");
  await page
    .getByLabel("Practice source lesson", { exact: true })
    .selectOption({ label: "The shape of change" });
  await page
    .getByLabel("Practice linked concept", { exact: true })
    .selectOption({ label: "Rate calculations" });
  await page
    .getByRole("button", { name: "Save practice card", exact: true })
    .click();
  await page
    .locator(".review-card")
    .getByRole("button", { name: "Review", exact: true })
    .click();
  await page.getByLabel("Review answer", { exact: true }).fill("6/2");
  await page
    .getByRole("button", { name: "Check against reference", exact: true })
    .click();
  await expect(
    page.getByText("Reference check passed", { exact: true }),
  ).toBeVisible();
  expect((await stored()).concepts[0].status).toBe("unassessed");
  await page.getByLabel("Recall quality", { exact: true }).selectOption("4");
  await page
    .getByRole("button", { name: "Save review & schedule next", exact: true })
    .click();
  await saved(
    (data) =>
      (data.reviewHistory?.length || 0) === 1 &&
      data.reviewCards?.[0].intervalDays === 1 &&
      data.knowledgeSuggestions?.[0].state === "pending",
  );
  const before = await stored();
  expect(before.concepts[0].status).toBe("unassessed");
  expect(before.reviewHistory?.[0]).toMatchObject({
    answer: "6/2",
    correct: true,
    method: "numeric",
    grade: 4,
  });
  await page.getByRole("button", { name: /Confirm evidence/ }).click();
  await expect(page.getByLabel("Evidence for Rate calculations")).toHaveValue(
    /Learner response: 6\/2/,
  );
  await page
    .getByRole("button", { name: "Confirm knowledge change", exact: true })
    .click();
  await saved(
    (data) =>
      data.concepts[0].status === "demonstrated" &&
      data.knowledgeSuggestions?.[0].state === "accepted",
  );
  await page
    .getByRole("button", { name: "Review history", exact: true })
    .click();
  await expect(page.locator(".review-history")).toContainText("6/2");
  await capture("review-advanced.png");
  await app.close();
  await launch();
  await nav(/Practice & review/);
  await page.getByRole("button", { name: "All cards", exact: true }).click();
  await expect(page.locator(".review-card")).toContainText("Calculate 6 / 2.");
  const reopened = await stored();
  expect(reopened.reviewCards?.[0].dueAt).toBe(before.reviewCards?.[0].dueAt);
  expect(reopened.reviewHistory?.[0].answer).toBe("6/2");
  expect(reopened.concepts[0].status).toBe("demonstrated");
  // Removing the source lesson must preserve its resources and review evidence,
  // clearing only the dangling lesson links before the next SQLite transaction.
  await nav(/Your library/);
  await page
    .getByRole("button", { name: "Add to library", exact: true })
    .click();
  await page
    .getByLabel("Resource title", { exact: true })
    .fill("Supporting notes");
  await page
    .getByLabel("Resource content", { exact: true })
    .fill("Retain these notes after deleting the source session.");
  await page
    .getByLabel("Linked library lessons", { exact: true })
    .selectOption({ label: "The shape of change" });
  await page
    .getByRole("button", { name: "Save resource", exact: true })
    .click();
  await saved(
    (data) =>
      !!data.library.find((i) => i.title === "Supporting notes")?.lessonIds
        ?.length,
  );
  await nav(/^Learning workspace: Study$/);
  await page
    .getByRole("button", { name: "Session actions", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Delete session", exact: true })
    .click();
  await page
    .getByRole("dialog", { name: "Delete session", exact: true })
    .getByRole("button", { name: "Delete session", exact: true })
    .click();
  await saved(
    (data) =>
      data.lessons.length === 0 &&
      !data.reviewCards?.[0].lessonId &&
      !data.concepts[0].lessonId &&
      !data.knowledgeSuggestions?.[0].lessonId &&
      !data.library.find((i) => i.title === "Supporting notes")?.lessonIds
        ?.length,
  );
  expect((await stored()).reviewHistory?.[0].answer).toBe("6/2");
  await expect(
    page.getByRole("heading", { name: "Your learning", exact: true }),
  ).toBeVisible();
});

test("hierarchy links and drag reparenting survive restart, and graph coordinates have durable undo and redo", async () => {
  await seedReferenceLesson(page);
  await expect(page.locator(".laboratory")).toHaveCount(0);
  await nav(/Your library/);
  const add = async (kind: string, title: string, parent?: string) => {
    await page
      .getByRole("button", { name: "Add to library", exact: true })
      .click();
    await page.getByLabel("Resource title", { exact: true }).fill(title);
    await page.getByLabel("Resource type", { exact: true }).selectOption(kind);
    if (parent)
      await page
        .getByLabel("Resource parent", { exact: true })
        .selectOption({ label: parent });
    await page
      .getByLabel("Resource content", { exact: true })
      .fill("Retain the original learning material.");
    if (kind === "note")
      await page
        .getByLabel("Linked library lessons", { exact: true })
        .selectOption({ label: "The shape of change" });
    await page
      .getByRole("button", { name: "Save resource", exact: true })
      .click();
  };
  await add("subject", "Quantitative worlds");
  await add("course", "Models", "Quantitative worlds");
  await add("topic", "Change", "Quantitative worlds / Models");
  await add("note", "Worked notes", "Quantitative worlds / Models / Change");
  await add("topic", "Limits", "Quantitative worlds / Models");
  await page.getByRole("button", { name: "Hierarchy", exact: true }).click();
  const source = page
      .locator(".lib-tree-row")
      .filter({ hasText: "Worked notes" }),
    target = page.locator(".lib-tree-row").filter({ hasText: "Limits" });
  await source.dragTo(target);
  await saved((data) => {
    const note = data.library.find((i) => i.title === "Worked notes"),
      topic = data.library.find((i) => i.title === "Limits");
    return !!note && note.parentId === topic?.id;
  });
  await page
    .getByRole("button", { name: "Close library details", exact: true })
    .click();
  await capture("library-hierarchy.png");
  await nav(/Knowledge graph/);
  await page.getByRole("button", { name: "Add concept", exact: true }).click();
  await page.getByLabel("Concept name", { exact: true }).fill("Tangent");
  await page
    .getByRole("button", { name: "Create concept", exact: true })
    .click();
  await saved((data) =>
    data.concepts.some(
      (concept) =>
        concept.label === "Tangent" &&
        !!concept.subjectId &&
        concept.subjectId === data.activeSubjectId &&
        !!concept.subjectRevision,
    ),
  );
  const node = page.locator(".react-flow__node").filter({ hasText: "Tangent" });
  await expect(node).toBeVisible();
  await page.locator(".react-flow__controls-fitview").click();
  await node.hover();
  const bounds = await node.boundingBox();
  expect(bounds).not.toBeNull();
  await page.mouse.move(bounds!.x + 40, bounds!.y + 20);
  await page.mouse.down();
  await page.mouse.move(bounds!.x + 120, bounds!.y + 75, { steps: 10 });
  await page.mouse.up();
  await saved(
    (data) => !!data.concepts[0].position && !!data.graphHistory?.past.length,
  );
  const position = (await stored()).concepts[0].position;
  await page
    .getByRole("button", { name: "Undo graph change", exact: true })
    .click();
  await saved(
    (data) => data.concepts.length === 1 && !data.concepts[0].position,
  );
  await page
    .getByRole("button", { name: "Redo graph change", exact: true })
    .click();
  await saved((data) => data.concepts[0].position?.x === position?.x);
  await app.close();
  await launch();
  const reopened = await stored();
  expect(
    reopened.library.find((i) => i.title === "Worked notes")?.parentId,
  ).toBe(reopened.library.find((i) => i.title === "Limits")?.id);
  expect(
    reopened.library.find((i) => i.title === "Worked notes")?.lessonIds,
  ).toEqual([reopened.lessons[0].id]);
  expect(reopened.concepts[0].position).toEqual(position);
  await nav(/Knowledge graph/);
  await page
    .getByRole("button", { name: "Edit concepts & relations", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Undo graph change", exact: true })
    .click();
  await saved((data) => !data.concepts[0].position);
  await page
    .getByRole("button", { name: "Redo graph change", exact: true })
    .click();
  await saved((data) => data.concepts[0].position?.x === position?.x);
  const scopedConcept = (await stored()).concepts[0];
  await page
    .locator(".react-flow__node")
    .filter({ hasText: "Tangent" })
    .click();
  await page
    .getByRole("button", {
      name: "Remove concept and connections",
      exact: true,
    })
    .click();
  await saved(
    (data) => !data.concepts.some((concept) => concept.id === scopedConcept.id),
  );
  const removed = await page.evaluate(
    (subjectId) => window.studio!.invoke<any>("subject:get", { subjectId }),
    scopedConcept.subjectId,
  );
  const removal = removed.revisions.find(
    (revision: any) =>
      revision.status === "applied" &&
      revision.operations.some(
        (op: any) =>
          op.entity === "concept" &&
          op.op === "delete" &&
          op.id === scopedConcept.id,
      ),
  );
  expect(removal).toBeTruthy();
  await page.evaluate(
    ({ subjectId, revisionId }) =>
      window.studio!.invoke("subject:rollback", { subjectId, revisionId }),
    { subjectId: scopedConcept.subjectId, revisionId: removal.id },
  );
  await page.reload();
  await saved((data) =>
    data.concepts.some(
      (concept) => concept.id === scopedConcept.id && !!concept.subjectRevision,
    ),
  );
});
