import { afterEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { StudioStore } from "../electron/storage";
import { SubjectStore } from "../electron/subjects";
import { defaultData } from "../src/lib/defaults";
import type { StudioData } from "../src/types";
import type { SubjectRecord } from "../src/v2types";
const directories: string[] = [],
  stores: StudioStore[] = [];
afterEach(async () => {
  for (const store of stores.splice(0)) if (store.db.open) store.close();
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});
async function directory() {
  const result = await mkdtemp(join(process.cwd(), ".v2-storage-"));
  directories.push(result);
  return result;
}
const hash = (bytes: Buffer) =>
  createHash("sha256").update(bytes).digest("hex");
const originalPdf = () =>
  Buffer.from(
    "%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 300] >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n",
    "ascii",
  );
function legacyFixture(): StudioData {
  const data = defaultData();
  data.settings.profile = "Optional learner-provided setting";
  data.appearance = {
    mode: "dark",
    light: { accent: "#125687" },
    dark: { accent: "#bbaa33" },
  };
  data.lessons = [
    {
      id: "old-lesson",
      title: "Broad physics",
      subject: "Physics",
      mode: "Deep Dive",
      objective: "Understand physics without forced diagnostics",
      position: "Continue the conservation derivation",
      notes: "An original saved note",
      createdAt: "2026-10-28",
      updatedAt: "2026-10-28",
      goals: [
        {
          id: "goal",
          title: "Conservation laws",
          status: "current",
          prerequisites: [],
        },
      ],
      messages: [
        {
          id: "old-message",
          role: "assistant",
          text: "The original mathematical explanation",
          createdAt: "2026-10-28",
          status: "partial",
          blocks: [{ type: "equation", latex: "E=mc^2" }],
        },
      ],
    },
  ];
  data.activeLessonId = "old-lesson";
  data.concepts = [
    {
      id: "old-concept",
      label: "Conservation",
      status: "partial",
      evidence: "Learner justified one limiting case.",
      lessonId: "old-lesson",
    },
    {
      id: "unmatched-concept",
      label: "An unmatched concept",
      status: "encountered",
      evidence: "",
    },
  ];
  data.relations = [
    {
      id: "old-relation",
      source: "old-concept",
      target: "unmatched-concept",
      kind: "related",
    },
  ];
  data.library = [
    {
      id: "old-subject",
      kind: "subject",
      title: "Physics",
      subject: "Physics",
      content: "",
      createdAt: "2026-10-28",
    },
    {
      id: "old-document",
      kind: "document",
      title: "Imported source",
      parentId: "old-subject",
      subject: "Physics",
      content: "Source text remains unverified",
      pages: [{ page: 1, text: "Source text remains unverified" }],
      lessonIds: ["old-lesson"],
      createdAt: "2026-10-28",
    },
  ];
  data.reviewCards = [
    {
      id: "old-card",
      conceptId: "old-concept",
      lessonId: "old-lesson",
      question: "Two plus two?",
      answer: "4",
      grading: { kind: "numeric", expected: 4, tolerance: 0 },
      dueAt: "2026-10-28T12:00:00.000Z",
      intervalDays: 2,
      repetitions: 1,
      easeFactor: 2.5,
      lapses: 0,
      createdAt: "2026-10-28",
    },
  ];
  data.reviewHistory = [
    {
      id: "old-attempt",
      cardId: "old-card",
      answer: "4",
      grade: 5,
      correct: true,
      feedback: "Correct numeric calculation.",
      method: "numeric",
      createdAt: "2026-10-28",
    },
  ];
  return data;
}
function writeLegacy(path: string, version = 2) {
  const data = legacyFixture(),
    db = new Database(path);
  db.exec(
    "CREATE TABLE settings(id TEXT PRIMARY KEY,value TEXT NOT NULL);CREATE TABLE lessons(id TEXT PRIMARY KEY,value TEXT NOT NULL);CREATE TABLE messages(id TEXT PRIMARY KEY,lesson_id TEXT REFERENCES lessons(id) ON DELETE CASCADE,ordinal INTEGER NOT NULL,value TEXT NOT NULL);CREATE TABLE concepts(id TEXT PRIMARY KEY,value TEXT NOT NULL);CREATE TABLE relations(id TEXT PRIMARY KEY,value TEXT NOT NULL);CREATE TABLE library(id TEXT PRIMARY KEY,value TEXT NOT NULL);CREATE TABLE migrations(version INTEGER PRIMARY KEY,applied_at TEXT NOT NULL);INSERT INTO migrations VALUES(1,datetime('now'));PRAGMA user_version=1;",
  );
  const { lessons, concepts, relations, library, ...settings } = data;
  db.prepare("INSERT INTO settings VALUES(?,?)").run(
    "state",
    JSON.stringify(settings),
  );
  for (const [table, values] of Object.entries({
    lessons,
    concepts,
    relations,
    library,
  }))
    for (const value of values) {
      const { messages: _messages, ...rest } = value as any;
      db.prepare(`INSERT INTO ${table} VALUES(?,?)`).run(
        value.id,
        JSON.stringify(table === "lessons" ? rest : value),
      );
    }
  for (const lesson of lessons)
    lesson.messages.forEach((message, index) =>
      db
        .prepare("INSERT INTO messages VALUES(?,?,?,?)")
        .run(message.id, lesson.id, index, JSON.stringify(message)),
    );
  if (version === 2)
    db.exec(
      "CREATE VIRTUAL TABLE search_index USING fts5(record_id UNINDEXED,entity UNINDEXED,title,body);CREATE INDEX messages_lesson_ordinal ON messages(lesson_id,ordinal);INSERT INTO migrations VALUES(2,datetime('now'));PRAGMA user_version=2;",
    );
  db.close();
  return data;
}
function populate(store: StudioStore) {
  const service = new SubjectStore(store),
    subject = service.create({
      name: "Chemistry",
      objective: "Understand bonding",
      depth: "advanced",
    }),
    lesson = service.conversationCreate({
      subjectId: subject.id,
      title: "Chemical bonding",
    });
  let data = store.load();
  data.lessons[0].messages = [
    {
      id: "original-message",
      role: "assistant",
      text: "A useful explanation.",
      createdAt: "2026-10-28",
    },
  ];
  store.save(data);
  service.apply({
    subjectId: subject.id,
    baseRevision: subject.revision,
    label: "Add concept and pathway",
    origin: "learner",
    operations: [
      {
        entity: "concept",
        op: "put",
        id: "chemical-concept",
        value: {
          label: "Bonding",
          status: "partial",
          evidence: "Learner compared two bonding models.",
          coverage: "covered",
          lessonId: lesson.id,
        },
      },
      {
        entity: "curriculum",
        op: "put",
        id: "bonding-node",
        value: {
          kind: "concept",
          title: "Bonding",
          conceptId: "chemical-concept",
          status: "partial",
        },
      },
    ],
  });
  service.dispatch("subject:record-put", {
    subjectId: subject.id,
    id: "source-asset",
    recordType: "asset",
    title: "Original source bytes",
    data: { base64: "Zml4dHVyZSBieXRlcw==", mime: "application/octet-stream" },
  });
  service.dispatch("subject:record-put", {
    subjectId: subject.id,
    id: "chapter",
    recordType: "chapter",
    title: "Bonding chapter",
    data: { markdown: "## Bonds\nA conserved editable chapter.", blocks: [] },
  });
  data = store.load();
  data.library.push({
    id: "source-reference",
    subjectId: subject.id,
    kind: "reference",
    subject: "Chemistry",
    title: "A source reference",
    content: "Source citation",
    source: "https://pubchem.ncbi.nlm.nih.gov/",
    createdAt: "2026-10-28",
  });
  data.reviewCards = [
    {
      id: "chem-card",
      subjectId: subject.id,
      conceptId: "chemical-concept",
      lessonId: lesson.id,
      question: "Two plus two?",
      answer: "4",
      grading: { kind: "numeric", expected: 4, tolerance: 0 },
      dueAt: "2026-10-28T12:00:00.000Z",
      intervalDays: 1,
      repetitions: 1,
      easeFactor: 2.5,
      lapses: 0,
      createdAt: "2026-10-28",
    },
  ];
  data.reviewHistory = [
    {
      id: "chem-attempt",
      subjectId: subject.id,
      cardId: "chem-card",
      answer: "4",
      grade: 5,
      correct: true,
      feedback: "Correct.",
      method: "numeric",
      createdAt: "2026-10-28",
    },
  ];
  store.save(data);
  const branch = service.branch({
    subjectId: subject.id,
    conversationId: lesson.id,
    messageId: "original-message",
  });
  return { service, subject, lesson, branch };
}

describe("additive v3 migration and complete restore", () => {
  it("retains content-addressed original PDFs in full backups and portable subject archives", async () => {
    const dir = await directory(),
      source = new StudioStore(join(dir, "source.sqlite"));
    stores.push(source);
    const { service, subject } = populate(source),
      pdf = originalPdf(),
      assetId = source.putDocumentAsset(pdf);
    expect(source.putDocumentAsset(pdf)).toBe(assetId);
    expect(
      source.db.prepare("SELECT COUNT(*) AS n FROM document_assets").get(),
    ).toEqual({ n: 1 });
    const data = source.load();
    data.library.push({
      id: "pdf-resource",
      subjectId: subject.id,
      kind: "document",
      subject: "Chemistry",
      title: "Original PDF",
      content: "Extracted page text",
      sourceAssetId: assetId,
      createdAt: "2026-10-28",
    });
    source.save(data);
    const archive = service.exportArchive(subject.id),
      target = new StudioStore(":memory:");
    stores.push(target);
    new SubjectStore(target).restore({ archive });
    expect(target.getDocumentAsset(assetId)).toEqual(pdf);
    const backup = join(dir, "complete-backup.sqlite");
    await source.backup(backup);
    target.restoreBackup(backup);
    expect(target.getDocumentAsset(assetId)).toEqual(pdf);
    expect(
      target.load().library.find((item) => item.id === "pdf-resource")
        ?.sourceAssetId,
    ).toBe(assetId);
    const invalid = structuredClone(archive);
    invalid.documentAssets[0].base64 = Buffer.from(
      "%PDF-1.4\nWrong original\n%%EOF",
    ).toString("base64");
    const empty = new StudioStore(":memory:");
    stores.push(empty);
    expect(() => new SubjectStore(empty).restore({ archive: invalid })).toThrow(
      "hash",
    );
    expect(
      empty.db.prepare("SELECT COUNT(*) AS n FROM document_assets").get(),
    ).toEqual({ n: 0 });
    expect(() =>
      source.putDocumentAsset(Buffer.from("<html>not a PDF</html>")),
    ).toThrow("complete PDF");
  });
  it.each([1, 2])(
    "backs up a v%i database before migration and preserves all original learning/settings records",
    async (version) => {
      const path = join(await directory(), "library.sqlite"),
        original = writeLegacy(path, version),
        store = new StudioStore(path);
      stores.push(store);
      expect(store.migrationBackupPath).toBeTruthy();
      expect(store.load()).toEqual(original);
      expect(store.db.pragma("user_version", { simple: true })).toBe(4);
      const service = new SubjectStore(store);
      expect(service.list().map((subject) => subject.name)).toEqual(
        expect.arrayContaining(["Physics", "General"]),
      );
      const physics = service
        .list()
        .find((subject) => subject.name === "Physics")!;
      expect(service.snapshot(physics.id).concepts[0].status).toBe("partial");
      expect(
        service
          .snapshot(physics.id)
          .evidence.some((evidence) => evidence.kind === "review"),
      ).toBe(true);
      const backup = new Database(store.migrationBackupPath!, {
        readonly: true,
      });
      expect(backup.pragma("user_version", { simple: true })).toBe(version);
      expect(
        backup
          .prepare("SELECT name FROM sqlite_master WHERE name='subjects'")
          .get(),
      ).toBeUndefined();
      backup.close();
      const before = hash(await readFile(store.migrationBackupPath!));
      expect(StudioStore.readBackup(store.migrationBackupPath!)).toEqual(
        original,
      );
      expect(hash(await readFile(store.migrationBackupPath!))).toBe(before);
      store.close();
      const reopened = new StudioStore(path);
      stores.push(reopened);
      expect(reopened.migrationBackupPath).toBeUndefined();
      expect(reopened.load()).toEqual(original);
    },
  );
  it("exports and restores a complete stable-ID subject including branch ancestry, records, reviews, and resource provenance", () => {
    const source = new StudioStore(":memory:");
    stores.push(source);
    const { service, subject, branch } = populate(source),
      archive = service.exportArchive(subject.id),
      target = new StudioStore(":memory:");
    stores.push(target);
    const targetService = new SubjectStore(target),
      unrelated = targetService.create({ name: "Literature" });
    targetService.conversationCreate({
      subjectId: unrelated.id,
      title: "Preserved existing work",
    });
    const restored = targetService.restore({ archive });
    expect(restored.id).toBe(subject.id);
    expect(
      targetService
        .transcript({ conversationId: branch.id })
        .map((message) => message.id),
    ).toEqual(["original-message"]);
    expect(target.load().lessons).toHaveLength(3);
    expect(target.load().reviewCards?.[0].id).toBe("chem-card");
    expect(target.load().reviewHistory?.[0].id).toBe("chem-attempt");
    expect(target.load().library[0].source).toBe(
      "https://pubchem.ncbi.nlm.nih.gov/",
    );
    expect(
      (
        targetService.dispatch("subject:record-get", {
          subjectId: subject.id,
          id: "source-asset",
        }) as SubjectRecord
      ).data,
    ).toEqual({
      base64: "Zml4dHVyZSBieXRlcw==",
      mime: "application/octet-stream",
    });
    expect(targetService.snapshot(subject.id).revisions.length).toBe(
      service.snapshot(subject.id).revisions.length,
    );
    expect(() => targetService.restore({ archive })).toThrow("already exists");
    expect(target.load().lessons).toHaveLength(3);
  });
  it("rejects malformed/scoped archive content before any existing record changes", () => {
    const source = new StudioStore(":memory:");
    stores.push(source);
    const { service, subject } = populate(source),
      archive = service.exportArchive(subject.id),
      target = new StudioStore(":memory:");
    stores.push(target);
    const targetService = new SubjectStore(target);
    targetService.create({ name: "Keep this subject" });
    const before = target.db.serialize();
    const bad = structuredClone(archive) as any;
    bad.tables.curriculum_nodes[0].subject_id = "another-subject";
    expect(() => targetService.restore({ archive: bad })).toThrow(
      "another subject",
    );
    expect(target.db.serialize()).toEqual(before);
    const missing = structuredClone(archive) as any;
    missing.tables.curriculum_nodes[0].parent_id = "missing-parent";
    missing.tables.curriculum_nodes[0].value = JSON.stringify({
      ...JSON.parse(missing.tables.curriculum_nodes[0].value),
      parentId: "missing-parent",
    });
    expect(() => targetService.restore({ archive: missing })).toThrow();
    expect(target.db.serialize()).toEqual(before);
  });
  it("restores full v3 SQLite state atomically with a pre-restore backup and leaves the source read-only", async () => {
    const dir = await directory(),
      path = join(dir, "active.sqlite"),
      backupPath = join(dir, "backup.sqlite"),
      store = new StudioStore(path);
    stores.push(store);
    const { service, subject, branch } = populate(store);
    await store.backup(backupPath);
    const before = hash(await readFile(backupPath));
    service.dispatch("subject:record-put", {
      subjectId: subject.id,
      id: "chapter",
      recordType: "chapter",
      title: "Changed chapter",
      expectedRevision: 1,
      data: { markdown: "Later changed content" },
    });
    service.create({ name: "Subject created after backup" });
    store.restoreBackup(backupPath);
    expect(service.list().map((item) => item.name)).toEqual(["Chemistry"]);
    expect(
      (
        service.dispatch("subject:record-get", {
          subjectId: subject.id,
          id: "chapter",
        }) as SubjectRecord
      ).data,
    ).toEqual(
      expect.objectContaining({
        markdown: "## Bonds\nA conserved editable chapter.",
        blocks: [],
      }),
    );
    expect(service.transcript({ conversationId: branch.id })[0].id).toBe(
      "original-message",
    );
    expect(store.load().reviewHistory?.[0].id).toBe("chem-attempt");
    expect(hash(await readFile(backupPath))).toBe(before);
    expect(
      (await readdir(dir)).some((file) => file.includes(".pre-restore-")),
    ).toBe(true);
    expect(
      service.search({ subjectId: subject.id, query: "Bonding" }).length,
    ).toBeGreaterThan(0);
  });
  it("rolls back an entire SQLite restore if a copied PDF fails its content-integrity check", async () => {
    const dir = await directory(),
      path = join(dir, "corrupted-source.sqlite"),
      source = new StudioStore(path);
    stores.push(source);
    populate(source);
    const assetId = source.putDocumentAsset(originalPdf());
    source.close();
    const malicious = new Database(path);
    malicious
      .prepare("UPDATE document_assets SET bytes=? WHERE id=?")
      .run(Buffer.alloc(originalPdf().length), assetId);
    malicious.close();
    const target = new StudioStore(join(dir, "active.sqlite"));
    stores.push(target);
    const service = new SubjectStore(target),
      subject = service.create({ name: "Preserved original subject" });
    service.conversationCreate({
      subjectId: subject.id,
      title: "Untouched lesson",
    });
    const before = target.db.serialize(),
      fileHash = hash(await readFile(path));
    expect(() => target.restoreBackup(path)).toThrow("integrity");
    expect(target.db.serialize()).toEqual(before);
    expect(service.list().map((item) => item.name)).toEqual([
      "Preserved original subject",
    ]);
    expect(hash(await readFile(path))).toBe(fileHash);
  });
  it("restores legacy v2 backups into v3 without dropping original themes, notes, reviews, or relations", async () => {
    const dir = await directory(),
      legacyPath = join(dir, "legacy.sqlite"),
      original = writeLegacy(legacyPath),
      store = new StudioStore(join(dir, "active.sqlite"));
    stores.push(store);
    new SubjectStore(store).create({ name: "Later subject" });
    const before = hash(await readFile(legacyPath));
    const restored = store.restoreBackup(legacyPath);
    expect(restored).toEqual(original);
    expect(store.db.pragma("user_version", { simple: true })).toBe(4);
    expect(
      new SubjectStore(store).list().map((subject) => subject.name),
    ).toEqual(["General", "Physics"]);
    expect(hash(await readFile(legacyPath))).toBe(before);
  });
  it("preserves long valid legacy evidence/objectives while keeping derived subject metadata bounded", async () => {
    const dir = await directory(),
      path = join(dir, "legacy.sqlite"),
      original = writeLegacy(path),
      db = new Database(path);
    original.lessons[0].objective = "A broad original objective ".repeat(1500);
    original.concepts[0].evidence = "Original supporting evidence ".repeat(
      1500,
    );
    const { messages: _messages, ...lesson } = original.lessons[0];
    db.prepare("UPDATE lessons SET value=? WHERE id=?").run(
      JSON.stringify(lesson),
      "old-lesson",
    );
    db.prepare("UPDATE concepts SET value=? WHERE id=?").run(
      JSON.stringify(original.concepts[0]),
      "old-concept",
    );
    db.close();
    const store = new StudioStore(path);
    stores.push(store);
    expect(store.load()).toEqual(original);
    const service = new SubjectStore(store),
      physics = service.list().find((subject) => subject.name === "Physics")!;
    expect(physics.objective.length).toBeLessThanOrEqual(20000);
    expect(service.snapshot(physics.id).concepts[0].evidence).toBe(
      original.concepts[0].evidence,
    );
    const backupPath = join(dir, "long-backup.sqlite");
    await store.backup(backupPath);
    const restored = new StudioStore(":memory:");
    stores.push(restored);
    expect(restored.restoreBackup(backupPath)).toEqual(original);
  });
  it("maps the same legacy objective and optional goals when restoring a v2 backup as when opening it", async () => {
    const dir = await directory(),
      path = join(dir, "legacy.sqlite");
    writeLegacy(path);
    const restored = new StudioStore(":memory:");
    stores.push(restored);
    restored.restoreBackup(path);
    const service = new SubjectStore(restored),
      subject = service.list().find((subject) => subject.name === "Physics")!,
      snapshot = service.snapshot(subject.id);
    expect(subject.objective).toBe(legacyFixture().lessons[0].objective);
    expect(snapshot.curriculum).toContainEqual(
      expect.objectContaining({
        title: "Conservation laws",
        status: "introduced",
      }),
    );
    expect(subject.currentNodeId).toBeTruthy();
  });
});
