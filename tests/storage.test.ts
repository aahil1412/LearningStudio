import { afterEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { StudioStore, validateStudioData } from "../electron/storage";
import { defaultData } from "../src/lib/defaults";
import type { StudioData } from "../src/types";

const paths: string[] = [];
const stores: StudioStore[] = [];
afterEach(async () => {
  for (const store of stores.splice(0)) if (store.db.open) store.close();
  await Promise.all(
    paths.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});
async function directory() {
  const path = await mkdtemp(join(process.cwd(), ".storage-test-"));
  paths.push(path);
  return path;
}
function fixture(): StudioData {
  const data = defaultData();
  data.lessons.push({
    id: "lesson",
    title: "A broad subject",
    subject: "Any subject",
    mode: "Explore",
    objective: "Understand this subject",
    position: "Continue at the first principles",
    notes: "Learner notes",
    createdAt: "2026-10-28",
    updatedAt: "2026-10-28",
    messages: [
      {
        id: "message",
        role: "assistant",
        text: "A saved partial explanation",
        createdAt: "2026-10-28",
        status: "partial",
      },
    ],
  });
  data.activeLessonId = "lesson";
  data.concepts.push(
    {
      id: "first",
      label: "First concept",
      status: "unassessed",
      evidence: "Encountered in this lesson, not assessed.",
      lessonId: "lesson",
    },
    {
      id: "second",
      label: "Second concept",
      status: "partial",
      evidence: "One incomplete explanation from the learner.",
    },
  );
  data.relations.push({
    id: "relation",
    source: "first",
    target: "second",
    kind: "related",
  });
  return data;
}
describe("SQLite learning library", () => {
  it("applies versioned migrations once and recovers lesson position and partial work after reopen", async () => {
    const path = join(await directory(), "library.sqlite");
    let store = new StudioStore(path);
    stores.push(store);
    expect(store.db.pragma("user_version", { simple: true })).toBe(4);
    expect(store.db.prepare("SELECT version FROM migrations").all()).toEqual([
      { version: 1 },
      { version: 2 },
      { version: 3 },
      { version: 4 },
    ]);
    const data = fixture();
    store.save(data);
    store.close();
    store = new StudioStore(path);
    stores.push(store);
    expect(store.load()).toEqual(data);
    expect(
      store.db.prepare("SELECT COUNT(*) AS n FROM migrations").get(),
    ).toEqual({ n: 4 });
  });
  it("rolls back every record and settings after a write failure inside a transaction", () => {
    const store = new StudioStore(":memory:");
    stores.push(store);
    const before = fixture();
    store.save(before);
    store.db.exec(
      "CREATE TRIGGER fail_write BEFORE INSERT ON concepts BEGIN SELECT RAISE(ABORT,'test failure'); END;",
    );
    const next = structuredClone(before);
    next.lessons[0].notes = "This must not replace saved notes";
    next.settings.profile = "Changed profile";
    next.concepts[0].evidence =
      "This changed concept must roll back with the lesson.";
    expect(() => store.save(next)).toThrow("test failure");
    expect(store.load()).toEqual(before);
  });
  it("rejects duplicate IDs and dangling links before replacing saved data", () => {
    const store = new StudioStore(":memory:");
    stores.push(store);
    const before = fixture();
    store.save(before);
    const duplicate = structuredClone(before);
    duplicate.lessons[0].messages.push({ ...duplicate.lessons[0].messages[0] });
    expect(() => store.save(duplicate)).toThrow("Duplicate message");
    const broken = structuredClone(before);
    broken.relations[0].target = "missing";
    expect(() => store.save(broken)).toThrow("missing concept");
    expect(store.load()).toEqual(before);
  });
  it("drops malformed optional content blocks while retaining the usable lesson", () => {
    const data = fixture();
    data.lessons[0].messages[0].blocks = [
      { type: "exercise", question: "" },
      { type: "equation", latex: "x^2" },
    ] as any;
    const validated = validateStudioData(data);
    expect(validated.lessons[0].messages[0].blocks).toEqual([
      { type: "equation", latex: "x^2" },
    ]);
    expect(validated.lessons[0].messages[0].text).toBe(
      "A saved partial explanation",
    );
  });
  it("reads verified backups without writing or migrating the supplied backup", async () => {
    const dir = await directory();
    const store = new StudioStore(join(dir, "live.sqlite"));
    stores.push(store);
    const data = fixture();
    store.save(data);
    const backup = join(dir, "backup.sqlite");
    await store.backup(backup);
    const bytes = await readFile(backup);
    expect(StudioStore.readBackup(backup)).toEqual(data);
    expect(await readFile(backup)).toEqual(bytes);
    await expect(store.backup(join(dir, "live.sqlite"))).rejects.toThrow(
      "different",
    );
  });
  it("refuses newer and unrecognized backups without changing their schema version", async () => {
    const dir = await directory();
    const future = join(dir, "future.sqlite");
    const raw = new Database(future);
    raw.pragma("user_version=99");
    raw.close();
    const before = await readFile(future);
    expect(() => StudioStore.readBackup(future)).toThrow("newer");
    expect(await readFile(future)).toEqual(before);
    const blank = join(dir, "blank.sqlite");
    const empty = new Database(blank);
    empty.close();
    expect(() => StudioStore.readBackup(blank)).toThrow("not a supported");
    const check = new Database(blank, { readonly: true });
    expect(check.pragma("user_version", { simple: true })).toBe(0);
    check.close();
  });
});
