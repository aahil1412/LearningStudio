import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page,
} from "@playwright/test";
import { mkdtemp, rm, mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { build } from "esbuild";
import type { Lesson, StudioData } from "../src/types";
import type { Subject } from "../src/v2types";
import type { PathwayJob } from "../src/v21types";
import {
  openConversation,
  openTutor,
  openDestination,
  openConversationRecord,
} from "./ui-navigation";

// Real Electron/React/IPC/SQLite/request services, with a deliberately controlled
// provider adapter. This suite is not evidence of live subscription responses.
let app: ElectronApplication, page: Page, directory: string;
const peers: ElectronApplication[] = [],
  peerDirectories: string[] = [];
function environment(path = directory) {
  const env: Record<string, string> = Object.fromEntries(
    Object.entries({ ...process.env, STUDIO_DATA_DIR: path }).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.STUDIO_DEV_URL;
  return env;
}
async function launch(path = directory) {
  const instance = await electron.launch({
    args: ["."],
    cwd: process.cwd(),
    env: environment(path),
  });
  const window = await instance.firstWindow();
  await expect(window.locator(".titlebar-center")).toHaveText("Saved locally");
  await instance.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setContentSize(1530, 1080),
  );
  return { instance, window };
}
async function call<T = unknown>(action: string, payload?: unknown) {
  return page.evaluate(
    ({ action, payload }) => window.studio!.invoke<T>(action, payload),
    { action, payload },
  );
}
async function seed() {
  const subject = await call<Subject>("subject:create", {
    name: "Explicit request-service acceptance fixture",
    objective:
      "Verify independent model requests without using learner history",
    depth: "overview",
  });
  const a = await call<Lesson>("subject:conversation-create", {
    subjectId: subject.id,
    title: "Chat A: quantum theory",
    objective: "Quantum theory",
    mode: "Learn",
  });
  const b = await call<Lesson>("subject:conversation-create", {
    subjectId: subject.id,
    title: "Chat B: biology",
    objective: "Biology",
    mode: "Learn",
  });
  const data = await call<StudioData>("data:load");
  await call("data:save", {
    ...data,
    activeSubjectId: subject.id,
    activeLessonId: a.id,
    settings: {
      ...data.settings,
      personalization: false,
      models: {
        tutor: { model: "request-fixture", reasoning: "medium" },
        visual: { model: "request-fixture", reasoning: "medium" },
        review: { model: "request-fixture", reasoning: "medium" },
      },
    },
  });
  await call("learning:intake-put", {
    subjectId: subject.id,
    status: "skipped",
    goal: subject.objective,
    depth: "overview",
    assessment: "skipped",
  });
  return { subject, a, b };
}
async function provider(timeoutMs = 60000, automaticRecovery = false) {
  const fixture = join(directory, "request-services.cjs");
  await build({
    entryPoints: ["tests/v21-request-service-fixture.ts"],
    bundle: true,
    outfile: fixture,
    platform: "node",
    format: "cjs",
    external: ["electron", "better-sqlite3"],
    logLevel: "silent",
  });
  await app.evaluate(
    (
      { ipcMain, BrowserWindow },
      { fixture, database, timeoutMs, automaticRecovery },
    ) => {
      const production = process
        .getBuiltinModule("node:module")
        .createRequire(process.cwd() + "/package.json")(fixture);
      const store = new production.StudioStore(database),
        subjects = new production.SubjectStore(store);
      const window = BrowserWindow.getAllWindows()[0];
      const state: any = {
        tutors: new Map(),
        started: [],
        module: null,
        attempts: 0,
      };
      const complete = (text: string) =>
        JSON.stringify({ content: [{ type: "text", text }] });
      const service = new production.ModelRequestService({
        timeoutMs,
        onDelta: (event: any) =>
          window.webContents.send("studio:stream", event),
        respond: async (request: any, onDelta: (text: string) => void) => {
          if (request.instructions.includes("pathway outline"))
            return JSON.stringify({
              modules: [
                {
                  id: "module",
                  title: "Controlled fixture module",
                  description: "Provider fixture, not live curriculum",
                  priorities: [],
                  prerequisites: [],
                },
              ],
            });
          if (
            /Construct ONE (?:compact )?curriculum module/.test(
              request.instructions,
            )
          )
            return new Promise<string>((resolve) => {
              state.module = { request, resolve };
            });
          const question = request.input.at(-1).content;
          state.started.push(question);
          onDelta(
            "Partial explanation from the explicit controlled provider fixture.",
          );
          if (automaticRecovery) {
            state.attempts++;
            if (state.attempts === 1) return new Promise<string>(() => {});
            if (state.attempts === 2)
              throw new DOMException("The operation was aborted", "AbortError");
            return complete(
              "Recovered explanation from the controlled provider fixture.",
            );
          }
          return new Promise<string>((resolve) =>
            state.tutors.set(question, (text: string) =>
              resolve(complete(text)),
            ),
          );
        },
      });
      const planning = new production.PlanningService(store, subjects, {
        models: async () => [
          {
            id: "request-fixture",
            name: "Explicit controlled provider",
            reasoningLevels: ["medium"],
          },
        ],
        request: (request: any, signal: AbortSignal) =>
          service.background(request, signal),
        changed: () => window.webContents.send("studio:data-changed"),
      });
      const original = (ipcMain as any)._invokeHandlers.get("studio:invoke");
      ipcMain.removeHandler("studio:invoke");
      ipcMain.handle("studio:invoke", async (event, action, payload) => {
        if (action === "auth:status")
          return {
            connected: true,
            account: "Controlled provider fixture; no live billing",
          };
        if (action === "auth:models")
          return [
            {
              id: "request-fixture",
              name: "Explicit controlled provider",
              reasoningLevels: ["medium"],
            },
          ];
        if (
          action.startsWith("planning:") ||
          action.startsWith("learning:intake-")
        )
          return planning.handle(action, payload);
        if (action === "model:send") return service.send(payload);
        if (action === "model:cancel") {
          service.cancel(payload.requestId);
          return true;
        }
        if (action === "app:diagnostics")
          return {
            ...(await original(event, action, payload)),
            activeRequests: service.foregroundCount,
            modelConcurrency: service.counts,
          };
        return original(event, action, payload);
      });
      (globalThis as any).requestServiceFixture = {
        state,
        service,
        planning,
        store,
      };
    },
    {
      fixture,
      database: join(directory, "learning-studio.sqlite"),
      timeoutMs,
      automaticRecovery,
    },
  );
  await page.reload();
  await openDestination(page, "Learning workspace: Lesson");
  await expect(page.locator(".account-pill")).toContainText(
    "ChatGPT connected",
  );
}
async function open(title: string) {
  await openConversation(page, title);
  await openTutor(page);
  await expect(page.locator(".lesson-top")).toContainText(title);
}
async function send(question: string) {
  await openTutor(page);
  await page.getByLabel("Message the tutor").fill(question);
  await page.getByRole("button", { name: "Send message", exact: true }).click();
}
async function finish(question: string, text: string) {
  await app.evaluate(
    (_, { question, text }) =>
      (globalThis as any).requestServiceFixture.state.tutors.get(question)(
        text,
      ),
    { question, text },
  );
}
test.beforeEach(async () => {
  directory = await mkdtemp(join(process.cwd(), ".provider-test-requests-"));
  const instance = await launch();
  app = instance.instance;
  page = instance.window;
});
test.afterEach(async () => {
  await app
    ?.evaluate(() => {
      const fixture = (globalThis as any).requestServiceFixture;
      fixture?.service.cancelAll("Controlled fixture closing");
      fixture?.planning.dispose();
      fixture?.store.close();
    })
    .catch(() => {});
  await app?.close().catch(() => {});
  for (const peer of peers.splice(0)) await peer.close().catch(() => {});
  for (const path of [directory, ...peerDirectories.splice(0)])
    await rm(path, {
      recursive: true,
      force: true,
      maxRetries: 8,
      retryDelay: 200,
    });
});

test("planning and unrelated chats remain independent across navigation, scoped cancellation, and append-only retry", async () => {
  const { subject, a, b } = await seed();
  await provider();
  const job = await call<PathwayJob>("planning:start", {
    subjectId: subject.id,
    model: "request-fixture",
    reasoning: "medium",
  });
  await expect
    .poll(() =>
      app.evaluate(() =>
        Boolean((globalThis as any).requestServiceFixture.state.module),
      ),
    )
    .toBe(true);
  await send("Explain quantum theory from the beginning.");
  await expect(page.locator(".lesson-message.assistant")).toContainText(
    "Partial explanation",
  );
  await openTutor(page);
  await page
    .getByLabel("Message the tutor")
    .fill("Unsent draft for quantum theory");
  await open(b.title);
  await expect(page.getByLabel("Message the tutor")).toHaveValue("");
  await openTutor(page);
  await page.getByLabel("Message the tutor").fill("Unsent draft for biology");
  await open(a.title);
  await expect(page.getByLabel("Message the tutor")).toHaveValue(
    "Unsent draft for quantum theory",
  );
  await open(b.title);
  await expect(page.getByLabel("Message the tutor")).toHaveValue(
    "Unsent draft for biology",
  );
  await send("How do cells control exchange?");
  await expect
    .poll(async () => (await call<any>("app:diagnostics")).modelConcurrency)
    .toEqual({ active: 2, background: 1, queued: 1 });
  await open(a.title);
  await page
    .locator(".studio-lesson-header")
    .getByRole("button", { name: "Cancel response", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText(
    "This response was canceled",
  );
  await open(b.title);
  await expect(page.locator(".lesson-message.assistant")).toContainText(
    "Partial explanation",
  );
  expect(
    (await call<PathwayJob>("planning:get", { jobId: job.id })).status,
  ).toBe("running");
  await finish(
    "How do cells control exchange?",
    "Biology reply completed while planning remains active.",
  );
  await expect(page.locator(".lesson-message.assistant")).toContainText(
    "Biology reply completed",
  );
  await openTutor(page);
  await expect(
    page.getByRole("button", { name: "Send message", exact: true }),
  ).toBeVisible();
  await open(a.title);
  await openConversationRecord(page);
  const oldPartial = page.locator(".lesson-message.assistant").first();
  await page.getByRole("button", { name: "Retry safely", exact: true }).click();
  await openConversationRecord(page);
  await expect(oldPartial.locator(".message-label")).toContainText(
    "Partial response saved",
  );
  await expect(oldPartial.locator(".message-label")).not.toContainText(
    "Writing",
  );
  await expect(page.locator(".lesson-message.assistant").last()).toContainText(
    "Partial explanation",
  );
  await mkdir(resolve("docs/screenshots"), { recursive: true });
  await page.screenshot({
    path: "docs/screenshots/2.1-independent-requests-fixture.png",
  });
  await finish(
    "Explain quantum theory from the beginning.",
    "Quantum reply recovered independently of the biology chat.",
  );
  await expect(page.locator(".lesson-message.assistant").last()).toContainText(
    "Quantum reply recovered",
  );
  await app.evaluate(() => {
    const pending = (globalThis as any).requestServiceFixture.state.module;
    const id = JSON.parse(pending.request.input[0].content).module.id;
    pending.resolve(
      JSON.stringify({
        nodes: Array.from({ length: 6 }, (_, index) => ({
          id: "concept-" + index,
          parentId: id,
          kind: "concept",
          title: "Fixture concept " + index,
          description: "Explicit test content",
          prerequisites: [],
        })),
      }),
    );
  });
  await expect
    .poll(
      async () =>
        (await call<PathwayJob>("planning:get", { jobId: job.id })).status,
    )
    .toBe("awaiting-review");
  const data = await call<StudioData>("data:load");
  expect(
    data.lessons.find((lesson) => lesson.id === a.id)?.messages,
  ).toHaveLength(4);
  expect(
    data.lessons.find((lesson) => lesson.id === b.id)?.messages,
  ).toHaveLength(2);
  expect((await call<any>("app:diagnostics")).activeRequests).toBe(0);
});

test("deadline and transport interruption preserve partial work, explicit retries recover, and restart never shows stale writing", async () => {
  const { a } = await seed();
  await provider(250, true);
  await send("Explain quantum theory from the beginning.");
  await expect(page.getByRole("alert")).toContainText(
    "did not complete within five minutes",
  );
  await expect(page.locator(".lesson-message.assistant").first()).toContainText(
    "Partial explanation",
  );
  await page
    .getByRole("button", { name: "Retry safely", exact: true })
    .first()
    .click();
  await expect(page.getByRole("alert").last()).toContainText(
    "connection was interrupted",
  );
  await expect(
    page.getByRole("button", { name: "Cancel response", exact: true }),
  ).not.toBeVisible();
  await page
    .getByRole("button", { name: "Retry safely", exact: true })
    .last()
    .click();
  await expect(page.locator(".lesson-message.assistant").last()).toContainText(
    "Recovered explanation",
  );
  await expect
    .poll(
      async () =>
        (await call<StudioData>("data:load")).lessons.find(
          (lesson) => lesson.id === a.id,
        )?.messages.length,
    )
    .toBe(6);
  await app.close();
  const reopened = await launch();
  app = reopened.instance;
  page = reopened.window;
  await openConversationRecord(page);
  await expect(page.locator(".lesson-message.assistant").last()).toContainText(
    "Recovered explanation",
  );
  await expect(page.locator(".lesson-message.assistant").first()).toContainText(
    "Partial explanation",
  );
  await expect(
    page.locator(".message-label").filter({ hasText: "Writing" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Cancel response", exact: true }),
  ).not.toBeVisible();
});

test("same-profile relaunch focuses the existing process while isolated profiles remain independent", async () => {
  expect(await app.evaluate(({ app }) => app.hasSingleInstanceLock())).toBe(
    true,
  );
  const child = spawn(
    resolve("node_modules/electron/dist/electron.exe"),
    ["."],
    {
      cwd: process.cwd(),
      env: environment(),
      windowsHide: true,
      stdio: "ignore",
    },
  );
  const code = await new Promise<number | null>((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("Second same-profile process did not exit"));
    }, 10000);
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("exit", (code) => {
      clearTimeout(timer);
      resolve(code);
    });
  });
  expect(code).toBe(0);
  expect(await app.evaluate(({ app }) => app.hasSingleInstanceLock())).toBe(
    true,
  );
  await expect(page.locator(".brand")).toContainText("Learning Studio");
  const otherPath = await mkdtemp(
    join(process.cwd(), ".provider-test-requests-peer-"),
  );
  peerDirectories.push(otherPath);
  const peer = await launch(otherPath);
  peers.push(peer.instance);
  expect(
    await peer.instance.evaluate(({ app }) => app.hasSingleInstanceLock()),
  ).toBe(true);
  expect(
    await peer.window.evaluate(() => window.studio!.invoke("data:load")),
  ).toBeTruthy();
  expect(await call("data:load")).toBeTruthy();
});
