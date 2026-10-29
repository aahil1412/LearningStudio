import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page,
} from "@playwright/test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve, sep } from "node:path";
import {
  openDestination,
  openTutor,
  openSubjectTab,
  startSubjectLesson,
} from "./ui-navigation";
import type { StudioData } from "../src/types";
import type { Subject, SubjectSnapshot } from "../src/v2types";
import type { StudySource, StudySourceContext } from "../src/sourceStudyTypes";

let app: ElectronApplication, page: Page, directory: string;
const screenshotDirectory = resolve("docs/screenshots/folio");
async function call<T = unknown>(action: string, payload?: unknown) {
  return page.evaluate(
    ({ action, payload }) => window.studio!.invoke<T>(action, payload),
    { action, payload },
  );
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
    args: [".", "--start-hidden"],
    cwd: process.cwd(),
    env,
  });
  page = await app.firstWindow();
  await app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    window.setContentSize(1540, 1120);
    window.webContents.setBackgroundThrottling(false);
  });
  await expect(page.locator(".titlebar-center")).toHaveText("Saved locally");
}
async function createSubject(kind: "curriculum" | "textbook", name: string) {
  await openDestination(page, "Subject workspaces: Subjects");
  await page.getByRole("button", { name: "New subject", exact: true }).click();
  await page.getByLabel("Subject workspace name").fill(name);
  await page
    .getByLabel("Subject learning objective")
    .fill("Learn the complete supplied material in its reviewed order");
  await page
    .locator(".source-study-create-choice")
    .getByRole("button", {
      name: kind === "curriculum" ? "Use a curriculum" : "Study a textbook",
      exact: true,
    })
    .click();
  await page
    .getByRole("button", { name: "Create subject", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { level: 1, name, exact: true }),
  ).toBeVisible();
  const panel = page.getByRole("region", {
    name: "Curriculum and textbook study",
    exact: true,
  });
  await expect(panel).toBeVisible();
  await expect(
    panel.getByRole("heading", {
      name:
        kind === "curriculum"
          ? "Bring your curriculum"
          : "Choose the textbook to study",
      exact: true,
    }),
  ).toBeVisible();
  const subject = (await call<Subject[]>("subject:list")).find(
    (item) => item.name === name,
  )!;
  expect(subject).toBeTruthy();
  expect(await call("planning:list", { subjectId: subject.id })).toEqual([]);
  expect(
    (await call<SubjectSnapshot>("subject:get", { subjectId: subject.id }))
      .curriculum,
  ).toEqual([]);
  return { subject, panel };
}
async function assertNoMastery(subjectId: string) {
  const state = await call<SubjectSnapshot>("subject:get", { subjectId });
  expect(state.concepts).toEqual([]);
  expect(state.evidence).toEqual([]);
  expect(state.curriculum.every((node) => node.status === "not-started")).toBe(
    true,
  );
  return state;
}
async function openSubject(name: string) {
  await page
    .locator(".subject-chat-banner")
    .getByRole("button", { name, exact: true })
    .click();
  await expect(
    page.getByRole("heading", { level: 1, name, exact: true }),
  ).toBeVisible();
}
async function openTopic(nodeId: string) {
  await openSubjectTab(page, "Learning pathway");
  await page.locator(`[data-curriculum-node="${nodeId}"]`).click();
  await page
    .getByRole("button", { name: "Open topic in a chat", exact: true })
    .click();
  await expect(page.locator(".lesson-top")).toBeVisible();
}

/** A real five-page PDF with authored text, parsed by the normal import path. */
function textbookPdf() {
  const pages = [
    [
      "Mechanics course reader",
      "Authored acceptance-test textbook. Not a published university source.",
    ],
    [
      "Chapter 1: Motion",
      "Position locates an object relative to an origin.",
      "Displacement is a change in position.",
    ],
    [
      "Velocity and motion",
      "Velocity describes the rate of change of position.",
      "A direction is part of a velocity measurement.",
    ],
    [
      "Chapter 2: Forces",
      "A force changes the momentum of a system.",
      "The system boundary identifies which external forces must be considered.",
    ],
    [
      "Chapter 3: Energy",
      "Energy accounting compares initial and final states.",
      "For an isolated system the total energy is conserved.",
    ],
  ];
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Kids [${pages.map((_, i) => `${4 + i * 2} 0 R`).join(" ")}] /Count ${pages.length} >>`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  for (const [index, lines] of pages.entries()) {
    const stream =
      "BT /F1 12 Tf 40 740 Td 24 TL\n" +
      lines
        .map(
          (line, i) =>
            `${i ? "T* " : ""}(${line.replace(/[()\\]/g, "\\$&")}) Tj`,
        )
        .join("\n") +
      "\nET";
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + index * 2} 0 R >>`,
      `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
    );
  }
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)
    .join(
      "",
    )}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(pdf);
}
async function installControlledProvider() {
  await app.evaluate(({ ipcMain }) => {
    const state = globalThis as typeof globalThis & {
      studySourceRequests?: { instructions: string; input: unknown }[];
    };
    state.studySourceRequests = [];
    const original = (ipcMain as any)._invokeHandlers.get("studio:invoke");
    ipcMain.removeHandler("studio:invoke");
    ipcMain.handle("studio:invoke", async (event, action, payload) => {
      if (action === "auth:status")
        return {
          connected: true,
          account: "Controlled source-study acceptance provider",
        };
      if (action === "auth:models")
        return [
          {
            id: "source-study-fixture",
            name: "Controlled source-study provider",
            reasoningLevels: ["low"],
          },
        ];
      if (action === "model:send") {
        state.studySourceRequests!.push({
          instructions: payload.instructions,
          input: payload.input,
        });
        const match = payload.instructions.match(
          /SOURCE_STUDY_CONTEXT:\s*(\{[^\n]*\})/,
        );
        const context = match ? JSON.parse(match[1]) : null;
        const excerpt = context?.excerpts?.[0];
        return JSON.stringify({
          content: [
            {
              type: "text",
              text: `## ${context?.currentEntry?.title || "Missing source section"}\n\nControlled-provider acceptance response. This verifies source retrieval and presentation, not a live model response.\n\n${excerpt?.text || "No source excerpt was supplied."}\n\nSource: ${excerpt?.citation || "unavailable"}.`,
            },
          ],
        });
      }
      return original(event, action, payload);
    });
  });
  await page.reload();
  await expect(page.locator(".titlebar-center")).toHaveText("Saved locally");
}

test.beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "studio-source-study-"));
  await mkdir(screenshotDirectory, { recursive: true });
  await launch();
});
test.afterEach(async () => {
  await app
    ?.evaluate(() => {
      const state = (globalThis as any).studySourceRace;
      state?.releaseModel?.();
      state?.releaseSource?.();
    })
    .catch(() => {});
  await app?.close().catch(() => {});
  const target = resolve(directory);
  if (
    !target.startsWith(resolve(tmpdir()) + sep) ||
    !basename(target).startsWith("studio-source-study-")
  )
    throw new Error("Unsafe source-study fixture cleanup");
  await rm(target, {
    recursive: true,
    force: true,
    maxRetries: 8,
    retryDelay: 200,
  });
});

test("pasted broad curriculum is reviewed before adoption, preserves ordered sections and creates source-linked chats without mastery", async () => {
  const { subject, panel } = await createSubject(
    "curriculum",
    "Biology course plan",
  );
  await panel
    .getByRole("button", { name: "Paste source text", exact: true })
    .click();
  await panel
    .getByLabel("Study source title")
    .fill("University-style biology syllabus");
  await panel
    .getByLabel("Study source text")
    .fill(
      "Week 1: Cells and membranes\n- Cell structure and compartmentalization\nWeek 2: Genetic information\n- DNA replication and gene expression\nWeek 3: Evolution and diversity\n- Natural selection and common ancestry\nWeek 4: Ecology and ecosystems\n- Energy flow and population interactions",
    );
  await page.screenshot({
    path: join(screenshotDirectory, "source-curriculum-setup.png"),
    fullPage: true,
    animations: "disabled",
  });
  await panel
    .getByRole("button", { name: "Review outline", exact: true })
    .click();
  await expect(
    panel.getByRole("heading", {
      name: "Review your study outline",
      exact: true,
    }),
  ).toBeVisible();
  expect(
    (await call<SubjectSnapshot>("subject:get", { subjectId: subject.id }))
      .curriculum,
  ).toEqual([]);
  expect(await call("planning:list", { subjectId: subject.id })).toEqual([]);
  await expect(
    panel.getByLabel("Section title 1", { exact: true }),
  ).toHaveValue("Week 1: Cells and membranes");
  await panel
    .getByLabel("Section title 1", { exact: true })
    .fill("Week 1: Cells, membranes and biological organization");
  await page.screenshot({
    path: join(screenshotDirectory, "source-curriculum-review-desktop.png"),
    fullPage: true,
    animations: "disabled",
  });
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setContentSize(900, 1050),
  );
  await expect(
    panel.getByLabel("Section title 1", { exact: true }),
  ).toHaveValue("Week 1: Cells, membranes and biological organization");
  expect(
    await panel.evaluate(
      (element) => element.scrollWidth <= element.clientWidth + 1,
    ),
  ).toBe(true);
  await page.screenshot({
    path: join(screenshotDirectory, "source-curriculum-review-900.png"),
    fullPage: true,
    animations: "disabled",
  });
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setContentSize(1540, 1120),
  );
  await panel
    .getByRole("button", { name: "Apply to pathway", exact: true })
    .click();
  await expect(panel.locator(".source-study-active")).toContainText(
    "University-style biology syllabus",
  );
  const sources = await call<StudySource[]>("study-sources:list", {
    subjectId: subject.id,
  });
  expect(sources).toHaveLength(1);
  expect(
    sources[0].entries
      .filter((entry) => entry.kind === "week")
      .map((entry) => entry.title),
  ).toEqual([
    "Week 1: Cells, membranes and biological organization",
    "Week 2: Genetic information",
    "Week 3: Evolution and diversity",
    "Week 4: Ecology and ecosystems",
  ]);
  expect(sources[0].mappings).toHaveLength(sources[0].entries.length);
  const state = await assertNoMastery(subject.id);
  expect(state.curriculum).toHaveLength(sources[0].entries.length + 1);
  const data = await call<StudioData>("data:load");
  expect(
    data.library.filter((item) => item.id === sources[0].resourceId),
  ).toHaveLength(1);
  expect(
    data.library.find((item) => item.id === sources[0].resourceId)?.verified,
  ).toBe(false);
  await page.locator(".subject-workspace-v3").evaluate((element) => {
    element.scrollTop = 0;
  });
  await expect
    .poll(() =>
      page
        .locator(".subject-workspace-v3")
        .evaluate((element) => element.scrollTop),
    )
    .toBe(0);
  await page.screenshot({
    path: join(screenshotDirectory, "source-curriculum.png"),
    fullPage: true,
    animations: "disabled",
  });
  await panel
    .locator(".source-study-active")
    .getByRole("button", { name: "Continue", exact: true })
    .click();
  await expect(page.locator(".lesson-top h1")).toContainText(
    "Week 1: Cells, membranes and biological organization",
  );
  const first = (
    await call<SubjectSnapshot>("subject:get", { subjectId: subject.id })
  ).conversations[0];
  const context = await call<StudySourceContext>("study-sources:context", {
    subjectId: subject.id,
    conversationId: first.id,
    query: "continue",
    budget: 1600,
  });
  expect(context.currentEntry?.title).toBe(
    "Week 1: Cells, membranes and biological organization",
  );
  expect(
    context.excerpts.some((excerpt) => excerpt.text.includes("Cell structure")),
  ).toBe(true);
  expect(context.usage.fullSourceIncluded).toBe(false);
  expect(context.usage.estimatedTokens).toBeLessThanOrEqual(1600);
  await openSubject(subject.name);
  const secondEntry = sources[0].entries.find(
    (entry) => entry.title === "Week 2: Genetic information",
  )!;
  const secondNode = sources[0].mappings.find(
    (mapping) => mapping.entryId === secondEntry.id,
  )!.curriculumNodeId;
  await openTopic(secondNode);
  const second = (
    await call<SubjectSnapshot>("subject:get", { subjectId: subject.id })
  ).conversations.find((chat) => chat.curriculumNodeId === secondNode)!;
  const nextContext = await call<StudySourceContext>("study-sources:context", {
    subjectId: subject.id,
    conversationId: second.id,
    query: "continue",
    budget: 1600,
  });
  expect(nextContext.currentEntry?.id).toBe(secondEntry.id);
  expect(
    nextContext.excerpts.some((excerpt) =>
      excerpt.text.includes("DNA replication"),
    ),
  ).toBe(true);
  await assertNoMastery(subject.id);
});

test("real PDF textbook imports, adopts physical chapter pages, grounds continue with exact citations and survives restart", async () => {
  test.setTimeout(90000);
  const { subject, panel } = await createSubject(
    "textbook",
    "Mechanics from a textbook",
  );
  const pdfPath = join(directory, "mechanics-textbook.pdf");
  await writeFile(pdfPath, textbookPdf());
  await app.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [path],
    });
  }, pdfPath);
  await panel
    .getByRole("button", { name: "Import PDF, Markdown or text", exact: true })
    .click();
  await expect(
    panel.getByLabel("Choose study source document"),
  ).not.toHaveValue("", { timeout: 30000 });
  const imported = (await call<StudioData>("data:load")).library.find(
    (item) => item.title === "mechanics-textbook.pdf",
  )!;
  expect(imported.pages?.map((item) => item.page)).toEqual([1, 2, 3, 4, 5]);
  expect(imported.subjectId).toBe(subject.id);
  expect(imported.verified).toBe(false);
  await panel.getByLabel("Study source title").fill("Mechanics course reader");
  await panel
    .getByRole("button", { name: "Review outline", exact: true })
    .click();
  await expect(
    panel.getByLabel("Section title 1", { exact: true }),
  ).toHaveValue("Chapter 1: Motion");
  await expect(
    panel.getByLabel("Section 1 start page", { exact: true }),
  ).toHaveValue("2");
  await expect(
    panel.getByLabel("Section 1 end page", { exact: true }),
  ).toHaveValue("3");
  await expect(
    panel.getByLabel("Section 2 start page", { exact: true }),
  ).toHaveValue("4");
  await expect(
    panel.getByLabel("Section 2 end page", { exact: true }),
  ).toHaveValue("4");
  await expect(
    panel.getByLabel("Section 3 start page", { exact: true }),
  ).toHaveValue("5");
  await panel
    .getByRole("button", { name: "Apply and begin", exact: true })
    .click();
  await expect(page.locator(".lesson-top h1")).toHaveText("Chapter 1: Motion");
  const [source] = await call<StudySource[]>("study-sources:list", {
    subjectId: subject.id,
  });
  expect(source.entries.map((entry) => entry.title)).toEqual([
    "Chapter 1: Motion",
    "Chapter 2: Forces",
    "Chapter 3: Energy",
  ]);
  const firstChat = (
    await call<SubjectSnapshot>("subject:get", { subjectId: subject.id })
  ).conversations.find(
    (chat) =>
      chat.curriculumNodeId ===
      source.mappings.find(
        (mapping) => mapping.entryId === source.entries[0].id,
      )?.curriculumNodeId,
  )!;
  const firstContext = await call<StudySourceContext>("study-sources:context", {
    subjectId: subject.id,
    conversationId: firstChat.id,
    query: "continue",
    budget: 1800,
  });
  expect(
    firstContext.excerpts.some((excerpt) =>
      excerpt.text.includes("Position locates"),
    ),
  ).toBe(true);
  expect(
    firstContext.excerpts.every(
      (excerpt) =>
        excerpt.page !== undefined && excerpt.page >= 2 && excerpt.page <= 3,
    ),
  ).toBe(true);
  expect(
    firstContext.excerpts.some((excerpt) =>
      excerpt.text.includes("A force changes"),
    ),
  ).toBe(false);
  await openSubject(subject.name);
  const forceEntry = source.entries[1],
    forceNode = source.mappings.find(
      (mapping) => mapping.entryId === forceEntry.id,
    )!.curriculumNodeId;
  await openTopic(forceNode);
  await expect(page.locator(".lesson-top h1")).toHaveText("Chapter 2: Forces");
  await installControlledProvider();
  await openTutor(page);
  await page.getByLabel("Message the tutor").fill("continue");
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  const message = page.locator(".lesson-message.assistant").last();
  await expect(message).toContainText(
    "Controlled-provider acceptance response",
  );
  await expect(message).toContainText(
    "A force changes the momentum of a system.",
  );
  await message.locator("details.notice > summary").click();
  await expect(message).toContainText("mechanics-textbook.pdf, PDF page 4");
  const captured = await app.evaluate(
    () =>
      (
        globalThis as typeof globalThis & {
          studySourceRequests?: { instructions: string }[];
        }
      ).studySourceRequests || [],
  );
  expect(captured).toHaveLength(1);
  expect(captured[0].instructions).toContain("SOURCE_STUDY_POLICY");
  expect(captured[0].instructions).toContain('"title":"Chapter 2: Forces"');
  expect(captured[0].instructions).toContain('"page":4');
  expect(captured[0].instructions).not.toContain(
    "Velocity describes the rate of change of position.",
  );
  await expect
    .poll(async () => {
      const data = await call<StudioData>("data:load");
      return data.lessons
        .find((lesson) => lesson.id === data.activeLessonId)
        ?.messages.at(-1)?.status;
    })
    .toBe("complete");
  const saved = await call<StudioData>("data:load"),
    chat = saved.lessons.find((lesson) => lesson.id === saved.activeLessonId)!;
  expect(
    chat.messages
      .at(-1)
      ?.sources?.every(
        (excerpt) => excerpt.documentId === imported.id && excerpt.page === 4,
      ),
  ).toBe(true);
  await assertNoMastery(subject.id);
  await page.screenshot({
    path: join(screenshotDirectory, "source-textbook.png"),
    fullPage: true,
    animations: "disabled",
  });
  await app.close();
  await launch();
  await openDestination(page, "Learning workspace: Lesson");
  await expect(page.locator(".lesson-top h1")).toHaveText("Chapter 2: Forces");
  await expect(page.locator(".lesson-message.assistant").last()).toContainText(
    "A force changes the momentum of a system.",
  );
  const restored = await call<StudioData>("data:load");
  expect(
    restored.library.find((item) => item.id === imported.id)?.pages,
  ).toEqual(imported.pages);
  expect(
    restored.lessons.find((lesson) => lesson.id === chat.id)?.messages,
  ).toEqual(chat.messages);
  expect(
    (
      await call<StudySource[]>("study-sources:list", { subjectId: subject.id })
    )[0].mappings,
  ).toEqual(source.mappings);
  const continuation = await call<StudySourceContext>("study-sources:context", {
    subjectId: subject.id,
    conversationId: chat.id,
    query: "continue",
    budget: 1600,
  });
  expect(continuation.currentEntry?.id).toBe(forceEntry.id);
  expect(
    continuation.excerpts.some(
      (excerpt) => excerpt.page === 4 && excerpt.text.includes("momentum"),
    ),
  ).toBe(true);
  await assertNoMastery(subject.id);
});

test("a held source-save response cannot erase a concurrent tutor completion or locally added library note", async () => {
  test.setTimeout(90000);
  const { subject } = await createSubject(
    "curriculum",
    "Concurrent source study",
  );
  await startSubjectLesson(page);
  await expect(page.locator(".lesson-top")).toBeVisible();
  const chatId = await page.getByLabel("Current conversation").inputValue();
  await app.evaluate(({ ipcMain }) => {
    const state = {
      modelPending: false,
      modelReleasedAt: 0,
      sourceHeld: false,
      sourcePersisted: false,
      sourceResourceId: "",
      staleWrites: 0,
      releaseModel: undefined as (() => void) | undefined,
      releaseSource: undefined as (() => void) | undefined,
    };
    (globalThis as any).studySourceRace = state;
    const original = (ipcMain as any)._invokeHandlers.get("studio:invoke");
    ipcMain.removeHandler("studio:invoke");
    ipcMain.handle("studio:invoke", async (event, action, payload) => {
      if (action === "auth:status")
        return {
          connected: true,
          account: "Controlled source-save race provider",
        };
      if (action === "auth:models")
        return [
          {
            id: "source-race-fixture",
            name: "Controlled race provider",
            reasoningLevels: ["low"],
          },
        ];
      if (action === "model:send") {
        state.modelPending = true;
        return new Promise<string>((resolve) => {
          state.releaseModel = () => {
            state.modelPending = false;
            state.modelReleasedAt = Date.now();
            resolve(
              JSON.stringify({
                content: [
                  {
                    type: "text",
                    text: "Controlled race response retained. This authored response tests concurrent persistence, not a live model.",
                  },
                ],
              }),
            );
          };
        });
      }
      if (action === "study-sources:save") {
        const result = await original(event, action, payload);
        state.sourceResourceId = result.resourceId;
        state.sourcePersisted = true;
        state.sourceHeld = true;
        await new Promise<void>((resolve) => {
          state.releaseSource = () => {
            state.sourceHeld = false;
            resolve();
          };
        });
        return result;
      }
      if (
        action === "data:save" &&
        state.sourceHeld &&
        !payload.library?.some(
          (item: { id: string }) => item.id === state.sourceResourceId,
        )
      )
        state.staleWrites++;
      return original(event, action, payload);
    });
  });
  await page.reload();
  await openDestination(page, "Learning workspace: Lesson");
  await expect(page.locator(".lesson-top")).toBeVisible();
  await openTutor(page);
  await page
    .getByLabel("Message the tutor")
    .fill("Explain momentum in one short paragraph.");
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await expect
    .poll(() =>
      app.evaluate(() =>
        Boolean((globalThis as any).studySourceRace.modelPending),
      ),
    )
    .toBe(true);
  await openSubject(subject.name);
  await openSubjectTab(page, "Resources");
  const panel = page.getByRole("region", {
    name: "Curriculum and textbook study",
    exact: true,
  });
  await panel
    .getByRole("button", { name: "Use a curriculum", exact: true })
    .click();
  await panel
    .getByRole("button", { name: "Paste source text", exact: true })
    .click();
  await panel
    .getByLabel("Study source title")
    .fill("Concurrency course source");
  await panel
    .getByLabel("Study source text")
    .fill(
      "Week 1: System boundaries\nThe chosen system determines which forces are external.\nWeek 2: Momentum\nAn impulse changes a system's momentum.",
    );
  await panel
    .getByRole("button", { name: "Review outline", exact: true })
    .click();
  await panel.getByRole("button", { name: "Save guide", exact: true }).click();
  await expect
    .poll(() =>
      app.evaluate(() =>
        Boolean((globalThis as any).studySourceRace.sourcePersisted),
      ),
    )
    .toBe(true);
  const sourceResourceId = await app.evaluate(
    () => (globalThis as any).studySourceRace.sourceResourceId as string,
  );
  expect(
    (await call<StudioData>("data:load")).library.some(
      (item) => item.id === sourceResourceId,
    ),
  ).toBe(true);
  await app.evaluate(() => (globalThis as any).studySourceRace.releaseModel());
  // The normal global navigation remains usable while the source operation is
  // held. Seeing the reply here proves renderer completion, not just provider
  // resolution, before the concurrent local edit and source hydration.
  await openDestination(page, "Learning workspace: Study");
  await expect(page.locator(".lesson-message.assistant").last()).toContainText(
    "Controlled race response retained.",
  );
  await openDestination(page, "Your library");
  await page
    .getByRole("button", { name: "Add to library", exact: true })
    .click();
  await page
    .getByLabel("Resource title")
    .fill("Note written during source save");
  await page
    .getByLabel("Resource content")
    .fill("This local edit must survive canonical source-library hydration.");
  await page
    .getByRole("button", { name: "Save resource", exact: true })
    .click();
  await expect(page.locator(".lib-workspace")).toContainText(
    "Note written during source save",
  );
  // The production tutor-completion save is scheduled after 100ms. Keep the
  // response held beyond that known scheduler boundary before checking that
  // no stale library write passed the source-operation barrier.
  await expect
    .poll(() =>
      app.evaluate(
        () => Date.now() - (globalThis as any).studySourceRace.modelReleasedAt,
      ),
    )
    .toBeGreaterThan(200);
  expect(
    await app.evaluate(() =>
      Boolean((globalThis as any).studySourceRace.sourceHeld),
    ),
  ).toBe(true);
  expect(
    await app.evaluate(() => (globalThis as any).studySourceRace.staleWrites),
  ).toBe(0);
  await app.evaluate(() => (globalThis as any).studySourceRace.releaseSource());
  await expect
    .poll(async () => {
      const data = await call<StudioData>("data:load");
      return {
        source: data.library.some((item) => item.id === sourceResourceId),
        note: data.library.some(
          (item) =>
            item.title === "Note written during source save" &&
            item.content ===
              "This local edit must survive canonical source-library hydration.",
        ),
        transcript: data.lessons
          .find((lesson) => lesson.id === chatId)
          ?.messages.at(-1)?.status,
      };
    })
    .toEqual({ source: true, note: true, transcript: "complete" });
  const context = await call<StudySourceContext>("study-sources:context", {
    subjectId: subject.id,
    conversationId: chatId,
    query: "system boundaries",
    budget: 1600,
  });
  expect(
    context.excerpts.some(
      (excerpt) =>
        excerpt.documentId === sourceResourceId &&
        excerpt.text.includes("which forces are external"),
    ),
  ).toBe(true);
  await app.close();
  await launch();
  const restored = await call<StudioData>("data:load");
  expect(
    restored.library.filter((item) => item.id === sourceResourceId),
  ).toHaveLength(1);
  expect(
    restored.library.filter(
      (item) => item.title === "Note written during source save",
    ),
  ).toHaveLength(1);
  expect(
    restored.lessons.find((lesson) => lesson.id === chatId)?.messages.at(-1)
      ?.text,
  ).toContain("Controlled race response retained.");
  expect(
    (
      await call<StudySource[]>("study-sources:list", { subjectId: subject.id })
    )[0].resourceId,
  ).toBe(sourceResourceId);
  await assertNoMastery(subject.id);
});

test("local Markdown textbook import retains heading citations without inventing PDF page 1", async () => {
  const { subject, panel } = await createSubject(
    "textbook",
    "A Markdown study guide",
  );
  const path = join(directory, "mechanics-guide.md");
  await writeFile(
    path,
    "# Chapter 1: Measurement\nMeasurements compare a quantity with a stated unit.\n# Chapter 2: Motion\nVelocity is a vector rate of change of position.\n",
    "utf8",
  );
  await app.evaluate(({ dialog }, filePath) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [filePath],
    });
  }, path);
  await panel
    .getByRole("button", { name: "Import PDF, Markdown or text", exact: true })
    .click();
  await expect(
    panel.getByLabel("Choose study source document"),
  ).not.toHaveValue("");
  const imported = (await call<StudioData>("data:load")).library.find(
    (item) => item.title === "mechanics-guide.md",
  )!;
  expect(imported).toBeTruthy();
  expect(imported.pages || []).toEqual([]);
  await panel
    .getByRole("button", { name: "Review outline", exact: true })
    .click();
  await expect(
    panel.getByLabel("Section title 1", { exact: true }),
  ).toHaveValue("Chapter 1: Measurement");
  await expect(
    panel.getByLabel("Section 1 start page", { exact: true }),
  ).toHaveCount(0);
  await panel
    .getByRole("button", { name: "Apply and begin", exact: true })
    .click();
  await expect(page.locator(".lesson-top h1")).toHaveText(
    "Chapter 1: Measurement",
  );
  const data = await call<StudioData>("data:load");
  const context = await call<StudySourceContext>("study-sources:context", {
    subjectId: subject.id,
    conversationId: data.activeLessonId,
    query: "continue",
    budget: 1600,
  });
  expect(context.excerpts.length).toBeGreaterThan(0);
  expect(
    context.excerpts.every(
      (excerpt) =>
        excerpt.page === undefined && !/PDF page/i.test(excerpt.citation),
    ),
  ).toBe(true);
  expect(
    context.excerpts.some((excerpt) => excerpt.text.includes("stated unit")),
  ).toBe(true);
  expect(context.currentEntry?.startPage).toBeUndefined();
  await assertNoMastery(subject.id);
});
