import { describe, it, expect, vi, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { defaultData } from "../src/lib/defaults";
import { BackgroundScheduler } from "../electron/scheduler";
vi.mock("electron", () => ({
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (text: string) => Buffer.from("protected:" + text),
    decryptString: (data: Buffer) => data.toString().slice(10),
  },
}));
import { AuthProfiles } from "../electron/profiles";
const paths: string[] = [];
afterEach(async () => {
  for (const path of paths.splice(0))
    await rm(path, { recursive: true, force: true });
});
function setup(consent = true) {
  const state = defaultData();
  state.settings.backgroundConsent = consent;
  const now = new Date().toISOString();
  state.backgroundTasks = [
    {
      id: "task",
      kind: "review",
      prompt: "Prepare optional retrieval questions.",
      model: "catalog-model",
      nextRunAt: now,
      enabled: true,
      status: "scheduled",
      createdAt: now,
      updatedAt: now,
    },
  ];
  const respond = vi.fn(async () => "Completed review.");
  const changed = vi.fn();
  const scheduler = new BackgroundScheduler({
    load: () => state,
    update: (id, patch) => {
      state.backgroundTasks = state.backgroundTasks!.map((t) =>
        t.id === id ? { ...t, ...patch } : t,
      );
    },
    respond,
    models: async () => [{ id: "catalog-model" }],
    changed,
  });
  return { state, respond, changed, scheduler };
}
describe("consent-aware durable background work", () => {
  it("does not spend plan usage without explicit consent", async () => {
    const f = setup(false);
    await f.scheduler.tick(Date.now() + 100);
    expect(f.respond).not.toHaveBeenCalled();
    expect(f.state.backgroundTasks![0].status).toBe("scheduled");
  });
  it("completes once, preserves results, and coalesces an overdue repeating task", async () => {
    const f = setup();
    f.state.backgroundTasks![0].intervalMinutes = 30;
    const now = Date.now();
    await f.scheduler.tick(now + 100);
    expect(f.respond).toHaveBeenCalledTimes(1);
    expect(f.state.backgroundTasks![0]).toMatchObject({
      status: "complete",
      result: "Completed review.",
      enabled: true,
    });
    expect(Date.parse(f.state.backgroundTasks![0].nextRunAt)).toBe(
      now + 100 + 30 * 60000,
    );
    await f.scheduler.tick(now + 200);
    expect(f.respond).toHaveBeenCalledTimes(1);
  });
  it("pauses a failure without overwriting a previously completed result", async () => {
    const f = setup();
    f.state.backgroundTasks![0].result = "Earlier successful work";
    f.respond.mockRejectedValueOnce(new Error("Usage limit reached"));
    await f.scheduler.tick(Date.now() + 100);
    expect(f.state.backgroundTasks![0]).toMatchObject({
      status: "failed",
      enabled: false,
      result: "Earlier successful work",
      error: "Usage limit reached",
    });
    await f.scheduler.tick(Date.now() + 60000);
    expect(f.respond).toHaveBeenCalledTimes(1);
  });
  it("recovers an interrupted task and supports cancellation", async () => {
    const f = setup(false);
    f.state.backgroundTasks![0].status = "running";
    f.scheduler.start();
    expect(f.state.backgroundTasks![0].status).toBe("scheduled");
    f.scheduler.stop();
  });
});
describe("independent account registrations", () => {
  it("serializes initial load and preserves selected profiles across restart without credential import", async () => {
    const directory = await mkdtemp(join(process.cwd(), ".profiles-test-"));
    paths.push(directory);
    const manager = new AuthProfiles({
      directory,
      openExternal: async () => {},
    });
    const [status, profiles] = await Promise.all([
      manager.status(),
      manager.list(),
    ]);
    expect(status.connected).toBe(false);
    expect(profiles.active).toBe("primary");
    const created = await manager.create("Second account");
    expect(created.profileId).not.toBe("primary");
    await manager.rename(created.profileId!, "Personal account");
    const restarted = new AuthProfiles({
      directory,
      openExternal: async () => {},
    });
    expect(await restarted.list()).toMatchObject({
      active: created.profileId,
      profiles: [
        { id: "primary", label: "Primary account" },
        { id: created.profileId, label: "Personal account" },
      ],
    });
    await restarted.select("primary");
    expect((await restarted.status()).connected).toBe(false);
    await expect(restarted.select("../private")).rejects.toThrow("Unknown");
  });
});
