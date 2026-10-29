import { it, expect } from "vitest";
import { writeFileSync } from "node:fs";
import { StudioStore, validateStudioData } from "../electron/storage";
import { defaultData } from "../src/lib/defaults";
it("indexes a 5,000-session library and updates one record without rewriting unrelated records", () => {
  const store = new StudioStore(":memory:");
  const data = defaultData();
  const now = "2026-10-28T12:00:00.000Z";
  data.lessons = Array.from({ length: 5000 }, (_, i) => ({
    id: "lesson-" + i,
    title: "Learning session " + i,
    subject: "General",
    mode: "Explore",
    objective: "Understand general subject " + i,
    position: "A saved checkpoint",
    messages: [
      {
        id: "message-" + i,
        role: "user",
        text: "An independently saved question " + i,
        createdAt: now,
        status: "complete",
      },
    ],
    notes: "Notes for " + i,
    createdAt: now,
    updatedAt: now,
  }));
  const started = performance.now();
  store.save(data);
  const initialSaveMs = performance.now() - started;
  const before = (
    store.db.prepare("SELECT total_changes() AS n").get() as { n: number }
  ).n;
  data.lessons[2500].notes = "A single changed note";
  const updated = performance.now();
  store.save(data);
  const incrementalSaveMs = performance.now() - updated;
  const changes =
    (store.db.prepare("SELECT total_changes() AS n").get() as { n: number }).n -
    before;
  expect(changes).toBeLessThan(50);
  expect(store.search("2500")).toEqual(
    expect.arrayContaining([expect.objectContaining({ id: "lesson-2500" })]),
  );
  const loaded = performance.now();
  expect(store.load().lessons).toHaveLength(5000);
  const loadMs = performance.now() - loaded;
  expect(store.load().lessons.find((l) => l.id === "lesson-2500")?.notes).toBe(
    "A single changed note",
  );
  writeFileSync(
    "docs/storage-benchmark.json",
    JSON.stringify(
      {
        sessions: 5000,
        initialSaveMs,
        incrementalSaveMs,
        loadMs,
        sqliteChangesForSingleNote: changes,
        scope:
          "Synthetic 5000-session in-memory SQLite library; not a long-duration hardware benchmark",
      },
      null,
      2,
    ),
  );
  store.close();
});
it("rejects malformed persistent graph history and hierarchy cycles before a transaction", () => {
  const data = defaultData();
  data.graphHistory = { past: [null as any], future: [] };
  expect(() => validateStudioData(data)).toThrow();
  data.graphHistory = undefined;
  data.library = [
    {
      id: "a",
      title: "A",
      kind: "topic",
      subject: "General",
      content: "",
      createdAt: "now",
      parentId: "b",
    },
    {
      id: "b",
      title: "B",
      kind: "topic",
      subject: "General",
      content: "",
      createdAt: "now",
      parentId: "a",
    },
  ];
  expect(() => validateStudioData(data)).toThrow("cycle");
});
