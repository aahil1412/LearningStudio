import Database from "better-sqlite3";
import { writeFileSync } from "node:fs";
import { defaultData } from "../src/lib/defaults";
import { defaultAppearance } from "../src/lib/themes";
import type { StudioData } from "../src/types";

/** Original deterministic fixture; no account credentials or private data are used. */
export function writeLegacyV11Database(path: string): StudioData {
  const data = defaultData(),
    appearance = defaultAppearance(),
    at = "2026-10-28T10:00:00.000Z";
  appearance.mode = "light";
  appearance.light.colors.bg = "#e6ded0";
  appearance.light.colors.text = "#332f2b";
  appearance.light.typography.size = 19;
  appearance.light.typography.readingFont = "Cambria, serif";
  appearance.dark.colors.bg = "#302923";
  appearance.dark.colors.bold = "#e8c4a6";
  data.appearance = appearance;
  data.settings.profile =
    "Optional setting explicitly entered inside the fixture application.";
  data.settings.personalization = true;
  data.settings.assessments = false;
  data.lessons = [
    {
      id: "v11-physics",
      subject: "Physics",
      title: "A broad physics conversation",
      mode: "Explore",
      objective: "Understand physical principles and their applications",
      position: "Resume the conservation-law derivation",
      notes: "Original notes written before the upgrade.",
      createdAt: at,
      updatedAt: at,
      readingProgress: 0.4,
      goals: [
        {
          id: "conservation",
          title: "Conservation laws",
          status: "current",
          prerequisites: [],
        },
      ],
      messages: [
        {
          id: "v11-question",
          role: "user",
          text: "Teach broad physics without a diagnostic assessment.",
          createdAt: at,
          status: "complete",
        },
        {
          id: "v11-response",
          role: "assistant",
          text: "Conservation connects a change in one system to a compensating change elsewhere.",
          createdAt: at,
          status: "complete",
          blocks: [{ type: "equation", latex: "\\frac{dE}{dt}=0" }],
        },
        {
          id: "v11-partial",
          role: "assistant",
          text: "A useful limiting case starts with an isolated system…",
          createdAt: at,
          status: "partial",
          error: "A previous provider interruption; partial work was saved.",
        },
      ],
    },
  ];
  data.activeLessonId = "v11-physics";
  data.concepts = [
    {
      id: "v11-conservation",
      label: "Conservation",
      status: "partial",
      evidence: "The learner explained one isolated-system limiting case.",
      lessonId: "v11-physics",
    },
    {
      id: "v11-general",
      label: "An unmatched earlier concept",
      status: "encountered",
      evidence: "",
    },
  ];
  data.relations = [
    {
      id: "v11-relation",
      source: "v11-conservation",
      target: "v11-general",
      kind: "related",
    },
  ];
  data.library = [
    {
      id: "v11-library-subject",
      kind: "subject",
      title: "Physics",
      subject: "Physics",
      content: "",
      createdAt: at,
    },
    {
      id: "v11-document",
      kind: "document",
      title: "An earlier supplied document",
      parentId: "v11-library-subject",
      subject: "Physics",
      content:
        "A supplied statement about a boundary condition. This source has not been verified.",
      pages: [
        { page: 1, text: "A supplied statement about a boundary condition." },
      ],
      lessonIds: ["v11-physics"],
      createdAt: at,
    },
  ];
  data.reviewCards = [
    {
      id: "v11-card",
      lessonId: "v11-physics",
      conceptId: "v11-conservation",
      question: "What is two plus two?",
      answer: "4",
      grading: { kind: "numeric", expected: 4, tolerance: 0 },
      dueAt: "2026-10-29T10:00:00.000Z",
      intervalDays: 1,
      repetitions: 1,
      easeFactor: 2.5,
      lapses: 0,
      createdAt: at,
    },
  ];
  data.reviewHistory = [
    {
      id: "v11-review",
      cardId: "v11-card",
      answer: "4",
      grade: 5,
      correct: true,
      feedback: "The supplied numeric answer was correct.",
      method: "numeric",
      createdAt: at,
    },
  ];
  const db = new Database(path);
  try {
    db.exec(
      "CREATE TABLE settings(id TEXT PRIMARY KEY,value TEXT NOT NULL);CREATE TABLE lessons(id TEXT PRIMARY KEY,value TEXT NOT NULL);CREATE TABLE messages(id TEXT PRIMARY KEY,lesson_id TEXT NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,ordinal INTEGER NOT NULL,value TEXT NOT NULL);CREATE TABLE concepts(id TEXT PRIMARY KEY,value TEXT NOT NULL);CREATE TABLE relations(id TEXT PRIMARY KEY,value TEXT NOT NULL);CREATE TABLE library(id TEXT PRIMARY KEY,value TEXT NOT NULL);CREATE TABLE migrations(version INTEGER PRIMARY KEY,applied_at TEXT NOT NULL);CREATE VIRTUAL TABLE search_index USING fts5(record_id UNINDEXED,entity UNINDEXED,title,body,tokenize='unicode61');CREATE INDEX messages_lesson_ordinal ON messages(lesson_id,ordinal);INSERT INTO migrations VALUES(1,datetime('now')),(2,datetime('now'));PRAGMA user_version=2;",
    );
    const { lessons, concepts, relations, library, ...state } = data;
    db.prepare("INSERT INTO settings VALUES(?,?)").run(
      "state",
      JSON.stringify(state),
    );
    for (const [table, values] of Object.entries({
      lessons,
      concepts,
      relations,
      library,
    }))
      for (const value of values) {
        const { messages: _messages, ...rest } = value as any;
        db.prepare(`INSERT INTO ${table}(id,value) VALUES(?,?)`).run(
          value.id,
          JSON.stringify(table === "lessons" ? rest : value),
        );
      }
    for (const lesson of lessons)
      lesson.messages.forEach((message, index) =>
        db
          .prepare(
            "INSERT INTO messages(id,lesson_id,ordinal,value) VALUES(?,?,?,?)",
          )
          .run(message.id, lesson.id, index, JSON.stringify(message)),
      );
  } finally {
    db.close();
  }
  return data;
}
function inspectLegacy(path: string) {
  const db = new Database(path, { readonly: true, fileMustExist: true });
  try {
    const settings = JSON.parse(
      (
        db.prepare("SELECT value FROM settings WHERE id='state'").get() as {
          value: string;
        }
      ).value,
    );
    const values = (table: string) =>
      (
        db.prepare(`SELECT value FROM ${table}`).all() as { value: string }[]
      ).map((row) => JSON.parse(row.value));
    const lessons = values("lessons").map((lesson) => ({
      ...lesson,
      messages: (
        db
          .prepare(
            "SELECT value FROM messages WHERE lesson_id=? ORDER BY ordinal",
          )
          .all(lesson.id) as { value: string }[]
      ).map((row) => JSON.parse(row.value)),
    }));
    return {
      version: db.pragma("user_version", { simple: true }),
      hasSubjects: !!db
        .prepare("SELECT 1 FROM sqlite_master WHERE name='subjects'")
        .get(),
      data: {
        ...settings,
        lessons,
        concepts: values("concepts"),
        relations: values("relations"),
        library: values("library"),
      },
    };
  } finally {
    db.close();
  }
}
if (process.argv[2] === "--inspect")
  writeFileSync(
    process.argv[4],
    JSON.stringify(inspectLegacy(process.argv[3])),
  );
else if (process.argv[2])
  writeFileSync(
    process.argv[3],
    JSON.stringify(writeLegacyV11Database(process.argv[2])),
  );
