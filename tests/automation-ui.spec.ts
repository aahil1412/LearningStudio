import { createLearningSession } from "./learning-fixtures";
import {
  _electron as electron,
  test,
  expect,
  type ElectronApplication,
  type Page,
} from "@playwright/test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, basename, sep } from "node:path";
import type { StudioData } from "../src/types";

let app: ElectronApplication, page: Page, directory: string;
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
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setContentSize(1500, 980),
  );
  await expect(page.locator(".titlebar-center")).toHaveText("Saved locally");
}
const stored = () =>
  page.evaluate(() => window.studio!.invoke<StudioData>("data:load"));
const saved = async (check: (data: StudioData) => boolean) => {
  await expect.poll(async () => check(await stored())).toBe(true);
};
async function settings() {
  await page
    .locator(".sidebar-bottom")
    .getByRole("button", { name: "Settings", exact: true })
    .click();
  return page.getByRole("region", { name: "Settings", exact: true });
}
async function profiles() {
  return page.evaluate(() =>
    window.studio!.invoke<{
      active: string;
      profiles: { id: string; label: string }[];
    }>("auth:profiles"),
  );
}

test.beforeEach(async () => {
  directory = mkdtempSync(join(tmpdir(), "studio-automation-e2e-"));
  await launch();
});
test.afterEach(async () => {
  await app?.close().catch(() => {});
  const target = resolve(directory);
  if (
    !target.startsWith(resolve(tmpdir()) + sep) ||
    !basename(target).startsWith("studio-automation-e2e-")
  )
    throw new Error("Unexpected test cleanup path.");
  rmSync(target, {
    recursive: true,
    force: true,
    maxRetries: 8,
    retryDelay: 200,
  });
});

test("isolated disconnected account profiles can be created, renamed, selected, and recovered after restart; full-page Settings supports keyboard navigation", async () => {
  let dialog = await settings();
  await expect(dialog).not.toHaveAttribute("aria-modal", "true");
  const first = dialog.getByRole("button", {
    name: "Appearance: Themes, colors and typography",
    exact: true,
  });
  await first.focus();
  await page.keyboard.press("Shift+Tab");
  await expect(
    dialog.getByRole("button", { name: "Close settings", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(
    page.getByRole("button", { name: "Settings", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(
    dialog.getByRole("button", { name: "Close settings", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(first).toBeFocused();
  for (let index = 0; index < 20; index++) {
    await page.keyboard.press("Tab");
    expect(
      await page.evaluate(
        () =>
          !!document.activeElement?.closest(
            '[role="region"][aria-label="Settings"]',
          ),
      ),
    ).toBe(true);
  }
  await dialog
    .getByRole("button", {
      name: "Account & models: Connections and model choices",
      exact: true,
    })
    .click();
  const select = dialog.getByLabel("Account profile", { exact: true });
  await expect(select).toHaveValue("primary");
  await dialog
    .getByLabel("Account profile label", { exact: true })
    .fill("Workshop");
  await dialog
    .getByRole("button", { name: "Add account", exact: true })
    .click();
  await expect
    .poll(async () => {
      const current = await profiles();
      return current.profiles.find((p) => p.id === current.active)?.label;
    })
    .toBe("Workshop");
  const workshop = (await profiles()).active;
  expect(workshop).not.toBe("primary");
  await dialog
    .getByLabel("Account profile label", { exact: true })
    .fill("Workshop account");
  await dialog.getByRole("button", { name: "Rename", exact: true }).click();
  await expect(select.locator("option:checked")).toHaveText("Workshop account");
  await dialog
    .getByLabel("Account profile label", { exact: true })
    .fill("Reading");
  await dialog
    .getByRole("button", { name: "Add account", exact: true })
    .click();
  await expect(select.locator("option:checked")).toHaveText("Reading");
  const reading = await select.inputValue();
  expect(reading).not.toBe(workshop);
  await select.selectOption("primary");
  await expect(select).toBeEnabled();
  await expect(dialog.getByText("Disconnected", { exact: true })).toBeVisible();
  await select.selectOption(workshop);
  await expect(select).toBeEnabled();
  await expect.poll(async () => (await profiles()).active).toBe(workshop);
  expect(
    await page.evaluate(() =>
      window.studio!.invoke<{ connected: boolean }>("auth:status"),
    ),
  ).toMatchObject({ connected: false });
  await app.close();
  await launch();
  dialog = await settings();
  await dialog
    .getByRole("button", {
      name: "Account & models: Connections and model choices",
      exact: true,
    })
    .click();
  await expect(
    dialog.getByLabel("Account profile", { exact: true }),
  ).toHaveValue(workshop);
  const reopened = await profiles();
  expect(reopened.profiles).toEqual(
    expect.arrayContaining([
      { id: "primary", label: "Primary account" },
      { id: workshop, label: "Workshop account" },
      { id: reading, label: "Reading" },
    ]),
  );
  await expect(dialog.getByText("Disconnected", { exact: true })).toBeVisible();
});

test("scheduled inference requires explicit consent, future tasks wait, cancellation works, and disconnected due-task failures preserve the session", async () => {
  await createLearningSession(page, "Explore scientific reasoning");
  await page.getByRole("button", { name: "Notes", exact: true }).click();
  await page
    .getByLabel("Session notes", { exact: true })
    .fill("These saved notes must survive scheduled inference failure.");
  await saved((data) => data.lessons[0]?.notes.includes("must survive"));
  const dialog = await settings();
  await dialog
    .getByRole("button", {
      name: "Automation & updates: Background tasks and releases",
      exact: true,
    })
    .click();
  const consent = dialog.getByRole("checkbox", {
    name: /Allow scheduled model requests to use my ChatGPT plan/,
  });
  await expect(consent).not.toBeChecked();
  await expect(
    dialog.getByRole("checkbox", {
      name: /Continue scheduled work in the Windows tray/,
    }),
  ).toBeDisabled();
  await dialog
    .getByLabel("Scheduled task instructions", { exact: true })
    .fill("Prepare a future review of scientific reasoning.");
  await dialog.getByLabel("Task delay", { exact: true }).fill("500");
  await dialog.getByLabel("Task interval", { exact: true }).fill("0");
  await expect(
    dialog.getByRole("button", { name: "Schedule task", exact: true }),
  ).toBeDisabled();
  await expect(
    dialog.getByRole("button", { name: "Run due tasks", exact: true }),
  ).toBeDisabled();
  await consent.check();
  await dialog
    .getByRole("button", { name: "Schedule task", exact: true })
    .click();
  await saved(
    (data) =>
      data.settings.backgroundConsent === true &&
      data.backgroundTasks?.[0].status === "scheduled",
  );
  const initial = await stored(),
    future = initial.backgroundTasks![0];
  expect(Date.parse(future.nextRunAt) - Date.now()).toBeGreaterThan(
    499 * 60000,
  );
  expect(future.intervalMinutes).toBeUndefined();
  await dialog
    .getByRole("button", { name: "Run due tasks", exact: true })
    .click();
  expect(
    (await stored()).backgroundTasks?.find((task) => task.id === future.id),
  ).toMatchObject({
    status: "scheduled",
    enabled: true,
    nextRunAt: future.nextRunAt,
  });
  const futureCard = dialog
    .locator(".settings-card")
    .filter({ hasText: "Prepare a future review of scientific reasoning." });
  await futureCard.getByRole("button", { name: "Cancel", exact: true }).click();
  await saved(
    (data) =>
      data.backgroundTasks?.find((task) => task.id === future.id)?.status ===
      "cancelled",
  );
  await expect(
    futureCard.getByText("review · cancelled", { exact: true }),
  ).toBeVisible();
  await dialog
    .getByLabel("Scheduled task instructions", { exact: true })
    .fill("Prepare a review now without a connected account.");
  await dialog.getByLabel("Task delay", { exact: true }).fill("0");
  await dialog
    .getByRole("button", { name: "Schedule task", exact: true })
    .click();
  await saved(
    (data) =>
      data.backgroundTasks?.[0].prompt ===
      "Prepare a review now without a connected account.",
  );
  await dialog
    .getByRole("button", { name: "Run due tasks", exact: true })
    .click();
  await saved(
    (data) =>
      data.backgroundTasks?.[0].status === "failed" &&
      data.backgroundTasks[0].enabled === false,
  );
  const failed = (await stored()).backgroundTasks![0];
  expect(failed.error).toMatch(/connect|sign in|account|model/i);
  expect(failed.result).toBeUndefined();
  await expect(
    dialog
      .locator(".settings-card")
      .filter({ hasText: failed.prompt })
      .getByText("review · failed", { exact: true }),
  ).toBeVisible();
  await dialog
    .getByLabel("Scheduled task instructions", { exact: true })
    .fill("Keep this future task paused while consent is off.");
  await dialog.getByLabel("Task delay", { exact: true }).fill("500");
  await dialog
    .getByRole("button", { name: "Schedule task", exact: true })
    .click();
  await saved(
    (data) =>
      data.backgroundTasks?.[0].prompt ===
      "Keep this future task paused while consent is off.",
  );
  const paused = (await stored()).backgroundTasks![0];
  await consent.uncheck();
  await saved((data) => data.settings.backgroundConsent === false);
  await expect(
    dialog.getByRole("button", { name: "Run due tasks", exact: true }),
  ).toBeDisabled();
  await dialog
    .getByLabel("Scheduled task instructions", { exact: true })
    .fill("This must not be scheduled without consent.");
  await expect(
    dialog.getByRole("button", { name: "Schedule task", exact: true }),
  ).toBeDisabled();
  const refusal = await page.evaluate(async () => {
    try {
      await window.studio!.invoke("background:run");
      return "unexpectedly ran";
    } catch (error) {
      return String(error);
    }
  });
  expect(refusal).toMatch(/explicit background model consent/i);
  const unchanged = await stored();
  expect(unchanged.backgroundTasks).toHaveLength(3);
  expect(
    unchanged.backgroundTasks?.find((task) => task.id === paused.id),
  ).toMatchObject({ status: "scheduled", enabled: true });
  expect(unchanged.lessons[0]).toMatchObject({
    id: initial.lessons[0].id,
    objective: "Explore scientific reasoning",
    notes: "These saved notes must survive scheduled inference failure.",
  });
  expect(unchanged.lessons[0].messages).toEqual([]);
  await dialog
    .getByRole("button", { name: "Close settings", exact: true })
    .click();
  await expect(page.locator(".lesson-top h1")).toHaveText(
    "Explore scientific reasoning",
  );
  await app.close();
  await launch();
  const reopened = await stored();
  expect(reopened.settings.backgroundConsent).toBe(false);
  expect(
    reopened.backgroundTasks?.find((task) => task.id === paused.id),
  ).toMatchObject({ status: "scheduled", enabled: true });
  expect(
    reopened.backgroundTasks?.find((task) => task.id === failed.id)?.status,
  ).toBe("failed");
  expect(reopened.lessons[0].notes).toBe(initial.lessons[0].notes);
});
