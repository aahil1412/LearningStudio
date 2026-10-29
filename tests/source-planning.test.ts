import { afterEach, describe, expect, it, vi } from "vitest";
import { StudioStore } from "../electron/storage";
import { SubjectStore } from "../electron/subjects";
import { PlanningService, validatePlanningData } from "../electron/planning";
import { defaultTeachingPreferences } from "../src/v21types";
import type { StudySourceContext } from "../src/sourceStudyTypes";

const resources: { store: StudioStore; planning: PlanningService }[] = [];
afterEach(async () => {
  for (const { store, planning } of resources.splice(0)) {
    planning.dispose();
    await Promise.resolve();
    store.close();
  }
});

function fixture(
  request?: ConstructorParameters<typeof PlanningService>[2]["request"],
) {
  const store = new StudioStore(":memory:"),
    subjects = new SubjectStore(store);
  const subject = subjects.create({
    name: "Supplied course",
    objective: "Follow my university syllabus",
    depth: "comprehensive",
  });
  subjects.apply({
    subjectId: subject.id,
    baseRevision: subject.revision,
    label: "Reviewed source outline",
    origin: "learner",
    operations: [
      {
        entity: "curriculum",
        op: "put",
        id: "source-root",
        value: {
          kind: "module",
          title: "Supplied university course",
          description: "Reviewed scope",
          position: 0,
          status: "not-started",
          userEdited: false,
        },
      },
      {
        entity: "curriculum",
        op: "put",
        id: "chapter-one",
        value: {
          parentId: "source-root",
          kind: "topic",
          title: "My edited foundations",
          description: "My preserved notes",
          position: 0,
          status: "covered",
          userEdited: true,
        },
      },
      {
        entity: "curriculum",
        op: "put",
        id: "chapter-two",
        value: {
          parentId: "source-root",
          kind: "topic",
          title: "Applications",
          description: "Source chapter two",
          position: 1,
          status: "not-started",
          userEdited: false,
        },
      },
    ],
  });
  const context: StudySourceContext = {
    schema: "study-source/v1",
    sources: [
      {
        id: "source",
        title: "Supplied university course",
        kind: "curriculum",
        revision: 1,
        fingerprint: "document-v1",
      },
    ],
    entries: [
      {
        id: "entry-one",
        sourceId: "source",
        kind: "chapter",
        title: "Foundations",
        order: 0,
        curriculumNodeId: "chapter-one",
      },
      {
        id: "entry-two",
        sourceId: "source",
        kind: "chapter",
        title: "Applications",
        order: 1,
        curriculumNodeId: "chapter-two",
      },
    ],
    excerpts: [],
    guidance: "Follow the reviewed source order.",
    warnings: [],
    usage: {
      estimatedTokens: 200,
      budget: 3000,
      truncated: false,
      fullSourceIncluded: false,
    },
  };
  const modelRequest = vi.fn(
    request ||
      (async (payload) => {
        const input = JSON.parse(payload.input[0].content);
        return JSON.stringify({
          nodes: [
            {
              id: "concept",
              parentId: input.module.id,
              kind: "concept",
              title: input.module.title + " idea",
              description: "Explain the idea.",
              prerequisites: [],
            },
          ],
        });
      }),
  );
  const sourceContext = vi.fn(() => structuredClone(context));
  const planning = new PlanningService(store, subjects, {
    models: async () => [
      { id: "test-model", name: "Test model", reasoningLevels: ["low"] },
    ],
    request: modelRequest,
    changed: () => {},
    sourceContext,
    timeoutMs: 1000,
  });
  resources.push({ store, planning });
  planning.putIntake({
    subjectId: subject.id,
    status: "ready",
    goal: subject.objective,
    depth: "comprehensive",
    preferences: defaultTeachingPreferences,
    assessment: "skipped",
  });
  const start = () =>
    planning.start({
      subjectId: subject.id,
      model: "test-model",
      reasoning: "low",
    });
  const finish = async (jobId: string, status = "awaiting-review") => {
    await vi.waitFor(() =>
      expect(planning.get(jobId).status, planning.get(jobId).error).toBe(
        status,
      ),
    );
    return planning.get(jobId);
  };
  return {
    store,
    subjects,
    subject,
    planning,
    context,
    modelRequest,
    sourceContext,
    start,
    finish,
  };
}

describe("source-aligned durable pathway jobs", () => {
  it("refines reviewed chapters in their source order without a generic outline call or overwriting learner edits", async () => {
    const value = fixture(),
      original = value.subjects.snapshot(value.subject.id);
    const done = await value.finish((await value.start()).id);
    expect(done.outline.map((item) => item.id)).toEqual([
      "chapter-one",
      "chapter-two",
    ]);
    expect(done.outline[0].title).toBe("My edited foundations");
    expect(value.modelRequest).toHaveBeenCalledTimes(2);
    for (const [index, call] of value.modelRequest.mock.calls.entries()) {
      const input = JSON.parse(call[0].input[0].content);
      expect(input.module.id).toBe(index === 0 ? "chapter-one" : "chapter-two");
      expect(input.sourceStudy.usage.fullSourceIncluded).toBe(false);
      expect(call[0].instructions).toContain("SOURCE_ALIGNMENT");
    }
    expect(done.sourceBinding).toEqual({
      sources: [{ id: "source", revision: 1, fingerprint: "document-v1" }],
      entryIds: ["entry-one", "entry-two"],
    });
    validatePlanningData(value.store.db);
    expect(value.subjects.snapshot(value.subject.id).curriculum).toEqual(
      original.curriculum,
    );
    value.subjects.accept({
      subjectId: value.subject.id,
      proposalId: done.proposalId!,
    });
    const saved = value.subjects.snapshot(value.subject.id);
    expect(saved.curriculum.find((node) => node.id === "chapter-one")).toEqual(
      original.curriculum.find((node) => node.id === "chapter-one"),
    );
    expect(
      saved.curriculum.filter((node) => node.kind === "concept"),
    ).toHaveLength(2);
    expect(
      saved.curriculum
        .filter((node) => node.kind === "concept")
        .every((node) => node.status === "not-started"),
    ).toBe(true);
  });
  it("does not checkpoint an admitted response against an edited source", async () => {
    let resolve: (raw: string) => void = () => {};
    const response = new Promise<string>((complete) => {
      resolve = complete;
    });
    const value = fixture(async () => response);
    const job = await value.start();
    await vi.waitFor(() => expect(value.modelRequest).toHaveBeenCalledTimes(1));
    value.context.sources[0].revision = 2;
    resolve(
      JSON.stringify({
        nodes: [
          { id: "new", kind: "concept", title: "An idea", prerequisites: [] },
        ],
      }),
    );
    const failed = await value.finish(job.id, "failed");
    expect(failed.error).toContain("changed after this planning checkpoint");
    expect(failed.chunks).toHaveLength(0);
    expect(failed.requestState).toBe("completed");
    await value.planning.resume({ jobId: job.id });
    await value.finish(job.id, "failed");
    expect(value.modelRequest).toHaveBeenCalledTimes(1);
  });
  it("keeps earlier chunks on failure and blocks a changed book fingerprint during explicit resume", async () => {
    let calls = 0;
    const value = fixture(async (payload) => {
      calls++;
      if (calls === 2) throw new Error("Provider interrupted");
      const input = JSON.parse(payload.input[0].content);
      return JSON.stringify({
        nodes: [
          {
            id: "idea",
            parentId: input.module.id,
            kind: "concept",
            title: "Saved concept",
            prerequisites: [],
          },
        ],
      });
    });
    const failed = await value.finish((await value.start()).id, "failed");
    expect(failed.completedModules).toBe(1);
    const checkpoint = failed.chunks;
    value.context.sources[0].fingerprint = "replaced-document";
    await value.planning.resume({ jobId: failed.id });
    const resumed = await value.finish(failed.id, "failed");
    expect(resumed.chunks).toEqual(checkpoint);
    expect(value.modelRequest).toHaveBeenCalledTimes(2);
    validatePlanningData(value.store.db);
  });
  it("does not silently truncate a large supplied curriculum or replace its reviewed pathway", async () => {
    const value = fixture(),
      original = value.subjects.snapshot(value.subject.id);
    value.context.usage.truncated = true;
    const failed = await value.finish((await value.start()).id, "failed");
    expect(failed.error).toContain(
      "approved pathway remains available in full",
    );
    expect(value.modelRequest).not.toHaveBeenCalled();
    expect(value.subjects.snapshot(value.subject.id).curriculum).toEqual(
      original.curriculum,
    );
  });
});
