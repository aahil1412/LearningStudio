import {
  openTutor,
  openDestination,
  openConversationRecord,
} from "./ui-navigation";
import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page,
} from "@playwright/test";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { build } from "esbuild";
import type { ContentBlock, Lesson, StudioData } from "../src/types";
import type { Subject } from "../src/v2types";

// Actual Electron, production request admission/cancellation and SQLite. Only the
// provider transport is controlled; these tests do not consume subscription usage.
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
    window.setContentSize(1530, 1120);
  });
  await expect(page.locator(".titlebar-center")).toHaveText("Saved locally");
}
const call = <T = unknown>(action: string, payload?: unknown) =>
  page.evaluate(
    ({ action, payload }) => window.studio!.invoke<T>(action, payload),
    { action, payload },
  );
async function seed() {
  const subject = await call<Subject>("subject:create", {
    name: "Progressive delivery acceptance fixture",
    objective: "Understand biological translation",
    depth: "overview",
  });
  const lesson = await call<Lesson>("subject:conversation-create", {
    subjectId: subject.id,
    title: "A response that becomes useful while it streams",
    mode: "Learn",
  });
  const data = await call<StudioData>("data:load");
  await call("data:save", {
    ...data,
    activeSubjectId: subject.id,
    activeLessonId: lesson.id,
    settings: {
      ...data.settings,
      personalization: false,
      teaching: {
        delivery: "visual-first",
        practice: "mcq",
        checkFrequency: "requested",
        sentenceStyle: "clean",
        avoidEmDashes: true,
      },
      models: {
        tutor: { model: "progressive-fixture", reasoning: "low" },
        visual: { model: "progressive-fixture", reasoning: "low" },
        review: { model: "progressive-fixture", reasoning: "low" },
      },
    },
  });
  return { subject, lesson };
}
async function provider(timeoutMs = 60000) {
  const fixture = join(directory, "production-request-service.cjs");
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
    ({ ipcMain, BrowserWindow }, { fixture, timeoutMs }) => {
      const production = process
        .getBuiltinModule("node:module")
        .createRequire(process.cwd() + "/package.json")(fixture);
      const window = BrowserWindow.getAllWindows()[0];
      const state: any = { pending: null, imageSearches: 0, calls: 0 };
      const service = new production.ModelRequestService({
        timeoutMs,
        onDelta: (event: any) =>
          window.webContents.send("studio:stream", event),
        onState: (event: any) =>
          window.webContents.send("studio:request-state", event),
        respond: (_request: any, onDelta: (delta: string) => void) => {
          state.calls++;
          return new Promise<string>((resolve, reject) => {
            state.pending = { raw: "", emit: onDelta, resolve, reject };
          });
        },
      });
      const original = (ipcMain as any)._invokeHandlers.get("studio:invoke");
      ipcMain.removeHandler("studio:invoke");
      ipcMain.handle("studio:invoke", (event, action, payload) => {
        if (action === "auth:status")
          return {
            connected: true,
            account: "Explicit progressive transport fixture; no live account",
          };
        if (action === "auth:models")
          return [
            {
              id: "progressive-fixture",
              name: "Progressive acceptance fixture",
              reasoningLevels: ["low"],
            },
          ];
        if (action === "model:send") return service.send(payload);
        if (action === "model:cancel") {
          service.cancel(payload.requestId);
          return true;
        }
        if (action === "images:search") {
          state.imageSearches++;
          throw new Error(
            "This fixture must not initiate an unsolicited image search.",
          );
        }
        return original(event, action, payload);
      });
      (globalThis as any).progressiveFixture = { state, service };
    },
    { fixture, timeoutMs },
  );
  await page.reload();
  await openDestination(page, "Learning workspace: Lesson");
  await expect(page.locator(".account-pill")).toContainText(
    "ChatGPT connected",
  );
}
async function send(question: string) {
  await openTutor(page);
  await page.getByLabel("Message the tutor").fill(question);
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await expect
    .poll(() =>
      app.evaluate(() =>
        Boolean((globalThis as any).progressiveFixture.state.pending),
      ),
    )
    .toBe(true);
}
async function emit(delta: string) {
  await app.evaluate((_, delta) => {
    const pending = (globalThis as any).progressiveFixture.state.pending;
    pending.raw += delta;
    pending.emit(delta);
  }, delta);
}
async function finish() {
  await app.evaluate(() => {
    const fixture = (globalThis as any).progressiveFixture;
    const pending = fixture.state.pending;
    fixture.state.pending = null;
    pending.resolve(pending.raw);
  });
}
const plot: ContentBlock = {
  type: "plot",
  spec: {
    kind: "wave",
    title: "Explicit fixture curve with durable parameters",
  },
};
test.beforeEach(async () => {
  await mkdir(".tools", { recursive: true });
  directory = await mkdtemp(join(resolve(".tools"), "progressive-tutor-"));
  await launch();
});
test.afterEach(async () => {
  await app
    ?.evaluate(() =>
      (globalThis as any).progressiveFixture?.service.cancelAll(
        "Acceptance fixture closing",
      ),
    )
    .catch(() => {});
  await app?.close().catch(() => {});
  if (
    !resolve(directory).startsWith(
      join(resolve(".tools"), "progressive-tutor-"),
    )
  )
    throw new Error("Unexpected fixture cleanup path.");
  await rm(directory, {
    recursive: true,
    force: true,
    maxRetries: 8,
    retryDelay: 200,
  });
});

test("validated figures appear before completion, with no raw protocol or unsolicited retrieval, and keep the same live DOM after final definition reordering", async () => {
  const { lesson } = await seed();
  await provider();
  await send(
    "Explain biological translation from the beginning and include an optional MCQ.",
  );
  const message = page.locator(".lesson-message.assistant").last();
  await emit(
    '{"content":[{"type":"text","text":"We can follow how RNA instructions become a protein',
  );
  await expect(message).toContainText(
    "We can follow how RNA instructions become a protein",
  );
  await expect(message).not.toContainText('"content"');
  const illustration: ContentBlock = {
    type: "illustration",
    spec: {
      template: "translation",
      title: "Codon recognition during translation",
    },
  };
  const unsolicited: ContentBlock = {
    type: "image",
    query: "unrelated automatic image lookup",
  };
  const checkpoint: ContentBlock = {
    type: "mcq",
    id: "progressive-adaptor-check",
    question: "Which molecule carries an amino acid while matching a codon?",
    choices: [
      { id: "trna", text: "A transfer RNA adaptor" },
      { id: "dna", text: "A DNA chromosome inside the ribosome" },
    ],
    correctChoiceIds: ["trna"],
    explanation:
      "The tRNA pairs its anticodon with the mRNA codon and carries an amino acid.",
    allowUnknown: true,
  };
  await emit(
    '."},' +
      [unsolicited, illustration, plot, checkpoint]
        .map((block) => JSON.stringify(block))
        .join(",") +
      ",",
  );
  const host = page.locator("[data-visual-host]").filter({
    has: page.getByRole("heading", {
      name: "Explicit fixture curve with durable parameters",
      exact: true,
    }),
  });
  await expect(host.locator(".plot-canvas .main-svg").first()).toBeVisible();
  await expect(message.locator(".translation-svg")).toBeVisible();
  await expect(message.locator(".teaching-terms").first()).toContainText(
    "codon",
  );
  await expect(message.locator(".teaching-terms").first()).toContainText(
    "ribosome",
  );
  expect(
    await message.evaluate((element) =>
      Boolean(
        element
          .querySelector(".teaching-terms")!
          .compareDocumentPosition(element.querySelector(".translation-svg")!) &
        Node.DOCUMENT_POSITION_FOLLOWING,
      ),
    ),
  ).toBe(true);
  const mcq = message.locator(".mcq-checkpoint");
  await expect(mcq.getByRole("radio").first()).toBeDisabled();
  await expect(
    mcq.getByRole("button", { name: "Skip checkpoint", exact: true }),
  ).toBeDisabled();
  const savedPendingIndex = async () =>
    (await call<StudioData>("data:load")).lessons
      .find((item) => item.id === lesson.id)
      ?.messages.at(-1)
      ?.content?.findIndex(
        (block) =>
          block.type === "mcq" && block.id === "progressive-adaptor-check",
      ) ?? -1;
  await expect.poll(savedPendingIndex).toBeGreaterThanOrEqual(0);
  const streamedIndex = await savedPendingIndex();
  const fit = await message.locator(".translation-svg").evaluate((svg) => {
    const viewport = svg.closest(".science-viewport")!;
    return {
      visualWidth: svg.getBoundingClientRect().width,
      viewportWidth: viewport.getBoundingClientRect().width,
      scrollWidth: viewport.scrollWidth,
      clientWidth: viewport.clientWidth,
    };
  });
  expect(fit.visualWidth).toBeLessThanOrEqual(fit.viewportWidth + 1);
  expect(fit.scrollWidth).toBeLessThanOrEqual(fit.clientWidth + 1);
  await expect(
    page.getByRole("button", { name: "Cancel response", exact: true }),
  ).toBeVisible();
  expect(
    await app.evaluate(
      () => (globalThis as any).progressiveFixture.service.foregroundCount,
    ),
  ).toBe(1);
  await host
    .getByRole("slider", { name: "Amplitude", exact: true })
    .fill("1.8");
  await host.evaluate((element) => {
    (window as any).__streamHost = element;
    (window as any).__streamPlot = element.querySelector(".plot-canvas");
  });
  const visualId = await host.getAttribute("data-visual-host");
  await mkdir("docs/screenshots", { recursive: true });
  // Capture the native viewport. A tall element inside the scrolling reader
  // would produce an image of its clipped ancestors rather than the lesson.
  await message.locator(".translation-svg").scrollIntoViewIfNeeded();
  await page.screenshot({
    path: "docs/screenshots/2.1.2-progressive-tutor-before-completion.png",
  });
  await host
    .getByRole("button", { name: "Move visual fullscreen", exact: true })
    .click();
  await page.screenshot({
    path: "docs/screenshots/2.1.2-progressive-plot-before-completion.png",
  });
  await host
    .getByRole("button", { name: "Move visual inline", exact: true })
    .click();
  await emit(
    JSON.stringify({
      type: "terms",
      items: [
        {
          term: "Codon",
          definition:
            "A group of three messenger RNA bases that specifies an amino acid or a stop signal.",
        },
        {
          term: "Anticodon",
          definition:
            "Three transfer RNA bases that pair with a complementary codon.",
        },
      ],
    }) +
      "," +
      JSON.stringify({
        type: "text",
        text: "The ribosome selects a tRNA through codon–anticodon pairing. This is an explicit transport fixture, not a live model response.",
      }) +
      "]}",
  );
  await message.locator(".translation-svg").scrollIntoViewIfNeeded();
  const readingTop = (await message.locator(".translation-svg").boundingBox())!
    .y;
  await finish();
  await expect(
    page.getByRole("button", { name: "Cancel response", exact: true }),
  ).toHaveCount(0);
  // Completing a streamed reply must not forcibly jump from the figure being
  // studied to the bottom checkpoint. Small inserted-header reflow is allowed.
  const completedTop = (await message
    .locator(".translation-svg")
    .boundingBox())!.y;
  expect(Math.abs(completedTop - readingTop)).toBeLessThan(260);
  await expect(message.locator(".teaching-terms")).toContainText("ribosome");
  await expect(mcq.getByRole("radio").first()).toBeEnabled();
  await expect(host).toHaveAttribute("data-visual-host", visualId!);
  await expect(
    host.getByRole("slider", { name: "Amplitude", exact: true }),
  ).toHaveValue("1.8");
  expect(
    await host.evaluate(
      (element) =>
        element === (window as any).__streamHost &&
        element.querySelector(".plot-canvas") === (window as any).__streamPlot,
    ),
  ).toBe(true);
  expect(
    await app.evaluate(
      () => (globalThis as any).progressiveFixture.state.imageSearches,
    ),
  ).toBe(0);
  await expect(
    message.locator(".image-viewport,[aria-label='Search educational images']"),
  ).toHaveCount(0);
  await expect(message).not.toContainText('"type"');
  await expect
    .poll(
      async () =>
        (await call<StudioData>("data:load")).lessons
          .find((item) => item.id === lesson.id)
          ?.messages.at(-1)?.status,
    )
    .toBe("complete");
  const completed = (await call<StudioData>("data:load")).lessons.find(
    (item) => item.id === lesson.id,
  )!;
  const finalMessage = completed.messages.at(-1)!;
  const finalIndex = finalMessage.content!.findIndex(
    (block) => block.type === "mcq" && block.id === "progressive-adaptor-check",
  );
  // Final concept insertion shifts the checkpoint, so a prior numeric index
  // must not be used for canonical grading or stored review provenance.
  expect(finalIndex).toBeGreaterThan(streamedIndex);
  await mcq.getByRole("radio").first().check();
  await mcq.getByRole("button", { name: "Check answer", exact: true }).click();
  await expect(mcq.locator(".mcq-feedback")).toContainText(
    "Correct for this checkpoint",
  );
  await expect
    .poll(async () => {
      const saved = (await call<StudioData>("data:load")).lessons.find(
        (item) => item.id === lesson.id,
      )!;
      return saved.exerciseResponses?.[`${finalMessage.id}:${finalIndex}`]
        ?.answer;
    })
    .toContain('"selected":["trna"]');
  const canonical = await call<StudioData>("data:load");
  expect(
    canonical.reviewHistory?.some(
      (attempt) => attempt.correct && attempt.answer === "trna",
    ),
  ).toBe(true);
  await app.close();
  await launch();
  await openDestination(page, "Learning workspace: Lesson");
  await expect(
    page.getByRole("slider", { name: "Amplitude", exact: true }),
  ).toHaveValue("1.8");
  await expect(page.locator(".mcq-feedback")).toContainText(
    "Correct for this checkpoint",
  );
});

for (const interruption of ["cancel", "deadline"] as const) {
  test(`${interruption} preserves validated streamed content and interactive state, supports a later message and survives restart`, async () => {
    const { lesson } = await seed();
    await provider(interruption === "deadline" ? 6000 : 60000);
    await send("Explain a simple oscillating system.");
    const message = page.locator(".lesson-message.assistant").last();
    await emit(
      '{"content":[' +
        JSON.stringify({
          type: "text",
          text: "An oscillation repeats around an equilibrium position.",
        }) +
        "," +
        JSON.stringify(plot) +
        ',{"type":"plot","spec":{"kind":"',
    );
    const host = message.locator("[data-visual-host]").first();
    await expect(
      host.getByRole("slider", { name: "Amplitude", exact: true }),
    ).toBeVisible();
    await host
      .getByRole("slider", { name: "Amplitude", exact: true })
      .fill("2.1");
    if (interruption === "cancel")
      await page
        .getByRole("button", { name: "Cancel response", exact: true })
        .click();
    await expect(message.getByRole("alert")).toContainText(
      "Partial work is preserved",
      { timeout: 12000 },
    );
    await expect(message).toContainText(
      "An oscillation repeats around an equilibrium position.",
    );
    await expect(message).not.toContainText('"content"');
    await expect(message).not.toContainText('"spec"');
    await expect(
      host.getByRole("slider", { name: "Amplitude", exact: true }),
    ).toHaveValue("2.1");
    await openTutor(page);
    await expect(page.getByLabel("Message the tutor")).toBeEnabled();
    await app.evaluate(() => {
      (globalThis as any).progressiveFixture.state.pending = null;
    });
    await send("Continue with a short explanation.");
    await emit(
      JSON.stringify({
        content: [
          {
            type: "text",
            text: "The saved first explanation is still available. This new request remains usable.",
          },
        ],
      }),
    );
    await finish();
    await expect(
      page.locator(".lesson-message.assistant").last(),
    ).toContainText("This new request remains usable.");
    await expect
      .poll(
        async () =>
          (await call<StudioData>("data:load")).lessons
            .find((item) => item.id === lesson.id)
            ?.messages.at(-1)?.status,
      )
      .toBe("complete");
    await app.close();
    await launch();
    await openConversationRecord(page);
    await expect(
      page.locator(".lesson-message.assistant").first(),
    ).toContainText("An oscillation repeats around an equilibrium position.");
    await expect(
      page.getByRole("slider", { name: "Amplitude", exact: true }),
    ).toHaveValue("2.1");
    await expect(
      page.getByRole("button", { name: "Cancel response", exact: true }),
    ).toHaveCount(0);
  });
}
