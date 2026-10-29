import { openDestination } from "./ui-navigation";
import {
  test,
  expect,
  _electron as electron,
  chromium,
  type ElectronApplication,
  type Page,
} from "@playwright/test";
import { mkdtempSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import type { StudioData, Lesson } from "../src/types";
import type { Subject, SubjectSnapshot } from "../src/v2types";
import type { ReadingHighlight, ConnectedGraph } from "../src/annotationTypes";
let app: ElectronApplication, page: Page, directory: string;
async function launch() {
  const env = Object.fromEntries(
    Object.entries({ ...process.env, STUDIO_DATA_DIR: directory }).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.STUDIO_DEV_URL;
  app = await electron.launch({ args: ["."], cwd: process.cwd(), env });
  page = await app.firstWindow();
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setContentSize(1550, 1050),
  );
  await expect(page.locator(".titlebar-center")).toHaveText("Saved locally");
}
const call = <T = unknown>(action: string, payload?: unknown) =>
  page.evaluate(
    ({ action, payload }) => window.studio!.invoke<T>(action, payload),
    { action, payload },
  );
async function seed() {
  const subject = await call<Subject>("subject:create", {
    name: "Connected biology",
    objective: "Understand scientific mechanisms",
    depth: "comprehensive",
  });
  const lesson = await call<Lesson>("subject:conversation-create", {
    subjectId: subject.id,
    title: "A connected translation lesson",
    mode: "Learn",
  });
  const other = await call<Lesson>("subject:conversation-create", {
    subjectId: subject.id,
    title: "Translation in another chat",
    mode: "Explore",
  });
  const data = await call<StudioData>("data:load"),
    at = new Date().toISOString();
  await call("data:save", {
    ...data,
    activeSubjectId: subject.id,
    activeLessonId: lesson.id,
    lessons: data.lessons.map((item) =>
      item.id === lesson.id
        ? {
            ...item,
            messages: [
              {
                id: "annotation-source",
                role: "assistant",
                text: "A codon is a group of three RNA bases. A ribosome reads each codon. A tRNA pairs its anticodon with an mRNA codon.",
                content: [
                  {
                    type: "terms",
                    items: [
                      {
                        term: "codon",
                        definition: "A group of three RNA bases.",
                      },
                      {
                        term: "ribosome",
                        definition:
                          "The molecular machinery that reads mRNA to synthesize a protein.",
                      },
                    ],
                  },
                  {
                    type: "text",
                    text: "A codon is a group of three RNA bases.",
                  },
                  { type: "text", text: "A ribosome reads each codon." },
                  {
                    type: "text",
                    text: "A tRNA pairs its anticodon with an mRNA codon.",
                  },
                ],
                createdAt: at,
                status: "complete",
              },
            ],
          }
        : item.id === other.id
          ? {
              ...item,
              messages: [
                {
                  id: "backlink-source",
                  role: "assistant",
                  text: "A codon is read during protein synthesis.",
                  createdAt: at,
                  status: "complete",
                },
              ],
            }
          : item,
    ),
    library: [
      ...data.library,
      {
        id: "codon-note",
        kind: "note",
        title: "Codon notes",
        subject: "Connected biology",
        subjectId: subject.id,
        content: "The codon contains three bases.",
        createdAt: at,
      },
    ],
  });
  const snapshot = await call<SubjectSnapshot>("subject:get", {
    subjectId: subject.id,
  });
  await call("subject:apply", {
    subjectId: subject.id,
    baseRevision: snapshot.subject.revision,
    label: "Explicitly saved unassessed concept",
    origin: "learner",
    operations: [
      {
        entity: "concept",
        op: "put",
        id: "codon-concept",
        value: {
          label: "codon",
          status: "unassessed",
          coverage: "introduced",
          evidence: "The term occurred in two explanations. No assessment yet.",
          lessonId: lesson.id,
        },
      },
    ],
  });
  await page.reload();
  await openDestination(page, "Learning workspace: Lesson");
  await expect(
    page.locator('[data-message-id="annotation-source"]'),
  ).toBeVisible();
  return { subject, lesson, other };
}
async function selectQuote(quote: string) {
  await page.evaluate((quote) => {
    const root = document.querySelector<HTMLElement>(
      '[data-annotation-kind="message"][data-annotation-id="annotation-source"]',
    )!;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes: Text[] = [];
    let node: Node | null;
    while ((node = walker.nextNode())) {
      if (
        !node.parentElement?.closest(
          "button:not(.lesson-term),svg,canvas,.katex-mathml,.lesson-term-definition",
        )
      )
        nodes.push(node as Text);
    }
    const text = nodes.map((item) => item.data).join(""),
      start = text.indexOf(quote);
    if (start < 0) throw new Error("Visible quote was not found");
    const range = document.createRange();
    let offset = 0,
      started = false;
    for (const item of nodes) {
      const next = offset + item.length;
      if (!started && start >= offset && start < next) {
        range.setStart(item, start - offset);
        started = true;
      }
      if (started && start + quote.length <= next) {
        range.setEnd(item, start + quote.length - offset);
        break;
      }
      offset = next;
    }
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  }, quote);
  await expect(
    page.getByRole("toolbar", { name: "Selected text learning actions" }),
  ).toBeVisible();
}
test.beforeEach(async () => {
  directory = mkdtempSync(join(tmpdir(), "studio-v21-annotations-"));
  await launch();
});
test.afterEach(async () => {
  await app?.close().catch(() => {});
  const absolute = resolve(directory);
  if (
    !absolute.startsWith(resolve(tmpdir()) + sep) ||
    !absolute.includes("studio-v21-annotations-")
  )
    throw new Error("Unsafe test profile cleanup path");
  rmSync(absolute, {
    recursive: true,
    force: true,
    maxRetries: 8,
    retryDelay: 200,
  });
});
test("real selection paints two persistent colors, note search, source navigation and restart", async () => {
  test.setTimeout(120000);
  const { subject, lesson } = await seed();
  const first = "A codon is a group of three RNA bases.",
    second = "A ribosome reads each codon.";
  await selectQuote(first);
  await page
    .getByRole("button", { name: "Highlight yellow", exact: true })
    .click();
  await expect
    .poll(
      async () =>
        (
          await call<ReadingHighlight[]>("annotations:list", {
            subjectId: subject.id,
          })
        ).length,
    )
    .toBe(1);
  await selectQuote(second);
  await page
    .getByRole("button", { name: "Highlight blue", exact: true })
    .click();
  await expect
    .poll(
      async () =>
        (
          await call<ReadingHighlight[]>("annotations:list", {
            subjectId: subject.id,
          })
        ).length,
    )
    .toBe(2);
  await page
    .getByRole("button", { name: "Add annotation", exact: true })
    .click();
  await page
    .getByLabel("New highlight note")
    .fill("Read in the 5 prime to 3 prime direction");
  await page
    .getByRole("button", { name: "Save highlight & note", exact: true })
    .click();
  // Reusing an anchor updates its annotation rather than multiplying the same highlight.
  await expect
    .poll(
      async () =>
        (
          await call<ReadingHighlight[]>("annotations:list", {
            subjectId: subject.id,
          })
        ).find((item) => item.color === "blue")?.note,
    )
    .toContain("5 prime");
  const existing = await call<ReadingHighlight[]>("annotations:list", {
    subjectId: subject.id,
  });
  const blue = existing.find((item) => item.color === "blue")!;
  await page
    .getByRole("button", { name: "Make flashcard", exact: true })
    .click();
  await page
    .getByLabel("Flashcard question", { exact: true })
    .fill("What does a ribosome read during translation?");
  await page
    .getByRole("button", { name: "Save review flashcard", exact: true })
    .click();
  await expect
    .poll(
      async () =>
        (await call<StudioData>("data:load")).reviewCards?.find(
          (card) =>
            card.question === "What does a ribosome read during translation?",
        )?.answer,
    )
    .toBe(second);
  expect(
    (await call<StudioData>("data:load")).concepts.find(
      (concept) => concept.id === "codon-concept",
    )?.status,
  ).toBe("unassessed");
  await page.reload();
  await openDestination(page, "Learning workspace: Lesson");
  await expect(
    page.locator('[data-message-id="annotation-source"]'),
  ).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() => {
        const registry = (
          CSS as unknown as { highlights: Map<string, { size: number }> }
        ).highlights;
        return [
          registry.get("studio-yellow")?.size || 0,
          registry.get("studio-blue")?.size || 0,
        ];
      }),
    )
    .toEqual([1, 1]);
  await expect(
    page.locator('[data-message-id="annotation-source"] mark'),
  ).toHaveCount(0);
  mkdirSync("docs/screenshots/v2.1", { recursive: true });
  await page.screenshot({
    path: "docs/screenshots/v2.1/highlighted-reading-light.png",
    fullPage: true,
  });
  await openDestination(page, "Highlights & annotations");
  await page.getByLabel("Search subject highlights").fill("5 prime");
  await expect(page.locator(".annotation-card")).toHaveCount(1);
  await page
    .getByRole("button", { name: "Jump to source", exact: true })
    .click();
  await expect(
    page.locator('[data-message-id="annotation-source"]'),
  ).toBeVisible();
  const otherSubject = await call<Subject>("subject:create", {
    name: "Another subject",
    objective: "Independent learning",
    depth: "overview",
  });
  await call("subject:conversation-create", {
    subjectId: otherSubject.id,
    title: "Other chat",
    mode: "Explore",
  });
  await openDestination(page, "Subject workspaces: My learning");
  await page
    .locator(".subject-tile")
    .filter({ hasText: "Another subject" })
    .click();
  await app.close();
  await launch();
  const data = await call<StudioData>("data:load");
  await call("data:save", {
    ...data,
    activeSubjectId: subject.id,
    activeLessonId: lesson.id,
  });
  await page.reload();
  await openDestination(page, "Learning workspace: Lesson");
  await expect(
    page.locator('[data-message-id="annotation-source"]'),
  ).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() => {
        const registry = (
          CSS as unknown as { highlights: Map<string, { size: number }> }
        ).highlights;
        return [
          registry.get("studio-yellow")?.size || 0,
          registry.get("studio-blue")?.size || 0,
        ];
      }),
    )
    .toEqual([1, 1]);
  expect(
    (
      await call<ReadingHighlight[]>("annotations:list", {
        subjectId: subject.id,
      })
    ).find((item) => item.id === blue.id)?.note,
  ).toContain("5 prime");
  const exported = await call<{ url: string }>("export:preview", {
    scope: "selection",
    subjectId: subject.id,
    title: "Highlighted study edition",
    lessonIds: [lesson.id],
    chapterIds: [],
    includeNotes: true,
    includeUserMessages: false,
    embedCachedResources: false,
  });
  const installed = [
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  ].find((path) => existsSync(path));
  const browser = await chromium.launch({
    headless: true,
    executablePath: installed,
  });
  try {
    const context = await browser.newContext({
        offline: true,
        viewport: { width: 1440, height: 1000 },
      }),
      offline = await context.newPage();
    await offline.goto(exported.url);
    await expect(
      offline.getByRole("heading", { name: "Saved highlights", exact: true }),
    ).toBeVisible();
    await expect
      .poll(() =>
        offline.evaluate(() => {
          const registry = (
            CSS as unknown as { highlights: Map<string, { size: number }> }
          ).highlights;
          return [
            registry.get("offline-yellow")?.size || 0,
            registry.get("offline-blue")?.size || 0,
          ];
        }),
      )
      .toEqual([1, 1]);
    await expect(offline.locator(".offline-source-notes")).toContainText(
      "5 prime",
    );
    await offline.screenshot({
      path: "docs/screenshots/v2.1/highlighted-offline-edition.png",
      fullPage: true,
    });
  } finally {
    await browser.close();
  }
});
test("connected graph has cross-chat evidence backlinks, pending note suggestions and persistent pins", async () => {
  const { subject } = await seed();
  await page.getByRole("button", { name: /^Knowledge graph/ }).click();
  await expect(
    page.getByRole("heading", { name: "Knowledge connections" }),
  ).toBeVisible();
  await expect(page.locator(".react-flow__node")).toHaveCount(5);
  const graph = await call<ConnectedGraph>("graph:get", {
    subjectId: subject.id,
  });
  expect(
    graph.nodes.filter(
      (node) => node.kind === "concept" && node.label === "codon",
    ),
  ).toHaveLength(1);
  expect(graph.nodes.find((node) => node.label === "ribosome")).toMatchObject({
    derived: true,
    status: "encountered",
  });
  const codon = graph.nodes.find(
    (node) => node.kind === "concept" && node.label === "codon",
  )!;
  expect(
    graph.links.filter(
      (link) => link.kind === "explained-in" && link.source === codon.id,
    ),
  ).toHaveLength(2);
  await page
    .locator(".react-flow__node")
    .filter({ hasText: "codon" })
    .first()
    .click();
  await expect(page.getByLabel("Graph node details")).toContainText(
    "No assessment yet",
  );
  await expect(page.getByLabel("Graph node details")).toContainText(
    "Translation in another chat",
  );
  await page
    .getByRole("button", { name: "Focus neighborhood", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Open original source", exact: true })
    .click();
  await expect(
    page.locator('[data-message-id="annotation-source"]'),
  ).toBeVisible();
  await page.getByRole("button", { name: /^Knowledge graph/ }).click();
  await expect(page.locator(".connected-flow")).toBeVisible();
  const node = page
      .locator(".react-flow__node")
      .filter({ hasText: "codon" })
      .first(),
    box = await node.boundingBox();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    box!.x + box!.width / 2 + 90,
    box!.y + box!.height / 2 - 45,
    { steps: 12 },
  );
  await page.mouse.up();
  const concept = graph.nodes.find(
    (item) => item.kind === "concept" && item.label === "codon",
  )!;
  await expect
    .poll(
      async () =>
        (await call<ConnectedGraph>("graph:get", { subjectId: subject.id }))
          .positions[concept.id]?.pinned,
    )
    .toBe(true);
  const pinned = (
    await call<ConnectedGraph>("graph:get", { subjectId: subject.id })
  ).positions[concept.id];
  await app.close();
  await launch();
  await page.getByRole("button", { name: /^Knowledge graph/ }).click();
  expect(
    (await call<ConnectedGraph>("graph:get", { subjectId: subject.id }))
      .positions[concept.id],
  ).toEqual(pinned);
  mkdirSync("docs/screenshots/v2.1", { recursive: true });
  await page.screenshot({
    path: "docs/screenshots/v2.1/connected-graph-light.png",
    fullPage: true,
  });
  await page
    .locator(".sidebar-bottom")
    .getByRole("button", { name: "Settings", exact: true })
    .click();
  await page
    .locator(".appearance-modes")
    .getByRole("button", { name: "Dark", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Close settings", exact: true })
    .click();
  await page.getByRole("button", { name: /^Knowledge graph/ }).click();
  await expect(page.locator(".connected-flow")).toBeVisible();
  await page.screenshot({
    path: "docs/screenshots/v2.1/connected-graph-dark.png",
    fullPage: true,
  });
});
