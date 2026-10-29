import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
} from "@playwright/test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { build } from "esbuild";
import { DatabaseSync } from "node:sqlite";
import type { StudioData } from "../src/types";

// Lifecycle regression only: hidden real Electron windows, isolated owned data,
// no provider calls and no existing credentials or learner records.
let app: ElectronApplication, directory: string;
let processHandle: ReturnType<ElectronApplication["process"]>;
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
  processHandle = app.process();
  const page = await app.firstWindow();
  await expect(page.locator(".titlebar-center")).toHaveText("Saved locally");
  expect(
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].isVisible(),
    ),
  ).toBe(false);
  return page;
}
test.beforeEach(async () => {
  directory = await mkdtemp(
    join(process.cwd(), ".provider-test-shutdown-native-"),
  );
});
test.afterEach(async () => {
  await app?.close().catch(() => {});
  await rm(directory, {
    recursive: true,
    force: true,
    maxRetries: 8,
    retryDelay: 200,
  });
});

test("quit from a SQLite native callback unwinds before disposal/close, exits normally, and preserves the library", async () => {
  const page = await launch();
  const before = await page.evaluate(async () => {
    const data = await window.studio!.invoke<StudioData>("data:load");
    data.settings.profile = "Synthetic shutdown preference";
    await window.studio!.invoke("data:save", data);
    return data;
  });
  const fixturePath = join(directory, "shutdown-fixture.cjs"),
    receipt = join(directory, "shutdown-receipt.json");
  await build({
    entryPoints: ["tests/v21-request-service-fixture.ts"],
    bundle: true,
    outfile: fixturePath,
    platform: "node",
    format: "cjs",
    external: ["electron", "better-sqlite3"],
    logLevel: "silent",
  });
  await app.evaluate(
    ({ app, dialog }, { fixturePath, probePath, receipt }) => {
      const require = process
        .getBuiltinModule("node:module")
        .createRequire(process.cwd() + "/package.json");
      const production = require(fixturePath),
        fs = require("node:fs");
      const store = new production.StudioStore(probePath),
        subjects = new production.SubjectStore(store);
      const planning = new production.PlanningService(store, subjects, {
        models: async () => [],
        request: async () => {
          throw new Error("This shutdown test must never call a model");
        },
        changed: () => {},
      });
      const state: any = {
        queryReturned: null,
        exceptions: [],
        dialogs: [],
        closedOutsideQuery: false,
      };
      dialog.showErrorBox = (title, content) => {
        state.dialogs.push({ title, content });
      };
      process.on("uncaughtExceptionMonitor", (error) =>
        state.exceptions.push(String(error)),
      );
      app.on("before-quit", () => planning.dispose());
      app.on("will-quit", () => {
        state.integrity = store.db.pragma("quick_check", { simple: true });
        store.close();
        state.closedOutsideQuery = true;
        fs.writeFileSync(receipt, JSON.stringify(state), "utf8");
      });
      store.db.function("request_quit_inside_query", () => {
        app.quit();
        return 42;
      });
      (globalThis as any).shutdownNativeProbe = () => {
        state.queryReturned = store.db
          .prepare("SELECT request_quit_inside_query() AS result")
          .get().result;
      };
    },
    { fixturePath, probePath: join(directory, "probe.sqlite"), receipt },
  );
  const closed = app.waitForEvent("close");
  await app
    .evaluate(() => (globalThis as any).shutdownNativeProbe())
    .catch((error) => {
      if (!/closed|destroyed/i.test(String(error))) throw error;
    });
  await closed;
  await expect.poll(() => processHandle.exitCode).toBe(0);
  expect(JSON.parse(await readFile(receipt, "utf8"))).toEqual({
    queryReturned: 42,
    exceptions: [],
    dialogs: [],
    closedOutsideQuery: true,
    integrity: "ok",
  });
  const reopened = await launch();
  const after = await reopened.evaluate(() =>
    window.studio!.invoke<StudioData>("data:load"),
  );
  expect(after).toEqual(before);
});

test("normal hidden Electron shutdown closes SQLite cleanly without replacing saved settings", async () => {
  const page = await launch();
  await page.evaluate(async () => {
    const data = await window.studio!.invoke<StudioData>("data:load");
    data.settings.profile = "Normal shutdown keeps this synthetic preference";
    await window.studio!.invoke("data:save", data);
  });
  await app.close();
  await expect.poll(() => processHandle.exitCode).toBe(0);
  const database = new DatabaseSync(join(directory, "learning-studio.sqlite"), {
    readOnly: true,
  });
  try {
    expect(database.prepare("PRAGMA quick_check").get()?.quick_check).toBe(
      "ok",
    );
    const state = JSON.parse(
      String(
        database.prepare("SELECT value FROM settings WHERE id='state'").get()
          ?.value,
      ),
    );
    expect(state.settings.profile).toBe(
      "Normal shutdown keeps this synthetic preference",
    );
  } finally {
    database.close();
  }
});
