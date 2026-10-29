import { createLearningSession } from "./learning-fixtures";
import { openDestination } from "./ui-navigation";
import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page,
} from "@playwright/test";
import { createServer, type Server } from "node:http";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { ProviderListing, ProviderUsage } from "../src/providerTypes";
import type { StudioData } from "../src/types";

// The actual Windows Electron app talks to a real loopback HTTP fixture. No
// local language model is installed, no account is connected and no billing occurs.
let app: ElectronApplication, page: Page, directory: string, server: Server;
const calls: { url: string; body: unknown; authorization?: string }[] = [];
let url: string;
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
    window.setContentSize(1500, 1100);
    window.webContents.setBackgroundThrottling(false);
  });
  await expect(
    page.getByRole("navigation", { name: "Main navigation", exact: true }),
  ).toBeVisible();
}
const call = <T = unknown>(action: string, payload?: unknown) =>
  page.evaluate(
    ({ action, payload }) => window.studio!.invoke<T>(action, payload),
    { action, payload },
  );
async function openSettings() {
  await page
    .getByRole("banner")
    .getByRole("button", { name: "Settings", exact: true })
    .click();
  const dialog = page.getByRole("region", { name: "Settings", exact: true });
  await dialog
    .getByRole("button", {
      name: "Account & models: Connections and model choices",
      exact: true,
    })
    .click();
  return dialog;
}
test.beforeEach(async () => {
  calls.length = 0;
  await mkdir(".tools", { recursive: true });
  directory = await mkdtemp(join(resolve(".tools"), "provider-ui-"));
  server = createServer(async (req, res) => {
    let body = "";
    for await (const part of req) body += part.toString();
    calls.push({
      url: req.url!,
      body: body ? JSON.parse(body) : null,
      authorization: req.headers.authorization,
    });
    if (req.url === "/api/tags") {
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({
          models: [{ model: "acceptance-fixture", name: "acceptance-fixture" }],
        }),
      );
      return;
    }
    if (req.url === "/api/chat") {
      const content = JSON.stringify({
        content: [
          {
            type: "text",
            text: "This explicit loopback fixture verifies the provider connection. It is not a real model response.",
          },
          {
            type: "plot",
            spec: { kind: "derivative", title: "A calculated fixture figure" },
          },
        ],
      });
      res.setHeader("Content-Type", "application/x-ndjson");
      res.write(
        JSON.stringify({
          message: { content: content.slice(0, 70) },
          done: false,
        }) + "\n",
      );
      setTimeout(
        () =>
          res.end(
            JSON.stringify({
              message: { content: content.slice(70) },
              done: true,
              done_reason: "stop",
              prompt_eval_count: 12,
              eval_count: 9,
            }) + "\n",
          ),
        150,
      );
      return;
    }
    res.statusCode = 404;
    res.end("missing");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  await launch();
});
test.afterEach(async () => {
  await app?.close().catch(() => {});
  await new Promise<void>((resolve) => server?.close(() => resolve()));
  if (!resolve(directory).startsWith(join(resolve(".tools"), "provider-ui-")))
    throw new Error("Unexpected provider fixture cleanup path");
  await rm(directory, {
    recursive: true,
    force: true,
    maxRetries: 8,
    retryDelay: 100,
  });
});

test("provider provisioning preserves ChatGPT by default, explicit local selection streams through real IPC and survives restart, and quota is honest", async () => {
  const initial = await call<ProviderListing>("providers:list");
  expect(initial.activeId).toBe("chatgpt");
  const dialog = await openSettings();
  await dialog
    .getByRole("button", { name: "Add provider", exact: true })
    .click();
  await dialog
    .getByLabel("Provider connection name", { exact: true })
    .fill("Explicit local HTTP fixture");
  await dialog.getByLabel("Provider server URL", { exact: true }).fill(url);
  await dialog
    .getByRole("button", { name: "Save connection", exact: true })
    .click();
  await expect(dialog.getByRole("status")).toContainText("Provider saved");
  expect((await call<ProviderListing>("providers:list")).activeId).toBe(
    "chatgpt",
  );
  expect(calls.filter((call) => call.url === "/api/chat")).toHaveLength(0);
  await dialog
    .getByRole("button", {
      name: "Use Explicit local HTTP fixture",
      exact: true,
    })
    .click();
  await expect
    .poll(() =>
      call<ProviderListing>("providers:list").then((value) => value.activeId),
    )
    .not.toBe("chatgpt");
  await expect(dialog.getByLabel("tutor model", { exact: true })).toContainText(
    "acceptance-fixture",
  );
  const option = await dialog
    .getByLabel("tutor model", { exact: true })
    .locator("option")
    .filter({ hasText: "acceptance-fixture" })
    .getAttribute("value");
  await dialog.getByLabel("tutor model", { exact: true }).selectOption(option!);
  await page
    .getByRole("button", { name: "Close settings", exact: true })
    .click();
  await createLearningSession(
    page,
    "Inspect the explicit provider connection fixture",
  );
  await expect(page.locator(".lesson-message.assistant").last()).toContainText(
    "explicit loopback fixture",
    { timeout: 30000 },
  );
  await expect(
    page
      .locator(".lesson-message.assistant")
      .last()
      .locator(".plot-canvas .main-svg")
      .first(),
  ).toBeVisible();
  expect(calls.some((call) => call.url === "/api/chat")).toBe(true);
  expect(calls.every((call) => !call.authorization)).toBe(true);
  const usage = await call<ProviderUsage>("providers:usage");
  expect(usage.kind).toBe("ollama");
  expect(usage.observed).toMatchObject({
    completedRequests: 1,
    inputTokens: 12,
    outputTokens: 9,
  });
  const data = await call<StudioData>("data:load");
  expect(JSON.stringify(data)).not.toContain("apiKey");
  await mkdir("docs/screenshots", { recursive: true });
  await page.screenshot({
    path: "docs/screenshots/2.2-local-provider-fixture.png",
  });
  await app.close();
  await launch();
  await openDestination(page, "Learning workspace: Lesson");
  expect((await call<ProviderListing>("providers:list")).activeId).not.toBe(
    "chatgpt",
  );
  await expect(page.locator(".lesson-message.assistant").last()).toContainText(
    "explicit loopback fixture",
  );
  const reopened = await openSettings();
  await reopened
    .getByRole("button", { name: "Use ChatGPT subscription", exact: true })
    .click();
  await expect
    .poll(() =>
      call<ProviderListing>("providers:list").then((value) => value.activeId),
    )
    .toBe("chatgpt");
  const quota = await call<ProviderUsage>("providers:usage");
  expect(quota.planRemaining.available).toBe(false);
  await expect(
    reopened.getByRole("button", { name: "Open ChatGPT Usage", exact: true }),
  ).toBeVisible();
  await app.evaluate(({ shell }) => {
    (globalThis as any).__providerUsageLinks = [];
    shell.openExternal = async (url: string) => {
      (globalThis as any).__providerUsageLinks.push(url);
    };
  });
  await reopened
    .getByRole("button", { name: "Open ChatGPT Usage", exact: true })
    .click();
  expect(
    await app.evaluate(() => (globalThis as any).__providerUsageLinks),
  ).toEqual(["https://chatgpt.com/settings/usage"]);
  await expect(reopened.locator(".provider-quota-fact")).toContainText(
    "Not exposed",
  );
  await page.screenshot({
    path: "docs/screenshots/2.2-chatgpt-usage-honest.png",
  });
});

test("external-provider setup requires explicit billing consent and keeps keys out of learning exports", async () => {
  const dialog = await openSettings();
  await dialog
    .getByRole("button", { name: "Add provider", exact: true })
    .click();
  await dialog
    .getByLabel("Provider protocol", { exact: true })
    .selectOption("openai-compatible");
  await dialog
    .getByLabel("Provider connection name", { exact: true })
    .fill("Explicit remote configuration fixture");
  await dialog
    .getByLabel("Provider server URL", { exact: true })
    .fill("https://provider.example/v1");
  await dialog
    .getByLabel("Provider API key", { exact: true })
    .fill("FAKE_PROVIDER_KEY_FOR_ACCEPTANCE_ONLY");
  await expect(
    dialog.getByLabel("Consent to external provider billing and data transfer"),
  ).not.toBeChecked();
  await dialog
    .getByRole("button", { name: "Save connection", exact: true })
    .click();
  expect((await call<ProviderListing>("providers:list")).profiles).toHaveLength(
    1,
  );
  await dialog
    .getByLabel("Consent to external provider billing and data transfer")
    .check();
  await dialog
    .getByRole("button", { name: "Save connection", exact: true })
    .click();
  const listing = await call<ProviderListing>("providers:list");
  expect(listing.activeId).toBe("chatgpt");
  expect(listing.profiles[1].hasKey).toBe(true);
  expect(JSON.stringify(listing)).not.toContain("FAKE_PROVIDER_KEY");
  expect(JSON.stringify(await call("data:load"))).not.toContain(
    "FAKE_PROVIDER_KEY",
  );
  expect(calls).toHaveLength(0);
});
