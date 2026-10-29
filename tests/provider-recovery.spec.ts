import { createLearningSession } from "./learning-fixtures";
import { openDestination } from "./ui-navigation";
import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page,
} from "@playwright/test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { defaultData } from "../src/lib/defaults";
import type { StudioData } from "../src/types";

let app: ElectronApplication;
let page: Page;
let directory: string;
async function launch() {
  app = await electron.launch({
    args: ["."],
    cwd: process.cwd(),
    env: { ...process.env, STUDIO_DATA_DIR: directory },
    timeout: 30000,
  });
  page = await app.firstWindow();
  await expect(page.locator(".brand")).toContainText("Learning Studio");
  await expect(page.locator(".titlebar-center")).toContainText("Saved locally");
}
test.beforeEach(async () => {
  directory = await mkdtemp(join(process.cwd(), ".provider-test-"));
  await launch();
});
test.afterEach(async () => {
  await app?.close();
  await rm(directory, { recursive: true, force: true });
});

test("real IPC rejects disconnected and malformed model requests without changing the session", async () => {
  await createLearningSession(page, "Learn the humanities");
  await expect(page.locator(".lesson-top")).toContainText(
    "Learn the humanities",
  );
  await expect
    .poll(() =>
      page.evaluate(
        async () =>
          ((await window.studio!.invoke("data:load")) as StudioData).lessons
            .length,
      ),
    )
    .toBe(1);
  const before = await page.evaluate(async () =>
    window.studio!.invoke<StudioData>("data:load"),
  );
  const failures = await page.evaluate(async () => {
    const request = {
      requestId: "synthetic-failure",
      model: "unconnected-model",
      instructions: "Explain the broad learning objective.",
      input: [{ role: "user", content: "Begin" }],
    };
    const errors: string[] = [];
    for (let i = 0; i < 2; i++)
      try {
        await window.studio!.invoke("model:send", request);
      } catch (error) {
        errors.push(String(error));
      }
    try {
      await window.studio!.invoke("model:send", {
        ...request,
        input: [{ role: "system", content: "invalid role" }],
      });
    } catch (error) {
      errors.push(String(error));
    }
    return {
      errors,
      diagnostics: await window.studio!.invoke<{ activeRequests: number }>(
        "app:diagnostics",
      ),
      data: await window.studio!.invoke<StudioData>("data:load"),
    };
  });
  expect(
    failures.errors
      .slice(0, 2)
      .every((error) => error.includes("Connect ChatGPT")),
  ).toBe(true);
  expect(failures.errors[2]).toContain("malformed");
  expect(failures.diagnostics.activeRequests).toBe(0);
  expect(failures.data).toEqual(before);
  await page.getByRole("button", { name: "Notes", exact: true }).click();
  await page
    .getByLabel("Session notes")
    .fill("My broad goal remains usable after a failed request.");
  await expect
    .poll(() =>
      page.evaluate(
        async () =>
          ((await window.studio!.invoke("data:load")) as StudioData).lessons[0]
            .notes,
      ),
    )
    .toContain("remains usable");
  await page
    .getByRole("button", { name: "Close lesson notes", exact: true })
    .click();
  await page
    .getByLabel("Learning mode", { exact: true })
    .selectOption("Explore");
  await expect(page.getByLabel("Learning mode", { exact: true })).toHaveValue(
    "Explore",
  );
});

test("saved partial responses and malformed optional questions survive recovery without blocking the lesson", async () => {
  const data = defaultData();
  const now = new Date().toISOString();
  data.lessons.push({
    id: "recovery-lesson",
    title: "A recoverable learning session",
    subject: "Mathematics",
    mode: "Deep Dive",
    objective: "Understand derivatives",
    position: "Explain the limit",
    notes: "",
    createdAt: now,
    updatedAt: now,
    messages: [
      {
        id: "question",
        role: "user",
        text: "Explain derivatives",
        createdAt: now,
        status: "complete",
      },
      {
        id: "partial",
        role: "assistant",
        text: "A derivative is a local rate of change.",
        createdAt: now,
        status: "partial",
        error: "Simulated provider interruption for recovery testing.",
        blocks: [
          { type: "exercise", question: "" },
          { type: "equation", latex: "f'(x)=2x" },
        ],
      },
    ],
  });
  data.activeLessonId = "recovery-lesson";
  await page.evaluate(
    async (value) => window.studio!.invoke("data:save", value),
    data,
  );
  await page.reload();
  await openDestination(page, "Learning workspace: Lesson");
  await expect(
    page.getByRole("heading", {
      name: "A recoverable learning session",
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.getByRole("alert")).toContainText(
    "Partial work is preserved",
  );
  await expect(page.locator(".lesson-reader .katex").first()).toBeVisible();
  await expect(page.locator(".lesson-message.assistant")).toContainText(
    "local rate of change",
  );
  await expect(
    page.getByRole("button", { name: "Retry safely", exact: true }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Notes", exact: true }).click();
  await page.getByLabel("Session notes").fill("Recovery notes are retained.");
  await expect
    .poll(() =>
      page.evaluate(
        async () =>
          ((await window.studio!.invoke("data:load")) as StudioData).lessons[0]
            .notes,
      ),
    )
    .toBe("Recovery notes are retained.");
  await app.close();
  await launch();
  await openDestination(page, "Learning workspace: Lesson");
  await expect(page.locator(".lesson-message.assistant")).toContainText(
    "local rate of change",
  );
  const restored = await page.evaluate(async () =>
    window.studio!.invoke<StudioData>("data:load"),
  );
  expect(restored.lessons[0].notes).toBe("Recovery notes are retained.");
  expect(restored.lessons[0].messages[1].blocks).toHaveLength(1);
});

function minimalPdf(text: string): Buffer {
  const content = `BT /F1 14 Tf 50 750 Td (${text.replace(/[()\\]/g, "\\$&")}) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1))
    pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(pdf);
}

test("real PDF import extracts text, keeps provenance, and does not infer mastery", async () => {
  const pdf = join(directory, "educational-notes.pdf");
  await writeFile(pdf, minimalPdf("A source document about wave motion."));
  await app.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [path],
    });
  }, pdf);
  await page.getByRole("button", { name: /Your library/ }).click();
  await page
    .getByRole("button", { name: "Import document", exact: true })
    .click();
  await expect(page.locator(".lib-resource")).toContainText(
    "educational-notes.pdf",
    { timeout: 30000 },
  );
  await expect(page.locator(".lib-resource")).toContainText(
    "Imported · unverified",
  );
  await expect
    .poll(() =>
      page.evaluate(
        async () =>
          ((await window.studio!.invoke("data:load")) as StudioData).library[0]
            ?.content,
      ),
    )
    .toContain("wave motion");
  const imported = await page.evaluate(async () =>
    window.studio!.invoke<StudioData>("data:load"),
  );
  expect(imported.library[0].source).toBe("educational-notes.pdf");
  expect(imported.concepts).toEqual([]);
});

test("desktop isolation and Windows credential encryption are active", async () => {
  const security = await app.evaluate(({ BrowserWindow, safeStorage }) => {
    // Electron45 exposes this inspector at runtime, though its bundled public type omits it.
    const webContents = BrowserWindow.getAllWindows()[0]
      .webContents as unknown as {
      getLastWebPreferences: () => {
        sandbox: boolean;
        contextIsolation: boolean;
        nodeIntegration: boolean;
      };
    };
    const preferences = webContents.getLastWebPreferences();
    const encrypted = safeStorage.encryptString(
      "synthetic-encryption-verification",
    );
    return {
      sandbox: preferences.sandbox,
      contextIsolation: preferences.contextIsolation,
      nodeIntegration: preferences.nodeIntegration,
      encryptionAvailable: safeStorage.isEncryptionAvailable(),
      roundTrip: safeStorage.decryptString(encrypted),
      ciphertext: encrypted.toString("hex"),
    };
  });
  expect(security).toMatchObject({
    sandbox: true,
    contextIsolation: true,
    nodeIntegration: false,
    encryptionAvailable: true,
    roundTrip: "synthetic-encryption-verification",
  });
  expect(security.ciphertext).not.toBe(
    Buffer.from("synthetic-encryption-verification").toString("hex"),
  );
  const bridge = await page.evaluate(() => ({
    node: typeof process,
    methods: Object.keys(window.studio!),
  }));
  expect(bridge.node).toBe("undefined");
  expect(bridge.methods.sort()).toEqual([
    "importDroppedFiles",
    "invoke",
    "onCloseRequested",
    "onDataChanged",
    "onRequestState",
    "onStream",
    "platform",
  ]);
  await expect(
    page.evaluate(() =>
      window.studio!.invoke("external:open", "file:///C:/Windows"),
    ),
  ).rejects.toThrow("HTTPS");
});
