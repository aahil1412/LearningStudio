import { afterEach, describe, expect, it } from "vitest";
import { StudioStore } from "../electron/storage";
import { SubjectStore } from "../electron/subjects";
import { conceptFromEditor } from "../src/lib/graphConcept";
const stores: StudioStore[] = [];
afterEach(() => {
  for (const store of stores.splice(0)) store.close();
});
function setup() {
  const store = new StudioStore(":memory:");
  stores.push(store);
  const subjects = new SubjectStore(store),
    subject = subjects.create({
      name: "Mathematics",
      objective: "Understand mathematical reasoning",
      depth: "comprehensive",
    });
  return { store, subjects, subject };
}
describe("managed concept editor persistence", () => {
  it("retains canonical ownership/revision and position during sequential edits while rejecting stale writes", () => {
    const { store, subject, subjects } = setup();
    const created = conceptFromEditor({
      adding: true,
      id: "tangent",
      label: "Tangent",
      status: "unassessed",
      evidence: "Mentioned only",
      notes: "",
      lessonId: "",
      defaultSubjectId: subject.id,
      lessons: [],
    });
    store.save({ ...store.load(), concepts: [created] });
    const canonical = store.load().concepts[0];
    expect(canonical.subjectId).toBe(subject.id);
    expect(canonical.subjectRevision).toBe(1);
    const selected = { ...canonical, position: { x: 140, y: 250 } };
    const edited = conceptFromEditor({
      adding: false,
      id: "ignored",
      selected,
      label: "Tangent line",
      status: "partial",
      evidence: "Explains the local linear approximation",
      notes: "Check the limiting argument",
      lessonId: "",
      lessons: [],
    });
    expect(edited.subjectRevision).toBe(canonical.subjectRevision);
    expect(edited.position).toEqual({ x: 140, y: 250 });
    expect(edited.updatedAt).toBe(canonical.updatedAt);
    store.save({ ...store.load(), concepts: [edited] });
    const saved = store.load().concepts[0];
    expect(saved.label).toBe("Tangent line");
    expect(saved.subjectId).toBe(subject.id);
    expect(saved.subjectRevision).toBe(2);
    expect(subjects.snapshot(subject.id).concepts[0].status).toBe("partial");
    store.save({
      ...store.load(),
      concepts: [{ ...canonical, label: "A stale editor write" }],
    });
    expect(store.load().concepts[0].label).toBe("Tangent line");
    const second = conceptFromEditor({
      adding: false,
      id: "ignored",
      selected: store.load().concepts[0],
      label: "Local tangent approximation",
      status: "partial",
      evidence: saved.evidence,
      notes: "Retain my newer note",
      lessonId: "",
      lessons: [],
    });
    store.save({ ...store.load(), concepts: [second] });
    expect(store.load().concepts[0]).toMatchObject({
      subjectId: subject.id,
      subjectRevision: 3,
      label: "Local tangent approximation",
      notes: "Retain my newer note",
      position: { x: 140, y: 250 },
    });
  });
  it("uses the active subject for a new unlinked concept and honors explicit linked-lesson provenance", () => {
    const { store, subjects, subject } = setup();
    const other = subjects.create({
        name: "Physics",
        objective: "Understand physical models",
        depth: "overview",
      }),
      lesson = subjects.conversationCreate({
        subjectId: other.id,
        title: "Motion",
        mode: "Learn",
      });
    const record = conceptFromEditor({
      adding: true,
      id: "velocity",
      label: "Velocity",
      status: "unassessed",
      evidence: "",
      notes: "",
      lessonId: lesson.id,
      defaultSubjectId: subject.id,
      lessons: [lesson],
    });
    expect(record.subjectId).toBe(other.id);
    store.save({ ...store.load(), concepts: [record] });
    expect(
      subjects.snapshot(other.id).concepts.map((concept) => concept.id),
    ).toContain("velocity");
    expect(subjects.snapshot(subject.id).concepts).toHaveLength(0);
    expect(store.load().concepts[0].status).toBe("unassessed");
  });
});
