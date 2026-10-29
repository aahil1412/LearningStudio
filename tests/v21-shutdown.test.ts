import { afterEach, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { StudioStore } from "../electron/storage";
import { SubjectStore } from "../electron/subjects";
import { PlanningService } from "../electron/planning";

const directories: string[] = [],
  stores: StudioStore[] = [],
  services: PlanningService[] = [];
afterEach(async () => {
  for (const service of services.splice(0)) service.dispose();
  await Promise.resolve();
  for (const store of stores.splice(0)) if (store.db.open) store.close();
  for (const path of directories.splice(0))
    await rm(path, { recursive: true, force: true });
});
it("disposes inside a real SQLite callback without reentrant queries, then recovers saved checkpoints without replay", async () => {
  const directory = await mkdtemp(
    join(process.cwd(), ".provider-test-shutdown-"),
  );
  directories.push(directory);
  const path = join(directory, "library.sqlite"),
    store = new StudioStore(path);
  stores.push(store);
  const subjects = new SubjectStore(store),
    subject = subjects.create({
      name: "Shutdown safety fixture",
      objective: "Preserve saved data",
      depth: "overview",
    });
  const data = store.load();
  data.settings.profile = "Synthetic preference retained through shutdown";
  store.save(data);
  let activeSignal: AbortSignal | undefined;
  const request = vi.fn(
    async (payload: { input: { content: string }[] }, signal: AbortSignal) => {
      const input = JSON.parse(payload.input[0].content);
      if (!input.module)
        return JSON.stringify({
          modules: [
            {
              id: "one",
              title: "First saved module",
              description: "A saved checkpoint",
              priorities: [],
              prerequisites: [],
            },
            {
              id: "two",
              title: "Unfinished module",
              description: "Explicitly resumed later",
              priorities: [],
              prerequisites: ["one"],
            },
          ],
        });
      if (input.module.title === "First saved module")
        return JSON.stringify({
          nodes: [
            {
              id: "idea",
              parentId: input.module.id,
              kind: "concept",
              title: "Preserved idea",
              description: "Explain a relationship",
              prerequisites: [],
            },
          ],
        });
      activeSignal = signal;
      return new Promise<string>(() => {});
    },
  );
  const planning = new PlanningService(store, subjects, {
    models: async () => [
      { id: "fixture", name: "Controlled fixture", reasoningLevels: [] },
    ],
    request,
    changed: () => {},
    timeoutMs: 10000,
  });
  services.push(planning);
  planning.putIntake({
    subjectId: subject.id,
    status: "skipped",
    goal: subject.objective,
    depth: "overview",
    assessment: "skipped",
  });
  const job = await planning.start({ subjectId: subject.id, model: "fixture" });
  await vi.waitFor(() => expect(planning.get(job.id).completedModules).toBe(1));
  expect(activeSignal).toBeDefined();
  const savedChunk = planning.get(job.id).chunks[0];
  store.db.function("shutdown_probe", () => {
    planning.dispose();
    return 42;
  });
  expect(() =>
    store.db.prepare("SELECT shutdown_probe() AS result").get(),
  ).not.toThrow();
  expect(activeSignal?.aborted).toBe(true);
  expect(store.db.pragma("quick_check", { simple: true })).toBe("ok");
  // Closing the store is now outside the active callback. Disposal remains safe
  // even after close, and constructor recovery owns the persisted state change.
  store.close();
  expect(() => planning.dispose()).not.toThrow();
  const reopened = new StudioStore(path);
  stores.push(reopened);
  const replay = vi.fn(async () => "must not be called");
  const recovered = new PlanningService(reopened, new SubjectStore(reopened), {
    models: async () => [],
    request: replay,
    changed: () => {},
  });
  services.push(recovered);
  const result = recovered.get(job.id);
  expect(result.status).toBe("interrupted");
  expect(result.chunks).toEqual([savedChunk]);
  expect(result.requestState).toBe("possibly-admitted");
  expect(replay).not.toHaveBeenCalled();
  expect(reopened.load().settings.profile).toBe(
    "Synthetic preference retained through shutdown",
  );
  expect(reopened.db.pragma("quick_check", { simple: true })).toBe("ok");
});
