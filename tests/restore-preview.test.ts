import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { StudioStore } from "../electron/storage";
import { SubjectStore } from "../electron/subjects";
import { AnnotationStore } from "../electron/annotations";
import { RestorePreviewService } from "../electron/restorePreview";

const stores: StudioStore[] = [],
  directories: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const store of stores.splice(0)) if (store.db.open) store.close();
  for (const directory of directories.splice(0)) {
    if (!resolve(directory).startsWith(resolve(process.cwd()) + sep))
      throw new Error("Temporary test directory is outside the workspace.");
    await rm(directory, { recursive: true, force: true });
  }
});
function fixture(name: string) {
  const store = new StudioStore(":memory:");
  stores.push(store);
  const subjects = new SubjectStore(store),
    subject = subjects.create({
      name,
      objective: "Keep learning records intact",
      depth: "overview",
    });
  const lesson = subjects.conversationCreate({
    subjectId: subject.id,
    title: name + " lesson",
    mode: "Learn",
  });
  const data = store.load();
  data.lessons[0].messages = [
    {
      id: name + "-message",
      role: "assistant",
      text: "A preserved explanation and its annotation.",
      createdAt: new Date().toISOString(),
      status: "complete",
    },
  ];
  data.lessons[0].notes =
    "A note that must never appear in a metadata-only restore preview.";
  data.settings.profile = "Private optional learning preference";
  store.save(data);
  subjects.apply({
    subjectId: subject.id,
    baseRevision: subjects.snapshot(subject.id).subject.revision,
    label: "Saved pathway",
    origin: "learner",
    operations: [
      {
        entity: "curriculum",
        op: "put",
        id: name + "-module",
        value: {
          kind: "module",
          title: name + " module",
          status: "not-started",
          position: 0,
        },
      },
      {
        entity: "curriculum",
        op: "put",
        id: name + "-concept",
        value: {
          kind: "concept",
          title: name + " concept",
          parentId: name + "-module",
          status: "covered",
          position: 1,
        },
      },
    ],
  });
  new AnnotationStore(store).create({
    subjectId: subject.id,
    sourceKind: "message",
    sourceId: name + "-message",
    conversationId: lesson.id,
    quote: "A preserved explanation",
    prefix: "",
    suffix: " and its annotation.",
    start: 0,
    end: 23,
    color: "yellow",
    note: "Keep this highlight",
    tags: ["restore"],
  });
  return { store, subjects, subject, lesson };
}
async function backup(source: StudioStore) {
  const directory = await mkdtemp(
    join(process.cwd(), ".storage-test-restore-"),
  );
  directories.push(directory);
  const path = join(directory, "incoming.sqlite");
  await source.backup(path);
  return path;
}

describe("review-before-commit SQLite restore", () => {
  it("validates normalized records for a metadata-only preview and cancellation leaves active SQLite exactly unchanged", async () => {
    const active = fixture("Active"),
      incoming = fixture("Incoming"),
      path = await backup(incoming.store);
    const service = new RestorePreviewService(active.store),
      before = active.store.db.serialize();
    const preview = service.preview(path);
    expect(preview.counts).toMatchObject({
      lessons: 1,
      curriculumItems: 2,
      highlights: 1,
    });
    expect(JSON.stringify(preview)).not.toContain("Private optional");
    expect(JSON.stringify(preview)).not.toContain("A note that");
    expect(active.store.db.serialize()).toEqual(before);
    service.cancel(preview.token);
    expect(() => service.confirm(preview.token)).toThrow("expired");
    expect(active.store.db.serialize()).toEqual(before);
    expect(active.subjects.snapshot(active.subject.id).curriculum).toHaveLength(
      2,
    );
    expect(service.awaitingAcknowledgment).toBe(false);
  });
  it("rejects invalid normalized backup data during preview without replacing any active subject", async () => {
    const active = fixture("Active"),
      incoming = fixture("Incoming"),
      path = await backup(incoming.store);
    const broken = new StudioStore(path);
    stores.push(broken);
    const row = broken.db
      .prepare("SELECT id,value FROM annotation_highlights LIMIT 1")
      .get() as { id: string; value: string };
    const value = JSON.parse(row.value);
    value.subjectId = "missing-subject";
    broken.db
      .prepare("UPDATE annotation_highlights SET value=? WHERE id=?")
      .run(JSON.stringify(value), row.id);
    broken.close();
    const before = active.store.db.serialize(),
      service = new RestorePreviewService(active.store);
    expect(() => service.preview(path)).toThrow();
    expect(active.store.db.serialize()).toEqual(before);
    expect(service.awaitingAcknowledgment).toBe(false);
  });
  it("requires the exact unexpired token and unchanged source before a single confirmed commit", async () => {
    const active = fixture("Active"),
      incoming = fixture("Incoming"),
      path = await backup(incoming.store);
    let now = 1_000_000;
    const service = new RestorePreviewService(active.store, () => now),
      before = active.store.db.serialize();
    let preview = service.preview(path);
    expect(() => service.confirm("unreviewed-token")).toThrow("expired");
    now += 10 * 60_000 + 1;
    expect(() => service.confirm(preview.token)).toThrow("expired");
    expect(active.store.db.serialize()).toEqual(before);
    preview = service.preview(path);
    const altered = new StudioStore(path);
    stores.push(altered);
    const changed = altered.load();
    changed.lessons[0].notes = "Changed after preview";
    altered.save(changed);
    altered.close();
    expect(() => service.confirm(preview.token)).toThrow(
      "changed since your preview",
    );
    expect(active.store.db.serialize()).toEqual(before);
  });
  it("commits normalized content only after confirmation and guards autosaves until the renderer acknowledges that token", async () => {
    const active = fixture("Active"),
      incoming = fixture("Incoming"),
      path = await backup(incoming.store);
    const service = new RestorePreviewService(active.store),
      preview = service.preview(path),
      beforeCommit = vi.fn();
    const restored = service.confirm(preview.token, beforeCommit);
    expect(beforeCommit).toHaveBeenCalledTimes(1);
    expect(restored.lessons[0].id).toBe(incoming.lesson.id);
    expect(
      active.subjects.snapshot(incoming.subject.id).curriculum,
    ).toHaveLength(2);
    expect(
      new AnnotationStore(active.store).list({
        subjectId: incoming.subject.id,
      }),
    ).toHaveLength(1);
    expect(service.awaitingAcknowledgment).toBe(true);
    expect(() => service.acknowledge("different-token")).toThrow(
      "does not match",
    );
    expect(service.awaitingAcknowledgment).toBe(true);
    // A new application process loads the committed DB without retaining a
    // crashed renderer's in-memory lock. No startup replay is required.
    expect(new RestorePreviewService(active.store).awaitingAcknowledgment).toBe(
      false,
    );
    service.acknowledge(preview.token);
    expect(service.awaitingAcknowledgment).toBe(false);
    expect(() => service.confirm(preview.token)).toThrow("expired");
  });
  it("releases the local autosave guard if commit fails before a restore was written", async () => {
    const active = fixture("Active"),
      incoming = fixture("Incoming"),
      path = await backup(incoming.store),
      service = new RestorePreviewService(active.store);
    const preview = service.preview(path),
      before = active.store.db.serialize();
    vi.spyOn(active.store, "restoreBackup").mockImplementation(() => {
      throw new Error("Simulated restore transaction failure");
    });
    expect(() => service.confirm(preview.token)).toThrow("transaction failure");
    expect(active.store.db.serialize()).toEqual(before);
    expect(service.awaitingAcknowledgment).toBe(false);
  });
});
