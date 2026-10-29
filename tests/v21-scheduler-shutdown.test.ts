import { afterEach, describe, expect, it, vi } from "vitest";
import { BackgroundScheduler } from "../electron/scheduler";
import { defaultData } from "../src/lib/defaults";
import type { BackgroundTask } from "../src/types";

const schedulers: BackgroundScheduler[] = [];
afterEach(() => {
  for (const scheduler of schedulers.splice(0)) scheduler.stop();
});
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}
function fixture(model = "") {
  const state = defaultData(),
    at = new Date().toISOString();
  state.settings.backgroundConsent = true;
  state.settings.models.review.model = "";
  state.backgroundTasks = [
    {
      id: "scheduled",
      kind: "review",
      model,
      prompt: "Explicit shutdown fixture",
      enabled: true,
      status: "scheduled",
      nextRunAt: at,
      createdAt: at,
      updatedAt: at,
      result: "Previously saved result",
    },
  ];
  let closed = false;
  const catalog = deferred<{ id: string }[]>(),
    result = deferred<string>();
  const update = vi.fn((id: string, patch: Partial<BackgroundTask>) => {
    if (closed) throw new Error("Attempted update after SQLite close");
    state.backgroundTasks = state.backgroundTasks!.map((task) =>
      task.id === id ? { ...task, ...patch } : task,
    );
  });
  const changed = vi.fn(() => {
    if (closed) throw new Error("Attempted notification after shutdown");
  });
  const models = vi.fn(() => catalog.promise),
    respond = vi.fn(() => result.promise);
  const scheduler = new BackgroundScheduler({
    load: () => state,
    update,
    changed,
    models,
    respond,
  });
  schedulers.push(scheduler);
  return {
    state,
    scheduler,
    catalog,
    result,
    models,
    respond,
    update,
    changed,
    close: () => {
      closed = true;
    },
  };
}
describe("background continuations after shutdown", () => {
  it.each(["resolve", "reject"] as const)(
    "does not call provider, update or changed when catalog %s arrives after stop/close",
    async (outcome) => {
      const f = fixture(),
        tick = f.scheduler.tick(Date.now() + 100);
      expect(f.models).toHaveBeenCalledOnce();
      expect(f.update).toHaveBeenCalledOnce();
      expect(f.changed).toHaveBeenCalledOnce();
      f.scheduler.stop();
      f.close();
      if (outcome === "resolve") f.catalog.resolve([{ id: "catalog-model" }]);
      else f.catalog.reject(new Error("Late catalog connection failure"));
      await expect(tick).resolves.toBeUndefined();
      expect(f.respond).not.toHaveBeenCalled();
      expect(f.update).toHaveBeenCalledOnce();
      expect(f.changed).toHaveBeenCalledOnce();
      expect(f.state.backgroundTasks![0].result).toBe(
        "Previously saved result",
      );
    },
  );
  it.each(["resolve", "reject"] as const)(
    "ignores provider %s after stop/close without post-close callbacks",
    async (outcome) => {
      const f = fixture("configured-model"),
        tick = f.scheduler.tick(Date.now() + 100);
      expect(f.respond).toHaveBeenCalledOnce();
      f.scheduler.stop();
      f.close();
      if (outcome === "resolve") f.result.resolve("Late uncommitted answer");
      else f.result.reject(new Error("Late aborted transport"));
      await expect(tick).resolves.toBeUndefined();
      expect(f.update).toHaveBeenCalledOnce();
      expect(f.changed).toHaveBeenCalledOnce();
      expect(f.state.backgroundTasks![0].result).toBe(
        "Previously saved result",
      );
    },
  );
  it("a previous generation cannot clear or overwrite a restarted scheduler's active task", async () => {
    const state = fixture();
    const oldCatalog = state.catalog;
    const newCatalog = deferred<{ id: string }[]>();
    state.models
      .mockImplementationOnce(() => oldCatalog.promise)
      .mockImplementationOnce(() => newCatalog.promise);
    const oldTick = state.scheduler.tick(Date.now() + 100);
    state.scheduler.stop();
    state.scheduler.start();
    expect(state.models).toHaveBeenCalledTimes(2);
    oldCatalog.resolve([{ id: "obsolete-model" }]);
    await oldTick;
    const calls = state.update.mock.calls.length,
      notifications = state.changed.mock.calls.length;
    await state.scheduler.tick(Date.now() + 100);
    expect(state.models).toHaveBeenCalledTimes(2);
    expect(state.update).toHaveBeenCalledTimes(calls);
    expect(state.changed).toHaveBeenCalledTimes(notifications);
    expect(state.respond).not.toHaveBeenCalled();
    state.scheduler.stop();
    state.close();
    newCatalog.resolve([{ id: "new-model" }]);
    await Promise.resolve();
    await Promise.resolve();
    expect(state.respond).not.toHaveBeenCalled();
    expect(state.update).toHaveBeenCalledTimes(calls);
  });
});
