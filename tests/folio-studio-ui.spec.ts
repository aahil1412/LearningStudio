import { openDestination } from "./ui-navigation";
import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page,
} from "@playwright/test";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { ContentBlock, Lesson, StudioData } from "../src/types";
import type { Subject, SubjectSnapshot } from "../src/v2types";
import { sanitizeAppearance } from "../src/lib/themes";

let app: ElectronApplication, page: Page, directory: string;
const call = <T = unknown>(action: string, payload?: unknown) =>
  page.evaluate(
    ({ action, payload }) => window.studio!.invoke<T>(action, payload),
    { action, payload },
  );
async function launch() {
  const env = Object.fromEntries(
    Object.entries({ ...process.env, STUDIO_DATA_DIR: directory }).filter(
      (item): item is [string, string] => typeof item[1] === "string",
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
    const w = BrowserWindow.getAllWindows()[0];
    w.setContentSize(1480, 1080);
    w.webContents.setBackgroundThrottling(false);
  });
  await expect(page.locator(".titlebar-center")).toHaveText("Saved locally");
}
test.beforeEach(async () => {
  await mkdir(".tools", { recursive: true });
  directory = await mkdtemp(join(resolve(".tools"), "folio-native-"));
  await launch();
});
test.afterEach(async () => {
  await app?.close().catch(() => {});
  if (!resolve(directory).startsWith(join(resolve(".tools"), "folio-native-")))
    throw new Error("Unexpected fixture directory");
  await rm(directory, {
    recursive: true,
    force: true,
    maxRetries: 8,
    retryDelay: 200,
  });
});

async function openContents() {
  const contents = page.getByRole("complementary", {
    name: "Subject contents",
    exact: true,
  });
  if (!(await contents.isVisible()))
    await page
      .getByRole("button", { name: "Show subject contents", exact: true })
      .click();
  await expect(contents).toBeVisible();
}

async function seedFolio() {
  const subject = await call<Subject>("subject:create", {
    name: "Molecular biology",
    objective: "Understand how cells store, read and use genetic information",
    depth: "comprehensive",
  });
  await call("subject:apply", {
    subjectId: subject.id,
    baseRevision: subject.revision,
    label: "Explicit interface acceptance material",
    operations: [
      {
        entity: "curriculum",
        op: "put",
        id: "folio-module",
        value: {
          kind: "module",
          title: "From genes to proteins",
          description: "Follow the flow of genetic information",
          position: 0,
          status: "introduced",
          prerequisites: [],
        },
      },
      {
        entity: "curriculum",
        op: "put",
        id: "folio-rna",
        value: {
          kind: "topic",
          parentId: "folio-module",
          title: "DNA and RNA",
          description: "The molecules that carry genetic information",
          position: 0,
          status: "covered",
          prerequisites: [],
        },
      },
      {
        entity: "curriculum",
        op: "put",
        id: "folio-translation",
        value: {
          kind: "topic",
          parentId: "folio-module",
          title: "Protein translation",
          description: "How codons select amino acids during translation",
          position: 1,
          status: "introduced",
          prerequisites: [],
        },
      },
      {
        entity: "curriculum",
        op: "put",
        id: "folio-regulation",
        value: {
          kind: "topic",
          parentId: "folio-module",
          title: "Regulating gene expression",
          description: "When and where genes are expressed",
          position: 2,
          status: "not-started",
          prerequisites: [],
        },
      },
      {
        entity: "concept",
        op: "put",
        id: "folio-codon",
        value: {
          label: "Codon recognition",
          status: "unassessed",
          coverage: "introduced",
          evidence:
            "Explicitly authored interface example; no learner understanding has been demonstrated.",
        },
      },
      {
        entity: "memory",
        op: "put",
        id: "folio-finding",
        value: {
          kind: "finding",
          title: "Sequence and information",
          content:
            "A sequence of RNA bases specifies an amino-acid sequence through the genetic code.",
          conceptIds: ["folio-codon"],
        },
      },
    ],
  });
  await call("subject:update", {
    subjectId: subject.id,
    patch: { currentNodeId: "folio-translation" },
  });
  const lesson = await call<Lesson>("subject:conversation-create", {
    subjectId: subject.id,
    title: "How a cell builds a protein",
    objective: "See how matching three RNA bases selects the next amino acid",
    mode: "Learn",
    curriculumNodeId: "folio-translation",
  });
  const content: ContentBlock[] = [
    {
      type: "text",
      text: "## Reading the message, three bases at a time\n\nA **ribosome** is the cell’s protein-building machinery. It reads **mRNA**, an RNA copy of genetic information, in groups of three bases called **codons**. Each matching **tRNA** brings an amino acid, a building block of a protein. Its **anticodon** is the three-base sequence that pairs with a codon.",
    },
    {
      type: "illustration",
      spec: {
        template: "translation",
        title: "From an RNA message to a growing protein",
      },
    },
    {
      type: "terms",
      items: [
        {
          term: "codon",
          definition:
            "A group of three mRNA bases read together during translation.",
        },
        {
          term: "anticodon",
          definition:
            "Three tRNA bases that pair antiparallel with a complementary mRNA codon.",
        },
        {
          term: "tRNA",
          definition:
            "Transfer RNA: an adaptor linking a matching codon to an amino acid.",
        },
        {
          term: "ribosome",
          definition:
            "The molecular machinery that positions mRNA and tRNAs and joins amino acids.",
        },
      ],
    },
    {
      type: "text",
      text: "### Why the pairing matters\n\nThe anticodon and codon pair in opposite directions. For example, the mRNA codon 5′ AUG 3′ pairs with 3′ UAC 5′. The ribosome joins the incoming amino acid to the growing chain, then advances along the mRNA. Step through the figure to follow these changes.",
    },
    {
      type: "mcq",
      id: "folio-check",
      question: "What links the sequence of an mRNA codon to an amino acid?",
      choices: [
        {
          id: "a",
          text: "A tRNA carrying a matching anticodon and an amino acid",
        },
        { id: "b", text: "An amino acid pairing directly with mRNA bases" },
        { id: "c", text: "The ribosome copying mRNA into DNA" },
      ],
      correctChoiceIds: ["a"],
      allowUnknown: true,
      conceptIds: ["folio-codon"],
      curriculumNodeId: "folio-translation",
      explanation:
        "A tRNA acts as an adaptor. Its anticodon recognizes a codon, while another end carries an amino acid.",
    },
  ];
  const data = await call<StudioData>("data:load");
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
                id: "folio-explanation",
                role: "assistant",
                text: "",
                content,
                createdAt: new Date().toISOString(),
                status: "complete",
              },
            ],
          }
        : item,
    ),
  });
  await page.reload();
  await openDestination(page, "Learning workspace: Lesson");
  await expect(page.locator(".lesson-top h1")).toHaveText(lesson.title);
  await openContents();
  await expect(page.locator(".folio-contents")).toContainText(
    "Protein translation",
  );
  await page
    .getByRole("button", { name: "Collapse subject contents", exact: true })
    .click();
  await page.evaluate(() => document.fonts.ready);
  return { subject, lesson };
}

test("native subject-first folio exposes real pathway, teaching, inline interaction, memory, notes and complete preferences without losing data", async () => {
  test.setTimeout(120000);
  const { subject, lesson } = await seedFolio();
  await mkdir("docs/screenshots/folio", { recursive: true });
  await expect(page.locator(".studio-topbar")).toHaveCSS("height", "64px");
  await expect(
    page.locator(
      ".studio-conversation-tabs,.app-navigation-rail,.laboratory,.visual-lab",
    ),
  ).toHaveCount(0);
  await expect(page.locator(".composer-wrap")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Ask about this page", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    animations: "disabled",
    path: "docs/screenshots/folio/learning-light.png",
  });
  const figure = page.locator(".translation-svg");
  await figure.scrollIntoViewIfNeeded();
  await page.screenshot({
    animations: "disabled",
    path: "docs/screenshots/folio/inline-translation-light.png",
  });
  await page
    .getByRole("button", { name: "Inspect tRNA", exact: true })
    .first()
    .focus();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("dialog", { name: "tRNA: an adaptor", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Next step", exact: true }).click();
  await expect(page.getByText("Step 2 of 3", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Notes", exact: true }).click();
  await page
    .getByLabel("Session notes", { exact: true })
    .fill("The tRNA connects codon recognition with the next amino acid.");
  // The companion stays inside the reading region, leaving mode controls usable.
  await page
    .getByLabel("Learning mode", { exact: true })
    .selectOption("Deep Dive");
  await expect(page.getByLabel("Learning mode", { exact: true })).toHaveValue(
    "Deep Dive",
  );
  const notesBounds = await page
    .getByRole("complementary", { name: "Lesson notes", exact: true })
    .boundingBox();
  const headingBounds = await page
    .locator(".studio-lesson-header")
    .boundingBox();
  expect(notesBounds!.y).toBeGreaterThanOrEqual(
    headingBounds!.y + headingBounds!.height,
  );
  await page.getByLabel("Learning mode", { exact: true }).selectOption("Learn");
  await page.screenshot({
    animations: "disabled",
    path: "docs/screenshots/folio/notes-companion-light.png",
  });
  await page
    .getByRole("button", { name: "Close lesson notes", exact: true })
    .click();
  await openContents();
  await page
    .locator(".folio-contents")
    .getByRole("button", { name: /Shared memory/i })
    .click();
  await expect(page.locator(".main-workspace")).toContainText(
    "Sequence and information",
  );
  await openContents();
  await page
    .locator(".folio-contents__recent-button")
    .filter({ hasText: lesson.title })
    .click();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(
    page.getByRole("region", { name: "Settings", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".settings-embedded")).toBeVisible();
  await page.screenshot({
    animations: "disabled",
    path: "docs/screenshots/folio/preferences-light.png",
  });
  await page
    .locator(".appearance-modes")
    .getByRole("button", { name: "Dark", exact: true })
    .click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.screenshot({
    animations: "disabled",
    path: "docs/screenshots/folio/preferences-dark.png",
  });
  await page
    .getByRole("button", { name: "Close settings", exact: true })
    .click();
  await page
    .locator(".lesson-reader")
    .evaluate((element) => element.scrollTo({ top: 0 }));
  await page.screenshot({
    animations: "disabled",
    path: "docs/screenshots/folio/learning-dark.png",
  });
  for (const width of [1100, 900]) {
    await app.evaluate(
      ({ BrowserWindow }, size) =>
        BrowserWindow.getAllWindows()[0].setContentSize(size, 1080),
      width,
    );
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBe(true);
    expect(
      await page
        .locator(".translation-svg")
        .evaluate(
          (svg) =>
            svg.getBoundingClientRect().width <=
            svg.closest(".science-viewport")!.clientWidth + 1,
        ),
    ).toBe(true);
    await page.screenshot({
      animations: "disabled",
      path: `docs/screenshots/folio/learning-dark-${width}.png`,
    });
  }
  await openContents();
  const contents = page.getByRole("dialog", {
    name: "Subject contents",
    exact: true,
  });
  await expect(contents).toContainText("Protein translation");
  await contents
    .getByRole("button", { name: "Collapse subject contents", exact: true })
    .click();
  await expect(contents).toHaveCount(0);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Preview", exact: true }).click();
  await expect(page.getByLabel("Live appearance preview")).toBeVisible();
  await page.screenshot({
    animations: "disabled",
    path: "docs/screenshots/folio/preferences-900.png",
  });
  await page
    .getByRole("button", { name: "Close appearance preview", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Close settings", exact: true })
    .click();
  const saved = await call<StudioData>("data:load");
  const appearance = sanitizeAppearance(saved.appearance);
  appearance.mode = "light";
  appearance.editing = "light";
  appearance.light.colors = {
    ...appearance.light.colors,
    bg: "#ece8df",
    reading: "#f3ede3",
    sidebar: "#e3dccf",
    text: "#253247",
    heading: "#253247",
    bold: "#3c4a68",
  };
  await call("data:save", { ...saved, appearance });
  await page.reload();
  await openDestination(page, "Learning workspace: Lesson");
  await expect(page.locator(".lesson-top h1")).toHaveText(lesson.title);
  await page.screenshot({
    animations: "disabled",
    path: "docs/screenshots/folio/learning-custom-900.png",
  });
  const snapshot = await call<SubjectSnapshot>("subject:get", {
    subjectId: subject.id,
  });
  expect(
    snapshot.concepts.find((item) => item.id === "folio-codon")?.status,
  ).toBe("unassessed");
  await app.close();
  await launch();
  await openDestination(page, "Learning workspace: Lesson");
  await expect(page.locator(".lesson-top h1")).toHaveText(lesson.title);
  expect(
    (await call<StudioData>("data:load")).lessons.find(
      (item) => item.id === lesson.id,
    )?.notes,
  ).toContain("tRNA connects");
});
