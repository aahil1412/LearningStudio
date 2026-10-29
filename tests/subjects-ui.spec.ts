import {
  openDestination,
  openMessageActions,
  openTutor,
  openConversationRecord,
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
import { mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { StudioData, Lesson } from "../src/types";
import type { Subject, SubjectSnapshot } from "../src/v2types";
import { sanitizeAppearance } from "../src/lib/themes";
import { build } from "esbuild";
import type { PathwayJob, SubjectIntake } from "../src/v21types";
let app: ElectronApplication, page: Page, directory: string;
let providerDirectory: string | undefined;
async function launch() {
  const env: Record<string, string> = Object.fromEntries(
    Object.entries({ ...process.env, STUDIO_DATA_DIR: directory }).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.STUDIO_DEV_URL;
  app = await electron.launch({ args: ["."], cwd: process.cwd(), env });
  page = await app.firstWindow();
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setContentSize(1550, 1000),
  );
  await expect(page.locator(".titlebar-center")).toHaveText("Saved locally");
}
async function call<T = unknown>(action: string, payload?: unknown) {
  return page.evaluate(
    ({ action, payload }) => window.studio!.invoke<T>(action, payload),
    { action, payload },
  );
}
async function openSubjects() {
  await openDestination(page, "Subject workspaces: Subjects");
}
async function create() {
  await openSubjects();
  await page.getByRole("button", { name: "New subject", exact: true }).click();
  await page
    .getByLabel("Subject workspace name")
    .fill("Broad scientific learning");
  await page
    .getByLabel("Subject learning objective")
    .fill("Understand physics from foundations through advanced ideas");
  await page
    .getByRole("button", { name: "Create subject", exact: true })
    .click();
  await expect(
    page.getByRole("heading", {
      name: "Broad scientific learning",
      level: 1,
      exact: true,
    }),
  ).toBeVisible();
  const subject = (await call<Subject[]>("subject:list")).find(
    (s) => s.name === "Broad scientific learning",
  )!;
  expect(await call("planning:list", { subjectId: subject.id })).toEqual([]);
  await page
    .getByRole("region", { name: "Conversational learning setup" })
    .getByRole("button", { name: "Skip setup and use defaults", exact: true })
    .click();
  await expect(
    page.getByRole("region", { name: "Conversational learning setup" }),
  ).toHaveCount(0);
  expect(
    await call<SubjectIntake>("learning:intake-get", { subjectId: subject.id }),
  ).toMatchObject({ status: "skipped", assessment: "skipped" });
  return subject;
}
test.beforeEach(async () => {
  directory = mkdtempSync(join(tmpdir(), "studio-v2-subject-"));
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
  if (providerDirectory) {
    rmSync(providerDirectory, {
      recursive: true,
      force: true,
      maxRetries: 8,
      retryDelay: 200,
    });
    providerDirectory = undefined;
  }
});

test("broad workspace, editable pathway, separate coverage, shared evidence, branches and restart", async () => {
  const subject = await create();
  await expect(
    page
      .getByRole("main")
      .getByText("Understand physics from foundations through advanced ideas", {
        exact: true,
      }),
  ).toBeVisible();
  await openSubjectTab(page, "Learning pathway");
  await page.getByLabel("Curriculum title").fill("Foundations");
  await page.getByLabel("Curriculum kind").selectOption("module");
  await page.getByRole("button", { name: "Save topic", exact: true }).click();
  await expect(page.locator(".curriculum-tree")).toContainText("Foundations");
  const initial = await call<SubjectSnapshot>("subject:get", {
    subjectId: subject.id,
  });
  const module = initial.curriculum[0];
  await call("subject:apply", {
    subjectId: subject.id,
    baseRevision: initial.subject.revision,
    label: "Explicit test learning evidence",
    origin: "learner",
    operations: [
      {
        entity: "concept",
        op: "put",
        id: "energy",
        value: {
          label: "Energy conservation",
          status: "partial",
          coverage: "covered",
          evidence:
            "The learner explains conservation with a closed-system example.",
        },
      },
      {
        entity: "curriculum",
        op: "put",
        id: "energy-topic",
        value: {
          kind: "topic",
          parentId: module.id,
          title: "Energy conservation",
          description: "Closed-system reasoning",
          position: 1,
          status: "covered",
          conceptId: "energy",
          userEdited: true,
        },
      },
      {
        entity: "memory",
        op: "put",
        id: "finding-energy",
        value: {
          kind: "finding",
          title: "Closed system explanation",
          content:
            "We already connected energy conservation to system boundaries.",
          conceptIds: ["energy"],
        },
      },
    ],
  });
  await openSubjectTab(page, "Dashboard");
  await expect(page.getByLabel("Coverage", { exact: true })).toHaveAttribute(
    "value",
    "1",
  );
  await expect(
    page.getByLabel("Demonstrated understanding", { exact: true }),
  ).toHaveAttribute("value", "0");
  await startSubjectLesson(page);
  await expect(page.locator(".lesson-top")).toContainText("New conversation");
  const data = await call<StudioData>("data:load"),
    chat = data.lessons.find((lesson) => lesson.subjectId === subject.id)!;
  const second = await call<Lesson>("subject:conversation-create", {
    subjectId: subject.id,
    title: "Another direction",
    mode: "Explore",
  });
  const context = await call<any>("subject:context", {
    subjectId: subject.id,
    conversationId: second.id,
    query: "energy conservation closed system",
    tokenBudget: 900,
  });
  expect(JSON.stringify(context)).toContain("Energy conservation");
  expect(JSON.stringify(context)).toContain("system boundaries");
  expect(context.usage.estimatedTokens).toBeLessThanOrEqual(900);
  expect(context.usage.fullHistoryIncluded).toBe(false);
  // Actual transcript storage is sparse: only the branch relationship stores its prefix.
  await call("data:save", {
    ...data,
    lessons: data.lessons.map((lesson) =>
      lesson.id === chat.id
        ? {
            ...lesson,
            messages: [
              {
                id: "origin-user",
                role: "user",
                text: "Energy remains constant in a closed system.",
                createdAt: new Date().toISOString(),
                status: "complete",
              },
              {
                id: "origin-answer",
                role: "assistant",
                text: "System boundaries determine which transfers must be included.",
                createdAt: new Date().toISOString(),
                status: "complete",
              },
            ],
          }
        : lesson,
    ),
  });
  await page.reload();
  await openConversationRecord(page);
  await expect(page.locator(".lesson-message")).toHaveCount(2);
  for (const message of await page.locator(".lesson-message").all())
    await openMessageActions(message);
  await expect(
    page.getByRole("button", { name: "Branch conversation from this message" }),
  ).toHaveCount(2);
  await page
    .getByRole("button", { name: "Branch conversation from this message" })
    .last()
    .click();
  await expect(
    page.getByRole("button", { name: "Return to original branch" }),
  ).toBeVisible();
  await expect(page.locator(".lesson-message")).toHaveCount(2);
  const branched = await call<StudioData>("data:load"),
    branch = branched.lessons.find(
      (lesson) => lesson.parentConversationId === chat.id,
    )!;
  expect(branch.messages).toHaveLength(0);
  expect(branch.branchMessageId).toBe("origin-answer");
  await app.close();
  await launch();
  await openDestination(page, "Learning workspace: Lesson");
  await expect(page.locator(".lesson-message")).toHaveCount(2);
  await page.getByRole("button", { name: "Return to original branch" }).click();
  await expect(page.locator(".lesson-top")).toContainText("New conversation");
  await openSubjects();
  await page
    .locator(".subject-tile")
    .filter({ hasText: "Broad scientific learning" })
    .click();
  await expect(
    page.getByLabel("Demonstrated understanding", { exact: true }),
  ).toHaveAttribute("value", "0");
  mkdirSync("docs/screenshots", { recursive: true });
  await page.screenshot({ path: "docs/screenshots/v2-subject-light.png" });
  const canonical = await call<StudioData>("data:load");
  await call("data:save", {
    ...canonical,
    appearance: { ...sanitizeAppearance(canonical.appearance), mode: "dark" },
  });
  await page.reload();
  await openSubjects();
  await page
    .locator(".subject-tile")
    .filter({ hasText: "Broad scientific learning" })
    .click();
  await page.screenshot({ path: "docs/screenshots/v2-subject-dark.png" });
});

test("living textbook, precise search, memory corrections and failed model preserve subject state", async () => {
  const subject = await create();
  await openSubjectTab(page, "Shared memory");
  await page.getByLabel("Memory title").fill("Unresolved boundary question");
  await page
    .getByLabel("Memory content")
    .fill("When should a system boundary include the environment?");
  await page
    .getByRole("button", { name: "Save memory record", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Unresolved boundary question" }),
  ).toBeVisible();
  await openDestination(page, "Textbook");
  await page.getByRole("button", { name: "New chapter", exact: true }).click();
  await page.getByLabel("Chapter title").fill("System boundaries");
  await page
    .getByLabel("Chapter Markdown")
    .fill(
      "# System boundaries\n\nA closed system exchanges no matter. The conserved quantity depends on the model.\n\n$$E=mc^2$$",
    );
  await page.getByRole("button", { name: "Save chapter", exact: true }).click();
  await expect(page.locator(".v2-chapter-preview .katex")).toBeVisible();
  const snapshot = await call<SubjectSnapshot>("subject:get", {
    subjectId: subject.id,
  });
  expect(
    snapshot.records.some(
      (record) =>
        record.recordType === "chapter" && record.title === "System boundaries",
    ),
  ).toBe(true);
  expect(
    (
      await call<any>("subject:record-get", {
        subjectId: subject.id,
        id: snapshot.records.find((record) => record.recordType === "chapter")!
          .id,
      })
    ).data.title,
  ).toBe("System boundaries");
  const results = await call<any[]>("subject:search", {
    subjectId: subject.id,
    query: "System boundaries",
    kind: "chapter",
  });
  expect(
    results.some(
      (result) =>
        result.recordId ===
        snapshot.records.find((record) => record.recordType === "chapter")?.id,
    ),
  ).toBe(true);
  await expect(
    call("model:send", {
      requestId: "failed-memory-request",
      model: "unconnected",
      instructions: "Return a memory update",
      input: [{ role: "user", content: "continue" }],
    }),
  ).rejects.toThrow(/Connect ChatGPT/);
  const after = await call<SubjectSnapshot>("subject:get", {
    subjectId: subject.id,
  });
  expect(after.subject.revision).toBe(snapshot.subject.revision);
  expect(after.memory).toEqual(snapshot.memory);
  await page.reload();
  await openSubjects();
  await page
    .locator(".subject-tile")
    .filter({ hasText: "Broad scientific learning" })
    .click();
  await openDestination(page, "Textbook");
  await page.getByRole("button", { name: /System boundaries/ }).click();
  await expect(page.locator(".v2-chapter-preview .katex")).toBeVisible();
  await page.screenshot({ path: "docs/screenshots/v2-textbook.png" });
});

test("real Electron teaching flow proposes a broad pathway and sends bounded shared JSON to a second chat", async () => {
  // A clearly labeled provider fixture exercises the real UI, IPC, SQLite and teaching controller.
  // It neither authenticates an account nor counts as live subscription verification.
  providerDirectory = mkdtempSync(
    join(process.cwd(), ".provider-test-planning-"),
  );
  const fixturePath = join(providerDirectory, "planning-fixture.cjs");
  await build({
    entryPoints: ["tests/v21-planning-service-fixture.ts"],
    outfile: fixturePath,
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node22",
    external: ["better-sqlite3"],
  });
  await app.evaluate(
    async (
      { ipcMain, app: desktop, BrowserWindow },
      { fixtureUrl, dbPath },
    ) => {
      const module = process
        .getBuiltinModule("node:module")
        .createRequire(process.cwd() + "/package.json")(fixtureUrl);
      const fixtureStore = new module.StudioStore(dbPath),
        fixtureSubjects = new module.SubjectStore(fixtureStore);
      (globalThis as any).v21PlanningCaptured = [];
      const fixturePlanning = new module.PlanningService(
        fixtureStore,
        fixtureSubjects,
        {
          models: async () => [
            {
              id: "fixture-model",
              name: "Protocol fixture",
              reasoningLevels: ["medium"],
            },
          ],
          request: async (payload: any) => {
            (globalThis as any).v21PlanningCaptured.push(payload);
            const input = JSON.parse(payload.input[0].content);
            await new Promise((resolve) => setTimeout(resolve, 80));
            return JSON.stringify(
              input.module
                ? {
                    nodes: [
                      {
                        id: "systems",
                        parentId: input.module.id,
                        kind: "topic",
                        title:
                          input.module.title === "Scientific foundations"
                            ? "Systems and conservation"
                            : "Applications of conservation",
                        description: "Boundaries and conserved quantities",
                        prerequisites: [],
                      },
                      {
                        id: "conservation-principle",
                        parentId: "systems",
                        kind: "concept",
                        title: input.module.title + " conservation principle",
                        description:
                          "Account for transfers across a chosen boundary.",
                        prerequisites: [],
                      },
                    ],
                  }
                : {
                    modules: [
                      {
                        id: "foundations",
                        title: "Scientific foundations",
                        description: "A broad starting point",
                        priorities: ["Systems and boundaries"],
                        prerequisites: [],
                      },
                      {
                        id: "applications",
                        title: "Scientific applications",
                        description: "Connect principles to examples",
                        priorities: ["Use conservation"],
                        prerequisites: ["foundations"],
                      },
                    ],
                  },
            );
          },
          changed: () => {
            for (const window of BrowserWindow.getAllWindows())
              if (!window.isDestroyed())
                window.webContents.send("studio:data-changed");
          },
        },
      );
      desktop.once("before-quit", () => {
        fixturePlanning.dispose();
        fixtureStore.close();
      });
      const original = (ipcMain as any)._invokeHandlers.get("studio:invoke");
      (globalThis as any).v2Captured = [];
      ipcMain.removeHandler("studio:invoke");
      ipcMain.handle("studio:invoke", async (event, action, payload) => {
        if (action === "auth:status")
          return { connected: true, account: "Explicit test fixture" };
        if (action === "auth:models")
          return [
            {
              id: "fixture-model",
              name: "Protocol fixture",
              reasoningLevels: ["medium"],
            },
          ];
        if (action.startsWith("planning:"))
          return fixturePlanning.handle(action, payload);
        if (action === "model:send") {
          (globalThis as any).v2Captured.push(payload);
          if (payload.input.at(-1)?.content?.includes("FAIL_REQUEST"))
            throw new Error(
              "Synthetic provider failure; original subject unchanged.",
            );
          return JSON.stringify({
            text: "A system boundary tells us which exchanges must be included. Coverage does not establish understanding.",
            blocks: [{ type: "equation", latex: "\\Delta E = Q-W" }],
            subjectUpdates: [
              {
                kind: "finding",
                title: "System boundary finding",
                content: "We connected conservation to boundary transfers.",
                conceptIds: [],
              },
            ],
          });
        }
        return original(event, action, payload);
      });
    },
    {
      fixtureUrl: fixturePath,
      dbPath: join(directory, "learning-studio.sqlite"),
    },
  );
  await page.reload();
  const subject = await create();
  await page
    .getByRole("button", { name: "Construct a learning pathway", exact: true })
    .click();
  await openDestination(page, "Your library");
  await expect(page.getByLabel("Background pathway tasks")).toBeVisible();
  await openSubjects();
  await page
    .locator(".subject-tile")
    .filter({ hasText: "Broad scientific learning" })
    .click();
  await expect(
    page.getByRole("region", { name: "Persistent pathway progress" }),
  ).toContainText("Your pathway is ready to review");
  const jobs = await call<PathwayJob[]>("planning:list", {
    subjectId: subject.id,
    includeChunks: true,
  });
  expect(jobs[0]).toMatchObject({
    status: "awaiting-review",
    completedModules: 2,
    totalModules: 2,
  });
  expect(jobs[0].chunks).toHaveLength(2);
  expect(jobs[0].outline).toHaveLength(2);
  const planned = await app.evaluate(
    () =>
      (globalThis as any).v21PlanningCaptured as {
        input: { content: string }[];
      }[],
  );
  expect(planned).toHaveLength(3);
  expect(JSON.parse(planned[0].input[0].content)).toMatchObject({
    intake: {
      status: "skipped",
      assessment: "skipped",
      goal: "Understand physics from foundations through advanced ideas",
    },
  });
  expect(
    planned
      .slice(1)
      .every((request) => JSON.parse(request.input[0].content).module?.id),
  ).toBe(true);
  expect(
    planned.every((request) => request.input[0].content.length < 60000),
  ).toBe(true);
  expect(
    (await call<SubjectSnapshot>("subject:get", { subjectId: subject.id }))
      .curriculum,
  ).toHaveLength(0);
  await page
    .getByRole("button", { name: "Apply reviewed pathway", exact: true })
    .click();
  await openSubjectTab(page, "Learning pathway");
  await expect(page.locator(".curriculum-tree")).toContainText(
    "Systems and conservation",
  );
  await startSubjectLesson(page);
  await openTutor(page);
  await page
    .getByLabel("Message the tutor")
    .fill("Explain energy conservation");
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await expect(page.locator(".lesson-message.assistant .katex")).toBeVisible();
  await page
    .getByRole("complementary", { name: "Subject contents", exact: true })
    .getByRole("button", { name: /^Shared memory/ })
    .click();
  await openSubjectTab(page, "Shared memory");
  await expect(page.getByText(/Findings from New conversation/)).toBeVisible();
  await page
    .getByRole("button", { name: "Accept reviewed changes", exact: true })
    .click();
  await startSubjectLesson(page);
  await openTutor(page);
  await page
    .getByLabel("Message the tutor")
    .fill("Continue with system boundaries");
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await expect(page.locator(".lesson-message.assistant")).toContainText(
    "A system boundary",
  );
  const captured = await app.evaluate(
    () =>
      (globalThis as any).v2Captured as {
        instructions: string;
        input: { content: string }[];
      }[],
  );
  expect(captured.at(-1)?.instructions).toContain(
    "We connected conservation to boundary transfers.",
  );
  expect(captured.at(-1)?.instructions).toContain("fullHistoryIncluded");
  expect(captured.at(-1)?.input.length).toBeLessThanOrEqual(14);
  const before = await call<SubjectSnapshot>("subject:get", {
    subjectId: subject.id,
  });
  await openTutor(page);
  await page.getByLabel("Message the tutor").fill("FAIL_REQUEST");
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await expect(page.locator(".lesson-message").last()).toContainText(
    "Synthetic provider failure",
  );
  const after = await call<SubjectSnapshot>("subject:get", {
    subjectId: subject.id,
  });
  expect(after.memory).toEqual(before.memory);
  await openTutor(page);
  await page.getByLabel("Message the tutor").fill("Continue");
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await expect(page.locator(".lesson-message.assistant").last()).toContainText(
    "A system boundary",
  );
});

test("subject search opens exact concepts, curriculum nodes, notes and message anchors", async () => {
  const subject = await create(),
    snapshot = await call<SubjectSnapshot>("subject:get", {
      subjectId: subject.id,
    });
  await call("subject:apply", {
    subjectId: subject.id,
    baseRevision: snapshot.subject.revision,
    label: "Searchable records",
    origin: "learner",
    operations: [
      {
        entity: "concept",
        op: "put",
        id: "search-concept",
        value: {
          label: "Boundary search concept",
          status: "unassessed",
          coverage: "introduced",
          evidence: "",
        },
      },
      {
        entity: "curriculum",
        op: "put",
        id: "search-node",
        value: {
          kind: "topic",
          title: "Boundary search topic",
          description: "CurriculumBeacon",
          status: "introduced",
        },
      },
      {
        entity: "memory",
        op: "put",
        id: "search-memory",
        value: {
          kind: "question",
          title: "Boundary search question",
          content: "Which source explains the boundary?",
          conceptIds: [],
        },
      },
    ],
  });
  const chat = await call<Lesson>("subject:conversation-create", {
      subjectId: subject.id,
      title: "Search destination chat",
    }),
    data = await call<StudioData>("data:load");
  await call("data:save", {
    ...data,
    activeSubjectId: subject.id,
    lessons: data.lessons.map((lesson) =>
      lesson.id === chat.id
        ? {
            ...lesson,
            messages: [
              {
                id: "search-message",
                role: "assistant",
                text: "MessageBeacon with a source explanation.",
                createdAt: new Date().toISOString(),
                status: "complete",
              },
            ],
          }
        : lesson,
    ),
    library: [
      ...data.library,
      {
        id: "search-note",
        subjectId: subject.id,
        subject: subject.name,
        kind: "note",
        title: "Boundary search source note",
        content: "SourceNoteBeacon",
        createdAt: new Date().toISOString(),
      },
    ],
  });
  await page.reload();
  const search = async (kind: string, query: string) => {
    await openSubjects();
    await page
      .locator(".subject-tile")
      .filter({ hasText: "Broad scientific learning" })
      .click();
    await openSubjectTab(page, "Search subject");
    await page.getByLabel("Search this subject").fill(query);
    await page.getByLabel("Subject search type").selectOption(kind);
    await page
      .locator(".v2-search")
      .getByRole("button", { name: "Search", exact: true })
      .click();
    await expect(page.locator(".v2-search-result")).toHaveCount(1);
    await page.locator(".v2-search-result").click();
  };
  await search("concept", "Boundary search concept");
  await expect(
    page.locator('[data-concept-id="search-concept"]'),
  ).toBeVisible();
  await search("curriculum", "CurriculumBeacon");
  await expect(page.getByLabel("Curriculum title")).toHaveValue(
    "Boundary search topic",
  );
  await search("note", "SourceNoteBeacon");
  await expect(
    page
      .getByRole("complementary", { name: "Library resource details" })
      .getByRole("heading", {
        name: "Boundary search source note",
        exact: true,
      }),
  ).toBeVisible();
  await search("message", "MessageBeacon");
  await expect(
    page.locator('[data-message-id="search-message"]'),
  ).toBeVisible();
  await openMessageActions(page.locator('[data-message-id="search-message"]'));
  await page
    .getByRole("button", { name: "Compare this explanation", exact: true })
    .click();
  await expect(
    page.getByRole("complementary", { name: "Explanation comparison" }),
  ).toContainText("MessageBeacon");
  await expect(
    page.locator('.lesson-reader [data-message-id="search-message"]'),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Close comparison", exact: true })
    .click();
  await expect(
    page.getByRole("complementary", { name: "Explanation comparison" }),
  ).toHaveCount(0);
});
