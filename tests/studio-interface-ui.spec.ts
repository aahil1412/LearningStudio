import {
  openTutor,
  openDestination,
  openMessageActions,
} from "./ui-navigation";
import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page,
} from "@playwright/test";
import { createServer, type Server, type ServerResponse } from "node:http";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { resolve, join } from "node:path";
import { sanitizeAppearance } from "../src/lib/themes";
import type { Lesson, StudioData, ContentBlock } from "../src/types";
let app: ElectronApplication,
  page: Page,
  directory: string,
  server: Server | undefined;
async function call<T = unknown>(action: string, payload?: unknown) {
  return page.evaluate(
    ({ action, payload }) => window.studio!.invoke<T>(action, payload),
    { action, payload },
  );
}
test.beforeEach(async () => {
  await mkdir(".tools", { recursive: true });
  directory = await mkdtemp(join(resolve(".tools"), "studio-interface-"));
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
  await app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    window.setContentSize(1480, 1080);
    window.webContents.setBackgroundThrottling(false);
  });
  await expect(page.locator(".titlebar-center")).toHaveText("Saved locally");
});
test.afterEach(async () => {
  await app?.close().catch(() => {});
  await new Promise<void>((done) =>
    server ? server.close(() => done()) : done(),
  );
  server = undefined;
  if (
    !resolve(directory).startsWith(join(resolve(".tools"), "studio-interface-"))
  )
    throw new Error("Unsafe fixture cleanup");
  await rm(directory, { recursive: true, force: true });
});
async function seed(content: ContentBlock[] = []) {
  const subject = await call<{ id: string }>("subject:create", {
    name: "Learning interface acceptance",
    objective: "Understand concepts through useful figures",
    depth: "overview",
  });
  const lesson = await call<Lesson>("subject:conversation-create", {
    subjectId: subject.id,
    title: "Concepts, figures and definitions",
    mode: "Learn",
  });
  const data = await call<StudioData>("data:load");
  await call("data:save", {
    ...data,
    activeSubjectId: subject.id,
    activeLessonId: lesson.id,
    lessons: data.lessons.map((item) =>
      item.id === lesson.id
        ? {
            ...item,
            messages: content.length
              ? [
                  {
                    id: "reading-fixture",
                    role: "assistant",
                    text: "",
                    content,
                    createdAt: new Date().toISOString(),
                    status: "complete",
                  },
                ]
              : [],
          }
        : item,
    ),
  });
  await page.reload();
  await openDestination(page, "Learning workspace: Lesson");
  await expect(page.locator(".lesson-top h1")).toHaveText(lesson.title);
  await expect(page.locator(".subject-chat-banner")).toContainText(
    "Learning interface acceptance",
  );
  return subject;
}
test("definitions open next to the selected term without jumping to the end; typography stays inherited in light/dark/custom", async () => {
  const subject = await seed([
    {
      type: "terms",
      items: [
        {
          term: "quantum mechanics",
          definition:
            "A framework describing quantum states and their measurable probabilities.",
        },
      ],
    },
    {
      type: "text",
      text:
        "The central idea combines **quantum mechanics** with a consistent account of interactions.\n\n" +
        Array.from(
          { length: 24 },
          (_, i) =>
            "Study note " +
            i +
            ": a long reading passage keeps the end of this lesson far below the term.",
        ).join("\n\n"),
    },
  ]);
  const term = page.getByRole("button", {
    name: "Define quantum mechanics",
    exact: true,
  });
  await term.scrollIntoViewIfNeeded();
  const before = await page
    .locator(".lesson-reader")
    .evaluate((el) => el.scrollTop);
  const anchor = await term.boundingBox();
  await term.click();
  const popup = page.getByRole("dialog", {
    name: "Definition of quantum mechanics",
    exact: true,
  });
  await expect(popup).toContainText("measurable probabilities");
  const bounds = await popup.boundingBox();
  expect(
    Math.min(
      Math.abs(bounds!.y - anchor!.y),
      Math.abs(bounds!.y + bounds!.height - anchor!.y),
    ),
  ).toBeLessThan(100);
  expect(
    await page.locator(".lesson-reader").evaluate((el) => el.scrollTop),
  ).toBeCloseTo(before, 0);
  expect(
    await term.evaluate(
      (el) =>
        getComputedStyle(el).fontWeight ===
        getComputedStyle(el.parentElement!).fontWeight,
    ),
  ).toBe(true);
  await page.keyboard.press("Escape");
  await expect(popup).toHaveCount(0);
  await expect(term).toBeFocused();
  await mkdir("docs/screenshots/v2.2", { recursive: true });
  for (const mode of ["light", "dark", "custom"] as const) {
    const data = await call<StudioData>("data:load");
    const appearance = sanitizeAppearance(data.appearance);
    appearance.mode = mode === "dark" ? "dark" : "light";
    if (mode === "custom")
      appearance.light.colors = {
        ...appearance.light.colors,
        bg: "#ede6dc",
        reading: "#ede6dc",
        sidebar: "#e4d9cb",
        text: "#302d29",
        heading: "#302d29",
        bold: "#594535",
      };
    await call("data:save", { ...data, appearance });
    await page.reload();
    await openDestination(page, "Learning workspace: Lesson");
    await page
      .getByRole("button", { name: "Define quantum mechanics", exact: true })
      .scrollIntoViewIfNeeded();
    await page
      .getByRole("button", { name: "Define quantum mechanics", exact: true })
      .click();
    await page.screenshot({
      path: "docs/screenshots/v2.2/anchored-definition-" + mode + ".png",
    });
    await page.keyboard.press("Escape");
  }
  await expect(
    page.getByText("Understanding takes shape, one connection at a time."),
  ).toHaveCount(0);
  await openMessageActions(page.locator(".lesson-message.assistant").first());
  await page
    .getByRole("button", {
      name: "Save finding to shared subject memory",
      exact: true,
    })
    .click();
  await expect
    .poll(async () => {
      const snapshot = await call<{ memory: { content: string }[] }>(
        "subject:get",
        { subjectId: subject.id },
      );
      return snapshot.memory.some((item) =>
        item.content.includes("The central idea combines"),
      );
    })
    .toBe(true);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(page.locator(".settings-studio")).toBeVisible();
  for (const width of [1480, 1100, 900]) {
    await app.evaluate(
      ({ BrowserWindow }, size) =>
        BrowserWindow.getAllWindows()[0].setContentSize(size, 1080),
      width,
    );
    await expect(page.locator(".settings-page-header")).toContainText(
      "Appearance",
    );
    const bounds = await page.locator(".settings-studio").boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width + 1);
    await page.screenshot({
      path: `docs/screenshots/v2.2/preferences-workspace-${width}.png`,
    });
  }
});
test("the real provider pipeline shows quiet thinking without a stopwatch and upgrades an ordinary aggregation explanation automatically", async () => {
  await seed();
  let pending: ServerResponse | undefined;
  let instructions = "";
  server = createServer(async (req, res) => {
    if (req.url === "/api/tags") {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ models: [{ name: "controlled-fixture" }] }));
      return;
    }
    let body = "";
    for await (const chunk of req) body += chunk;
    instructions = JSON.parse(body).messages[0].content;
    pending = res;
    res.setHeader("Content-Type", "application/x-ndjson");
    res.flushHeaders();
  });
  await new Promise<void>((done) => server!.listen(0, "127.0.0.1", done));
  const baseUrl =
    "http://127.0.0.1:" + (server.address() as { port: number }).port;
  const listing = await call<{ profiles: { id: string; label: string }[] }>(
    "providers:save",
    { label: "Explicit acceptance fixture", kind: "ollama", baseUrl },
  );
  const provider = listing.profiles.find(
    (p) => p.label === "Explicit acceptance fixture",
  )!;
  await call("providers:select", { id: provider.id });
  await page.reload();
  await openDestination(page, "Learning workspace: Lesson");
  await expect(page.locator(".account-pill")).toContainText(
    "Explicit acceptance fixture",
  );
  await openTutor(page);
  await page
    .getByLabel("Message the tutor")
    .fill("How does protein aggregation work?");
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await expect.poll(() => Boolean(pending)).toBe(true);
  const message = page.locator(".lesson-message.assistant").last();
  await expect(message.getByLabel("Tutor is thinking")).toBeVisible();
  await expect(message).not.toContainText(
    /\b\d+:\d{2}\b|Waiting for the model|elapsed/,
  );
  expect(instructions).toContain("RUNTIME_AUTHORING_SKILL");
  // A rejected or cosmetic edit must not abort an admitted tutor request.
  await expect(
    call("providers:save", {
      id: provider.id,
      label: "Explicit acceptance fixture",
      kind: "ollama",
      baseUrl: "https://example.invalid",
    }),
  ).rejects.toThrow(/consent|loopback/i);
  await call("providers:save", {
    id: provider.id,
    label: "Explicit acceptance fixture",
    kind: "ollama",
    baseUrl,
  });
  await expect(message.getByLabel("Tutor is thinking")).toBeVisible();
  expect(pending!.destroyed).toBe(false);
  const content = {
    content: [
      {
        type: "text",
        text: "Proteins can expose sticky regions when their compact structure changes. This is a controlled acceptance response, not live inference.",
      },
      {
        type: "illustration",
        spec: {
          template: "scene",
          title: "One way proteins aggregate",
          scene: {
            participants: [
              { id: "p", label: "Folded protein", shape: "protein" },
              { id: "u", label: "Partly unfolded protein", shape: "protein" },
              { id: "a", label: "Aggregate", shape: "complex" },
            ],
            relations: [],
          },
        },
      },
    ],
  };
  pending!.end(
    JSON.stringify({
      message: { content: JSON.stringify(content) },
      done: true,
      done_reason: "stop",
    }) + "\n",
  );
  await expect(message.locator(".aggregation-explorer")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Cancel response", exact: true }),
  ).toHaveCount(0);
  await expect(message.locator(".scientific-scene")).toHaveCount(0);
  await message.locator(".aggregation-explorer").scrollIntoViewIfNeeded();
  await page.screenshot({
    path: "docs/screenshots/v2.2/automatic-inline-aggregation.png",
  });
});
