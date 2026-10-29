import { seedReferenceLesson } from "./learning-fixtures";
import { openDestination, openTutor } from "./ui-navigation";
import {
  _electron as electron,
  test,
  expect,
  type ElectronApplication,
  type Page,
} from "@playwright/test";
import {
  mkdtempSync,
  rmSync,
  mkdirSync,
  readFileSync,
  existsSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, basename, sep } from "node:path";
import type { Subject, SubjectRecord, TextbookChapter } from "../src/v2types";
import type { LibraryItem, StudioData } from "../src/types";
let app: ElectronApplication, page: Page, directory: string;
let rendererErrors: string[] = [];
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
  page.on("pageerror", (error) => {
    rendererErrors.push(error.message);
    console.log("Renderer error:", error.stack);
  });
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
async function createSubject(name: string) {
  await openDestination(page, "Subject workspaces: My learning");
  await page.getByRole("button", { name: "New subject", exact: true }).click();
  await page.getByLabel("Subject workspace name", { exact: true }).fill(name);
  await page
    .getByLabel("Subject learning objective", { exact: true })
    .fill("Read sources and connect ideas");
  await page
    .getByRole("button", { name: "Create subject", exact: true })
    .click();
  return (await call<Subject[]>("subject:list")).find(
    (subject) => subject.name === name,
  )!;
}
async function customizeTypography() {
  await page
    .locator(".sidebar-bottom")
    .getByRole("button", { name: "Settings", exact: true })
    .click();
  await page
    .locator(".appearance-modes")
    .getByRole("button", { name: "Light", exact: true })
    .click();
  await page.getByRole("button", { name: "Typography", exact: true }).click();
  await page
    .getByRole("combobox", { name: "Reading font", exact: true })
    .selectOption("Cambria, serif");
  for (const [name, steps] of [
    ["Reading size", 7],
    ["Line height", 15],
  ] as const) {
    const slider = page.getByRole("slider", { name, exact: true });
    await slider.press("Home");
    for (let i = 0; i < steps; i++) await slider.press("ArrowRight");
  }
  const weight = page.getByRole("slider", {
    name: "Heading weight",
    exact: true,
  });
  await weight.press("End");
  await weight.press("ArrowLeft");
  await weight.press("ArrowLeft");
  await page
    .getByRole("button", { name: "Close settings", exact: true })
    .click();
}
async function expectReading(selector: string) {
  await expect
    .poll(() =>
      page.locator(selector).evaluate((element) => {
        const style = getComputedStyle(element);
        return {
          size: style.fontSize,
          line: style.lineHeight,
          font: style.fontFamily,
        };
      }),
    )
    .toEqual({ size: "20px", line: "40px", font: "Cambria, serif" });
}
function sourcePdf() {
  const text =
    "A measured interval connects an observed change to an explicit mathematical model. This authored source is used to verify exact page citations.";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R 6 0 R] /Count 2 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    "",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 7 0 R >>",
    "",
  ];
  for (const [index, value] of [
    [3, text],
    [
      6,
      "A second page states a different assumption. Exact citations must preserve this page number.",
    ],
  ] as const) {
    const stream = "BT /F1 11 Tf 40 720 Td (" + value + ") Tj ET";
    objects[index] =
      "<< /Length " +
      Buffer.byteLength(stream) +
      " >>\nstream\n" +
      stream +
      "\nendstream";
  }
  const parts = [Buffer.from("%PDF-1.4\n")],
    offsets = [0];
  let offset = parts[0].length;
  objects.forEach((object, index) => {
    offsets.push(offset);
    const bytes = Buffer.from(index + 1 + " 0 obj\n" + object + "\nendobj\n");
    parts.push(bytes);
    offset += bytes.length;
  });
  parts.push(
    Buffer.from(
      "xref\n0 " +
        (objects.length + 1) +
        "\n0000000000 65535 f \n" +
        offsets
          .slice(1)
          .map((value) => String(value).padStart(10, "0") + " 00000 n \n")
          .join("") +
        "trailer\n<< /Size " +
        (objects.length + 1) +
        " /Root 1 0 R >>\nstartxref\n" +
        offset +
        "\n%%EOF",
    ),
  );
  return Buffer.concat(parts);
}
test.beforeEach(async () => {
  rendererErrors = [];
  directory = mkdtempSync(join(tmpdir(), "studio-v2-reader-"));
  await launch();
});
test.afterEach(async () => {
  const info = test.info();
  if (info.status !== info.expectedStatus)
    console.log(
      "Visible app state:",
      (
        await page
          .locator("body")
          .innerText()
          .catch(() => "")
      ).slice(0, 1800),
    );
  await app?.close().catch(() => {});
  const target = resolve(directory);
  if (
    !target.startsWith(resolve(tmpdir()) + sep) ||
    !basename(target).startsWith("studio-v2-reader-")
  )
    throw new Error("Unexpected reader test directory.");
  rmSync(target, {
    recursive: true,
    force: true,
    maxRetries: 8,
    retryDelay: 200,
  });
  expect(rendererErrors).toEqual([]);
});
test("native selected-message export previews the actual standalone edition and saves a self-contained HTML without private notes", async () => {
  await seedReferenceLesson(page);
  await expect(page.locator(".lesson-top h1")).toHaveText(
    "The shape of change",
  );
  await expect
    .poll(async () => {
      const data = await call<StudioData>("data:load");
      return data.lessons.some((lesson) => lesson.id === data.activeLessonId);
    })
    .toBe(true);
  await page.getByRole("button", { name: "Notes", exact: true }).click();
  await page
    .getByLabel("Session notes", { exact: true })
    .fill("PRIVATE_NOTE_NOT_SELECTED_FOR_EXPORT");
  await expect(page.locator(".titlebar-center")).toHaveText("Saved locally");
  await page
    .getByRole("button", { name: "Session actions", exact: true })
    .click();
  await page.getByRole("button", { name: "Export HTML", exact: true }).click();
  const dialog = page.getByRole("dialog", {
    name: "Export interactive textbook",
    exact: true,
  });
  await dialog
    .getByLabel("Export book title", { exact: true })
    .fill("Portable lesson");
  await dialog
    .getByRole("checkbox", {
      name: "Choose individual message sections",
      exact: true,
    })
    .check();
  await expect(
    dialog.getByRole("button", { name: "Preview export", exact: true }),
  ).toBeDisabled();
  await dialog.getByRole("checkbox", { name: /Explanation ·/ }).check();
  await dialog
    .getByRole("button", { name: "Preview export", exact: true })
    .click();
  const frame = page.frameLocator(
    'iframe[title="Standalone textbook preview"]',
  );
  await expect(
    frame.getByRole("heading", { name: "Portable lesson", exact: true }),
  ).toBeVisible();
  await expect.poll(() => frame.locator(".katex").count()).toBeGreaterThan(2);
  await expect(frame.locator(".plot-canvas .main-svg").first()).toBeVisible();
  await dialog
    .getByLabel("Export book title", { exact: true })
    .fill("Portable lesson revised");
  await dialog
    .getByRole("button", { name: "Preview export", exact: true })
    .click();
  await expect(
    frame.getByRole("heading", {
      name: "Portable lesson revised",
      exact: true,
    }),
  ).toBeVisible();
  const output = join(directory, "selected-lesson.html");
  await app.evaluate(({ dialog }, filePath) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath });
  }, output);
  await dialog
    .getByRole("button", { name: "Save offline textbook", exact: true })
    .click();
  await expect(dialog.getByRole("status")).toContainText(
    "Standalone HTML saved",
  );
  expect(existsSync(output)).toBe(true);
  const html = readFileSync(output, "utf8");
  expect(html).not.toContain("PRIVATE_NOTE_NOT_SELECTED_FOR_EXPORT");
  expect(html).toContain("The shape of change");
  expect(html).toContain("studio-book-data");
  mkdirSync("docs/screenshots", { recursive: true });
  await page.screenshot({ path: "docs/screenshots/v2-export-preview.png" });
});
test("living textbook retains user edits when a concurrent writer advances the chapter revision", async () => {
  await openDestination(page, "Subject workspaces: My learning");
  await page.getByRole("button", { name: "New subject", exact: true }).click();
  await page
    .getByLabel("Subject workspace name", { exact: true })
    .fill("A coherent subject");
  await page
    .getByLabel("Subject learning objective", { exact: true })
    .fill("Connect local change to mathematical models");
  await page
    .getByRole("button", { name: "Create subject", exact: true })
    .click();
  const subject = (await call<Subject[]>("subject:list")).find(
    (item) => item.name === "A coherent subject",
  )!;
  await openDestination(page, "Textbook");
  await page.getByRole("button", { name: "New chapter", exact: true }).click();
  await page
    .getByLabel("Chapter title", { exact: true })
    .fill("A chapter of connections");
  await page
    .getByLabel("Chapter Markdown", { exact: true })
    .fill(
      "## Start from an idea\n\nA user-authored explanation with $f(x)=x^2$.",
    );
  await page.getByRole("button", { name: "Save chapter", exact: true }).click();
  await expect(page.locator(".v2-chapter-preview h1")).toHaveText(
    "A chapter of connections",
  );
  const records = await call<SubjectRecord<TextbookChapter>[]>(
    "subject:record-list",
    { subjectId: subject.id, recordType: "chapter", includeData: true },
  );
  const chapter = records.find(
    (record) => record.title === "A chapter of connections",
  )!;
  await page.getByRole("button", { name: "Edit chapter", exact: true }).click();
  await page
    .getByLabel("Chapter Markdown", { exact: true })
    .fill("UNSAVED_USER_DRAFT_MUST_REMAIN");
  await call("subject:record-put", {
    subjectId: subject.id,
    recordType: "chapter",
    id: chapter.id,
    title: chapter.title,
    data: { ...chapter.data, markdown: "NEWER_CANONICAL_REVISION" },
    expectedRevision: chapter.revision,
  });
  await page.getByRole("button", { name: "Save chapter", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText(
    "Your draft is still here",
  );
  await expect(
    page.getByLabel("Chapter Markdown", { exact: true }),
  ).toHaveValue("UNSAVED_USER_DRAFT_MUST_REMAIN");
  const stored = await call<SubjectRecord<TextbookChapter>>(
    "subject:record-get",
    { subjectId: subject.id, id: chapter.id },
  );
  expect(stored.data.markdown).toBe("NEWER_CANONICAL_REVISION");
  await page
    .getByRole("button", { name: "Reload saved chapter", exact: true })
    .click();
  await expect(page.locator(".v2-chapter-preview")).toContainText(
    "NEWER_CANONICAL_REVISION",
  );
});

test("document study retains original PDF bytes, requires actual page excerpts, and saves genuine page provenance", async () => {
  const subject = await createSubject("Reading with sources");
  const path = join(directory, "authored-source.pdf"),
    bytes = sourcePdf();
  writeFileSync(path, bytes);
  await app.evaluate(({ dialog }, file) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [file],
    });
  }, path);
  await page
    .locator(".main-nav")
    .getByRole("button", { name: /Your library/ })
    .click();
  await page
    .getByRole("button", { name: "Import document", exact: true })
    .click();
  await expect(
    page.getByRole("button", {
      name: "Study beside a conversation",
      exact: true,
    }),
  ).toBeVisible({ timeout: 40000 });
  const data = await call<StudioData>("data:load"),
    resource = data.library.find(
      (item) =>
        item.kind === "document" &&
        item.source?.endsWith("authored-source.pdf"),
    ) as LibraryItem;
  expect(resource.sourceAssetId).toMatch(/^[a-f0-9]{64}$/);
  const url = await call<string>("documents:pdf-url", {
    resourceId: resource.id,
  });
  expect(Buffer.from(url.split(",")[1], "base64").equals(bytes)).toBe(true);
  await page
    .getByRole("button", { name: "Study beside a conversation", exact: true })
    .click();
  await customizeTypography();
  await expectReading(".v2-document-page-text");
  await expect(page.getByLabel("Document page", { exact: true })).toHaveValue(
    "1",
  );
  await page
    .getByLabel("Selected document excerpt", { exact: true })
    .fill("THIS_PASSAGE_DOES_NOT_EXIST");
  await expect(
    page.getByRole("button", { name: "Save cited excerpt", exact: true }),
  ).toBeDisabled();
  await page.getByLabel("Document page", { exact: true }).selectOption("2");
  const excerpt = "A second page states a different assumption.";
  await page
    .getByLabel("Selected document excerpt", { exact: true })
    .fill(excerpt);
  await expect(
    page.getByRole("button", { name: "Save cited excerpt", exact: true }),
  ).toBeEnabled();
  await page
    .getByRole("button", { name: "Save cited excerpt", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Add cited excerpt to textbook", exact: true })
    .click();
  await expect
    .poll(async () => {
      const records = await call<SubjectRecord<TextbookChapter>[]>(
        "subject:record-list",
        { subjectId: subject.id, recordType: "chapter", includeData: true },
      );
      return records.find((record) => record.data?.markdown === excerpt)?.data
        .citations[0]?.page;
    })
    .toBe(2);
  await page.getByRole("button", { name: "Original PDF", exact: true }).click();
  const pdf = page.getByRole("region", {
    name: "Original PDF document",
    exact: true,
  });
  await expect(
    pdf.getByRole("img", { name: "Original PDF page 2", exact: true }),
  ).toBeVisible();
  await expect(pdf.getByRole("status")).toHaveCount(0);
  await expect(pdf.getByRole("alert")).toHaveCount(0);
  await expect
    .poll(() =>
      pdf.locator("canvas").evaluate((element) => {
        const canvas = element as HTMLCanvasElement;
        const context = canvas.getContext("2d")!,
          pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
        let ink = 0;
        for (let i = 0; i < pixels.length; i += 4)
          if (
            pixels[i] < 150 &&
            pixels[i + 1] < 150 &&
            pixels[i + 2] < 150 &&
            pixels[i + 3] > 0
          )
            ink++;
        return ink;
      }),
    )
    .toBeGreaterThan(50);
  const prior = await pdf
    .locator("canvas")
    .evaluate((canvas) => (canvas as HTMLCanvasElement).width);
  await pdf.getByRole("button", { name: "Zoom in PDF", exact: true }).click();
  await expect
    .poll(() =>
      pdf
        .locator("canvas")
        .evaluate((canvas) => (canvas as HTMLCanvasElement).width),
    )
    .toBeGreaterThan(prior);
  await page.screenshot({ path: "docs/screenshots/v2-document-study.png" });
  await page
    .getByRole("button", { name: "Subject dashboard", exact: true })
    .click();
  await page.getByRole("button", { name: "Export", exact: true }).click();
  const exportDialog = page.getByRole("dialog", {
    name: "Export interactive textbook",
    exact: true,
  });
  await exportDialog
    .getByRole("checkbox", {
      name: "Resource · authored-source.pdf document · source status unchanged",
      exact: true,
    })
    .uncheck();
  await exportDialog
    .getByRole("button", { name: "Preview export", exact: true })
    .click();
  const edition = page.frameLocator(
    'iframe[title="Standalone textbook preview"]',
  );
  await expect(
    edition.getByRole("heading", {
      name: /Reading with sources textbook/,
      exact: true,
    }),
  ).toBeVisible();
  const portableData = await edition.locator("#studio-book-data").textContent();
  expect(portableData).not.toContain(
    "A measured interval connects an observed change",
  );
  expect(portableData).toContain(excerpt);
});

test("equation explorer and selection tools preserve the lesson after a disconnected contextual request", async () => {
  await seedReferenceLesson(page);
  await expect(page.locator(".lesson-top h1")).toHaveText(
    "The shape of change",
  );
  await expect
    .poll(async () => {
      const data = await call<StudioData>("data:load");
      return data.lessons.some((lesson) => lesson.id === data.activeLessonId);
    })
    .toBe(true);
  const before = await call<StudioData>("data:load"),
    lesson = before.lessons.find((item) => item.id === before.activeLessonId)!;
  await page
    .locator(".lesson-reader .katex .katex-html .mathnormal")
    .first()
    .click();
  const inspector = page.getByRole("complementary", {
    name: "Equation explorer",
    exact: true,
  });
  await expect(inspector).toBeVisible();
  await expect(
    inspector.getByText(/Symbols and units depend on the surrounding subject/),
  ).toBeVisible();
  await inspector
    .getByRole("button", { name: "Units & dimensions", exact: true })
    .click();
  await expect(inspector.getByRole("alert")).toBeVisible();
  const after = await call<StudioData>("data:load"),
    same = after.lessons.find((item) => item.id === lesson.id)!;
  expect(same.messages).toEqual(lesson.messages);
  expect(same.position).toBe(lesson.position);
  expect(same.objective).toBe(lesson.objective);
  await page.screenshot({ path: "docs/screenshots/v2-context-tools.png" });
  await inspector
    .getByRole("button", { name: "Close contextual explanation", exact: true })
    .click();
  await page.evaluate(() => {
    const paragraph = document.querySelector(".lesson-reader .markdown p");
    if (!paragraph) throw new Error("No rendered lesson paragraph.");
    const range = document.createRange();
    range.selectNodeContents(paragraph);
    const selected = window.getSelection()!;
    selected.removeAllRanges();
    selected.addRange(range);
    paragraph.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  });
  await expect(
    page
      .getByRole("toolbar", {
        name: "Selected text learning actions",
        exact: true,
      })
      .getByText("Selected passage", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Close selection tools", exact: true })
    .click();
  await openTutor(page);
  await expect(
    page.getByRole("textbox", { name: "Message the tutor", exact: true }),
  ).toBeVisible();
});

test("living textbook applies customized reading typography to prose, headings, and mathematics immediately", async () => {
  await createSubject("A personal reading appearance");
  await openDestination(page, "Textbook");
  await page.getByRole("button", { name: "New chapter", exact: true }).click();
  await page
    .getByLabel("Chapter title", { exact: true })
    .fill("Readable mathematics");
  await page
    .getByLabel("Chapter Markdown", { exact: true })
    .fill(
      "## A careful argument\n\nKeep **meaning** and *assumptions* beside $f(x)=x^2$.",
    );
  await page.getByRole("button", { name: "Save chapter", exact: true }).click();
  await customizeTypography();
  await expectReading(".v2-chapter-preview");
  await expectReading(".v2-chapter-preview .markdown p");
  await expect
    .poll(() =>
      page
        .locator(".v2-chapter-preview h1")
        .evaluate((element) => getComputedStyle(element).fontWeight),
    )
    .toBe("700");
  await expect
    .poll(() =>
      page
        .locator(".v2-chapter-preview .katex")
        .evaluate((element) => parseFloat(getComputedStyle(element).fontSize)),
    )
    .toBeGreaterThan(20);
  await page.screenshot({
    path: "docs/screenshots/v2-textbook-typography.png",
  });
});

test("an explicitly synthetic provider fixture renders a calculated contextual graph without a real model or account", async () => {
  // This fixture tests typed-block UI orchestration only. It does not claim
  // successful OAuth, provider capability, or a live teaching response.
  await app.evaluate(({ ipcMain }) => {
    const handlers = (
      ipcMain as unknown as {
        _invokeHandlers: Map<string, (...args: unknown[]) => unknown>;
      }
    )._invokeHandlers;
    const original = handlers.get("studio:invoke");
    if (!original) throw new Error("Native invoke handler missing.");
    ipcMain.removeHandler("studio:invoke");
    ipcMain.handle("studio:invoke", async (event, action, payload) => {
      if (action === "auth:status")
        return {
          connected: true,
          account: "SYNTHETIC TEST FIXTURE · no actual account",
        };
      if (action === "auth:models")
        return [
          {
            id: "fixture-tutor",
            name: "Synthetic UI fixture",
            reasoningLevels: [],
          },
        ];
      if (action === "model:send")
        return JSON.stringify({
          text: "This is an authored provider fixture for typed visualization testing.",
          blocks: [
            {
              type: "plot",
              spec: {
                kind: "derivative",
                title: "A contextual tangent",
                xLabel: "x",
                yLabel: "f(x)",
              },
            },
          ],
        });
      return original(event, action, payload);
    });
  });
  await page
    .locator(".sidebar-bottom")
    .getByRole("button", { name: "Settings", exact: true })
    .click();
  await page
    .getByRole("button", {
      name: "Account & models: Connections and model choices",
      exact: true,
    })
    .click();
  await page
    .getByRole("button", { name: "Refresh models", exact: true })
    .click();
  await expect(
    page.getByText("SYNTHETIC TEST FIXTURE · no actual account", {
      exact: true,
    }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Close settings", exact: true })
    .click();
  await seedReferenceLesson(page);
  await expect(page.locator(".lesson-top h1")).toHaveText(
    "The shape of change",
  );
  await expect
    .poll(async () => {
      const data = await call<StudioData>("data:load");
      return data.lessons.some(
        (lesson) => lesson.id === data.activeLessonId && !!lesson.subjectId,
      );
    })
    .toBe(true);
  const before = await call<StudioData>("data:load"),
    lesson = before.lessons.find((item) => item.id === before.activeLessonId)!;
  await page
    .locator(".lesson-reader .katex .katex-html .mathnormal")
    .first()
    .click();
  await page
    .getByRole("toolbar", {
      name: "Selected text learning actions",
      exact: true,
    })
    .getByRole("button", { name: "Visualize", exact: true })
    .click();
  const pane = page.getByRole("complementary", {
    name: "Equation explorer",
    exact: true,
  });
  await expect(pane.locator(".plot-canvas .main-svg").first()).toBeVisible();
  await pane
    .getByRole("slider", { name: "Tangent at x", exact: true })
    .press("End");
  await expect
    .poll(() =>
      pane.locator(".plot-canvas").evaluate((element) => {
        const trace = (
          element as unknown as { data: { x: number[]; y: number[] }[] }
        ).data[1];
        return (trace.y.at(-1)! - trace.y[0]) / (trace.x.at(-1)! - trace.x[0]);
      }),
    )
    .toBeCloseTo(6, 5);
  await expect
    .poll(async () => {
      const records = await call<
        SubjectRecord<{
          title: string;
          originMessageId?: string;
          state: Record<string, unknown>;
        }>[]
      >("subject:record-list", {
        subjectId: lesson.subjectId,
        recordType: "visual",
        includeData: true,
      });
      return records.some(
        (record) =>
          record.data.title === "A contextual tangent" &&
          record.data.originMessageId === lesson.messages[0].id &&
          (record.data.state["plot.parameters"] as { point?: number })
            ?.point === 3,
      );
    })
    .toBe(true);
  const after = await call<StudioData>("data:load");
  expect(after.lessons.find((item) => item.id === lesson.id)!.messages).toEqual(
    lesson.messages,
  );
});
