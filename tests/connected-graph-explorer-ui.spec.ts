import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page,
} from "@playwright/test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { StudioData, Lesson } from "../src/types";
import type { Subject } from "../src/v2types";
import type { ConnectedGraph } from "../src/annotationTypes";
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
  await app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    window.webContents.setBackgroundThrottling(false);
    window.setContentSize(1590, 1100);
    // Real pointer dragging needs the active Windows renderer; a hidden
    // compositor can pass DOM hit tests without delivering the drag sequence.
    window.show();
    window.focus();
  });
  await page.bringToFront();
  await expect(page.locator(".titlebar-center")).toHaveText("Saved locally");
}
const call = <T = unknown>(action: string, payload?: unknown) =>
  page.evaluate(
    ({ action, payload }) => window.studio!.invoke<T>(action, payload),
    { action, payload },
  );
async function expectGraphFitted(count: number) {
  await expect(page.locator(".connected-status")).not.toContainText(
    "Updating map",
  );
  await expect
    .poll(
      async () =>
        page.evaluate(() => {
          const container = document
              .querySelector(".connected-flow")!
              .getBoundingClientRect(),
            nodes = [
              ...document.querySelectorAll(".connected-flow .react-flow__node"),
            ];
          return {
            count: nodes.length,
            inside: nodes.filter((node) => {
              const box = node.getBoundingClientRect();
              return (
                box.left >= container.left + 8 &&
                box.top >= container.top + 8 &&
                box.right <= container.right - 8 &&
                box.bottom <= container.bottom - 8
              );
            }).length,
          };
        }),
      { timeout: 15000 },
    )
    .toEqual({ count, inside: count });
  // A focus transition must finish before a real pointer drag. Grabbing the
  // moving node can instead start a pane pan or miss the target entirely.
  let previous = "",
    stable = 0;
  await expect
    .poll(
      async () => {
        const transform = await page
          .locator(".connected-flow .react-flow__viewport")
          .getAttribute("style");
        stable = transform === previous ? stable + 1 : 0;
        previous = transform || "";
        return stable;
      },
      { intervals: [75], timeout: 5000 },
    )
    .toBeGreaterThanOrEqual(3);
}
test.beforeEach(async () => {
  await mkdir(".tools", { recursive: true });
  directory = await mkdtemp(join(resolve(".tools"), "graph-explorer-"));
  await launch();
});
test.afterEach(async () => {
  await app?.close().catch(() => {});
  if (
    !resolve(directory).startsWith(join(resolve(".tools"), "graph-explorer-"))
  )
    throw new Error("Unexpected graph fixture cleanup path");
  await rm(directory, {
    recursive: true,
    force: true,
    maxRetries: 8,
    retryDelay: 200,
  });
});
test("large native knowledge map stays bounded, filters multiple keywords, connects source concepts, follows backlinks and preserves pins", async () => {
  test.setTimeout(120000);
  const subject = await call<Subject>("subject:create", {
    name: "Graph acceptance: molecular systems",
    objective:
      "Inspect source-backed connections in an explicitly synthetic large library",
    depth: "overview",
  });
  const lesson = await call<Lesson>("subject:conversation-create", {
    subjectId: subject.id,
    title: "Codon recognition explained",
    mode: "Learn",
  });
  const second = await call<Lesson>("subject:conversation-create", {
    subjectId: subject.id,
    title: "A second independent source",
    mode: "Explore",
  });
  const data = await call<StudioData>("data:load"),
    now = new Date().toISOString();
  data.activeSubjectId = subject.id;
  data.activeLessonId = lesson.id;
  data.concepts = Array.from({ length: 1200 }, (_, i) => ({
    id: "graph-synthetic-" + i,
    subjectId: subject.id,
    label:
      i === 0
        ? "Codon recognition"
        : i === 1
          ? "Ribosome"
          : i === 2
            ? "Protein folding"
            : "Molecular mechanism " + i,
    status: "unassessed",
    evidence:
      "Synthetic acceptance fixture. No assessment or demonstrated understanding.",
    lessonId: lesson.id,
    updatedAt: now,
  }));
  for (const item of data.lessons.filter((item) =>
    [lesson.id, second.id].includes(item.id),
  ))
    item.messages = [
      {
        id: "graph-source-" + item.id,
        role: "assistant",
        text: "Codon recognition positions a complementary tRNA in a ribosome. The ribosome reads mRNA to assemble a chain of amino acids.",
        createdAt: now,
        status: "complete",
      },
    ];
  data.library.push({
    id: "graph-note",
    kind: "note",
    subjectId: subject.id,
    subject: subject.name,
    title: "Codon study note",
    content:
      "Codon recognition and a ribosome are connected by the decoding process.",
    createdAt: now,
  });
  await call("data:save", data);
  await page.reload();
  await page.getByRole("button", { name: /^Knowledge graph/ }).click();
  await expect(
    page.getByRole("heading", { name: "Knowledge connections" }),
  ).toBeVisible();
  await expect(page.locator(".connected-status")).toContainText("120 shown");
  await expectGraphFitted(120);
  await expect
    .poll(async () =>
      page
        .locator(".connected-keywords button")
        .evaluateAll((buttons) =>
          buttons.some((button) =>
            /^\s*\d+\s*$/.test(button.childNodes[0]?.textContent || ""),
          ),
        ),
    )
    .toBe(false);
  const graph = await call<ConnectedGraph>("graph:get", {
    subjectId: subject.id,
    limit: 120,
  });
  expect(graph.availableNodes).toBeGreaterThanOrEqual(1203);
  expect(graph.nodes.length).toBe(120);
  expect(
    graph.links.some(
      (link) =>
        link.kind === "co-mentioned" && link.sourceReferences?.length === 2,
    ),
  ).toBe(true);
  const performance = {
    available: graph.availableNodes,
    shown: graph.nodes.length,
    domNodes: await page.locator(".react-flow__node").count(),
  };
  expect(performance.domNodes).toBeLessThanOrEqual(120);
  await mkdir("docs/screenshots/v22", { recursive: true });
  await page.screenshot({
    path: "docs/screenshots/v22/connected-graph-large-light.png",
  });
  await page.getByLabel("Add graph keyword").fill("codon");
  await page
    .locator(".connected-keyword-form")
    .getByRole("button", { name: "Add", exact: true })
    .click();
  await page.getByLabel("Add graph keyword").fill("ribosome");
  await page
    .locator(".connected-keyword-form")
    .getByRole("button", { name: "Add", exact: true })
    .click();
  await page.getByLabel("Match selected keywords").selectOption("all");
  await expect(page.locator(".connected-active-filters")).toContainText(
    "codon",
  );
  await expect(page.locator(".connected-active-filters")).toContainText(
    "ribosome",
  );
  await expect
    .poll(() => page.locator(".connected-node-list>button").count())
    .toBeLessThan(10);
  await page.getByLabel("Sort graph items").selectOption("alphabetical");
  await page
    .locator(".connected-node-list>button")
    .filter({ has: page.getByText("Codon recognition", { exact: true }) })
    .click();
  const details = page.getByLabel("Graph node details");
  await expect(details).toContainText(
    "No assessment or demonstrated understanding",
  );
  await expect(details).toContainText("A second independent source");
  await expect(details).toContainText("co mentioned");
  await page.screenshot({
    path: "docs/screenshots/v22/connected-graph-keywords-and-backlinks.png",
  });
  const sourceButtons = details.getByRole("button", {
    name: "Open source passage",
    exact: true,
  });
  await expect(sourceButtons.first()).toBeVisible();
  await sourceButtons.first().click();
  await expect(page.locator(".lesson-message.assistant")).toContainText(
    "Codon recognition positions",
  );
  await page.getByRole("button", { name: /^Knowledge graph/ }).click();
  await page.getByLabel("Search connected graph").fill("Codon recognition");
  await page
    .locator(".connected-node-list>button")
    .filter({ has: page.getByText("Codon recognition", { exact: true }) })
    .click();
  await page
    .getByRole("button", { name: "Focus neighborhood", exact: true })
    .click();
  await expect(page.locator(".connected-active-filters")).toContainText(
    "Focused neighborhood",
  );
  await expect(page.locator(".connected-node-list>button")).toHaveCount(5);
  await expectGraphFitted(5);

  const node = page
    .locator(".react-flow__node")
    .filter({ has: page.getByText("Codon recognition", { exact: true }) })
    .first();
  const dot = node.locator(".connected-dot"),
    originalPosition = await node.getAttribute("style");
  await dot.hover();
  await expectGraphFitted(5);
  const box = await dot.boundingBox();
  expect(box).not.toBeNull();
  const center = { x: box!.x + box!.width / 2, y: box!.y + box!.height / 2 };
  expect(
    await dot.evaluate(
      (element, point) =>
        element.closest(".react-flow__node") ===
        document
          .elementFromPoint(point.x, point.y)
          ?.closest(".react-flow__node"),
      center,
    ),
  ).toBe(true);
  await page.mouse.move(center.x, center.y);
  await page.mouse.down();
  await page.mouse.move(center.x + 65, center.y + 45, { steps: 12 });
  await page.mouse.up();
  const canonical = graph.nodes.find(
    (node) => node.label === "Codon recognition",
  )!;
  await expect
    .poll(
      async () =>
        (await call<ConnectedGraph>("graph:get", { subjectId: subject.id }))
          .positions[canonical.id]?.pinned,
    )
    .toBe(true);
  await expect(node).not.toHaveAttribute("style", originalPosition || "");
  await expect(
    page.getByRole("button", { name: "Unpin position", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Unpin position", exact: true })
    .click();
  await expect
    .poll(
      async () =>
        (await call<ConnectedGraph>("graph:get", { subjectId: subject.id }))
          .positions[canonical.id]?.pinned,
    )
    .toBe(false);
  await page.getByRole("button", { name: "Pin position", exact: true }).click();
  await expect
    .poll(
      async () =>
        (await call<ConnectedGraph>("graph:get", { subjectId: subject.id }))
          .positions[canonical.id]?.pinned,
    )
    .toBe(true);
  const pinned = (
    await call<ConnectedGraph>("graph:get", { subjectId: subject.id })
  ).positions[canonical.id];
  await app.close();
  await launch();
  await page.getByRole("button", { name: /^Knowledge graph/ }).click();
  expect(
    (await call<ConnectedGraph>("graph:get", { subjectId: subject.id }))
      .positions[canonical.id],
  ).toEqual(pinned);
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
  await page.getByLabel("Search connected graph").fill("codon");
  await expect(page.locator(".connected-node-list")).toContainText(
    "Codon recognition",
  );
  await page.screenshot({
    path: "docs/screenshots/v22/connected-graph-dark.png",
  });
  const stored = await call<StudioData>("data:load");
  expect(
    stored.concepts
      .filter((concept) => concept.subjectId === subject.id)
      .every((concept) => concept.status === "unassessed"),
  ).toBe(true);
  await writeFile(
    "docs/graph-v22-native-result.json",
    JSON.stringify(
      {
        profile:
          "Isolated synthetic1200-concept fixture, actual Windows Electron renderer/IPC/SQLite",
        ...performance,
        multiKeywordFiltering: true,
        sourceBacklinks: true,
        automaticProvenanceAssociations: true,
        fullViewportFit: true,
        meaningfulKeywordFacets: true,
        pinRestart: true,
        darkTheme: true,
        knowledgeStatusUnchanged: true,
      },
      null,
      2,
    ),
  );
});

test("definition-only saved chats create a connected encountered map with no setup or mastery claim, and explicit tracking keeps the node identity", async () => {
  const subject = await call<Subject>("subject:create", {
    name: "Definition-only graph acceptance",
    objective:
      "Inspect automatic graph construction from ordinary typed teaching output",
    depth: "overview",
  });
  const a = await call<Lesson>("subject:conversation-create", {
      subjectId: subject.id,
      title: "Decoding explained",
      mode: "Learn",
    }),
    b = await call<Lesson>("subject:conversation-create", {
      subjectId: subject.id,
      title: "Return to decoding",
      mode: "Explore",
    });
  const data = await call<StudioData>("data:load"),
    now = new Date().toISOString();
  data.activeSubjectId = subject.id;
  data.activeLessonId = a.id;
  for (const lesson of data.lessons.filter((lesson) =>
    [a.id, b.id].includes(lesson.id),
  ))
    lesson.messages = [
      {
        id: "definition-" + lesson.id,
        role: "assistant",
        text: "A codon is read by a ribosome.",
        content: [
          {
            type: "terms",
            items: [
              {
                term: "codon",
                definition: "A group of three messenger RNA bases.",
              },
              {
                term: "ribosome",
                definition:
                  "A molecular machine that reads RNA to assemble an amino-acid chain.",
              },
            ],
          },
          { type: "text", text: "A codon is read by a ribosome." },
        ],
        createdAt: now,
        status: "complete",
      },
    ];
  await call("data:save", data);
  await page.reload();
  await page.getByRole("button", { name: /^Knowledge graph/ }).click();
  await expect(page.locator(".connected-node-list>button")).toHaveCount(4);
  const graph = await call<ConnectedGraph>("graph:get", {
    subjectId: subject.id,
  });
  const derived = graph.nodes.filter((node) => node.kind === "concept");
  expect(derived).toHaveLength(2);
  expect(
    derived.every((node) => node.derived && node.status === "encountered"),
  ).toBe(true);
  expect(
    (await call<StudioData>("data:load")).concepts.filter(
      (concept) => concept.subjectId === subject.id,
    ),
  ).toHaveLength(0);
  await page
    .locator(".connected-node-list>button")
    .filter({ hasText: "codon" })
    .click();
  await expect(page.getByLabel("Graph node details")).toContainText(
    "From saved teaching",
  );
  await expect(page.getByLabel("Graph node details")).toContainText(
    "Return to decoding",
  );
  await mkdir("docs/screenshots/v22", { recursive: true });
  await page.screenshot({
    path: "docs/screenshots/v22/connected-graph-automatic-terms.png",
  });
  const node = derived.find((node) => node.label === "codon")!;
  await page
    .getByRole("button", { name: "Track concept", exact: true })
    .click();
  await expect
    .poll(
      async () =>
        (await call<StudioData>("data:load")).concepts.filter(
          (concept) => concept.subjectId === subject.id,
        ).length,
    )
    .toBe(1);
  const tracked = (
    await call<ConnectedGraph>("graph:get", { subjectId: subject.id })
  ).nodes.find((item) => item.label === "codon")!;
  expect(tracked.id).toBe(node.id);
  expect(tracked.derived).not.toBe(true);
  expect(tracked.status).toBe("unassessed");
  await expect(
    page.getByRole("button", { name: "Track concept", exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Edit concepts & relations", exact: true })
    .click();
  await expect(page.locator(".ks-workspace")).toContainText("codon");
});
