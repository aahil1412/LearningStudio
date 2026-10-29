import { openDestination } from "./ui-navigation";
import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
} from "@playwright/test";
import { mkdtemp, readFile, mkdir, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { StudioData, ContentBlock, Lesson } from "../src/types";
import { defaultTeachingPreferences } from "../src/v21types";
import { prepareTeachingContent } from "../src/lib/teachingController";
import { sanitizeAppearance } from "../src/lib/themes";

// Actual Electron renderer with recorded authorized live-model content, not a
// new inference. The image case adds a new explicit search instruction under
// the current authored-first policy and performs real public licensed retrieval.
test("renders the recorded biology outputs with repaired figures and actual image fallback", async () => {
  test.setTimeout(120000);
  const output = resolve("docs/repair-desktop"),
    directory = await mkdtemp(join(resolve(".tools"), "repair-rendering-"));
  await mkdir(output, { recursive: true });
  const baseline = JSON.parse(
    await readFile("tests/fixtures/biology-teaching.json", "utf8"),
  ) as {
    cases: {
      id: string;
      question: string;
      title: string;
      rawContent?: ContentBlock[];
    }[];
  };
  let app: ElectronApplication | undefined;
  try {
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
    const page = await app.firstWindow();
    // Keep test-only windows away from the learner's desktop. Playwright still
    // drives the production renderer's actual hit-tested controls through CDP.
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].setBounds({
        x: -20000,
        y: 0,
        width: 1540,
        height: 1320,
      }),
    );
    await expect(page.locator(".titlebar-center")).toHaveText("Saved locally");
    const invoke = <T = unknown>(action: string, payload?: unknown) =>
      page.evaluate(
        ({ action, payload }) => window.studio!.invoke<T>(action, payload),
        { action, payload },
      );
    const subject = await invoke<{ id: string }>("subject:create", {
      name: "Recorded live biology: repaired rendering",
      objective: "Inspect actual recorded beginner explanations",
      depth: "overview",
    });
    for (const id of ["membrane", "gene-to-protein", "photosynthesis"]) {
      const record = baseline.cases.find((c) => c.id === id)!;
      const lesson = await invoke<Lesson>("subject:conversation-create", {
        subjectId: subject.id,
        title: record.title,
        objective: record.question,
        mode: "Learn",
      });
      const content = prepareTeachingContent(
        { text: "", blocks: [], content: record.rawContent! },
        lesson,
        id === "photosynthesis"
          ? "Search for a sourced image of photosynthesis diagram"
          : record.question,
        defaultTeachingPreferences,
      );
      const data = await invoke<StudioData>("data:load");
      const at = new Date().toISOString();
      const appearance = sanitizeAppearance(data.appearance);
      appearance.mode = "light";
      await invoke("data:save", {
        ...data,
        appearance,
        activeSubjectId: subject.id,
        activeLessonId: lesson.id,
        lessons: data.lessons.map((l) =>
          l.id === lesson.id
            ? {
                ...l,
                messages: [
                  {
                    id: id + "-question",
                    role: "user",
                    text: record.question,
                    createdAt: at,
                    status: "complete",
                  },
                  {
                    id: id + "-answer",
                    role: "assistant",
                    text: "",
                    content,
                    createdAt: at,
                    status: "complete",
                  },
                ],
              }
            : l,
        ),
      });
      await page.reload();
      await openDestination(page, "Learning workspace: Lesson");
      await expect(page.locator(".titlebar-center")).toHaveText(
        "Saved locally",
      );
      const inlineHost = page
        .locator('[data-message-id="' + id + '-answer"] [data-visual-host]')
        .first();
      await expect(inlineHost).toBeVisible();
      const hostId = await inlineHost.getAttribute("data-visual-host");
      const host = page.locator('[data-visual-host="' + hostId + '"]');
      if (id === "photosynthesis") {
        await expect(host).toContainText("Licensed image retrieval", {
          timeout: 60000,
        });
        await expect
          .poll(
            () =>
              host
                .locator(".image-viewport img")
                .evaluateAll((imgs) =>
                  imgs.some(
                    (img) => (img as HTMLImageElement).naturalWidth > 0,
                  ),
                ),
            { timeout: 30000 },
          )
          .toBe(true);
        await expect(host).toContainText(/CC|Public domain|PD|GFDL/);
      } else {
        const colors = await host
          .locator(".scientific-svg")
          .evaluate((svg) =>
            [...svg.querySelectorAll("path,rect,circle")]
              .map((el) => getComputedStyle(el).stroke)
              .filter((color) => color !== "none"),
          );
        expect(new Set(colors).size).toBeGreaterThan(3);
      }
      await host
        .getByRole("button", { name: "Move visual fullscreen", exact: true })
        .click();
      await page.locator(".visual-dock-fullscreen").evaluate((el) => {
        el.scrollTop = 0;
      });
      await host.screenshot({
        path: join(output, id + "-actual-electron.png"),
        animations: "disabled",
      });
      await host
        .getByRole("button", { name: "Move visual inline", exact: true })
        .click();
      if (id === "gene-to-protein") {
        const message = page.locator(
          '[data-message-id="gene-to-protein-answer"]',
        );
        const text = await message.innerText();
        expect(text.indexOf("Transcription")).toBeLessThan(
          text.indexOf("A ribosome uses"),
        );
      }
    }
  } finally {
    if (app) await app.close();
    await rm(directory, { recursive: true, force: true });
  }
});
