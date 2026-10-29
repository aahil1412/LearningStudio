import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import Database from "better-sqlite3";
import { createHash } from "node:crypto";
import { StudioStore } from "../electron/storage";
import { SubjectStore } from "../electron/subjects";
import { PlanningService, validatePlanningData } from "../electron/planning";
import { defaultTeachingPreferences } from "../src/v21types";
import { v21Tables } from "../electron/v21-schema";
import { AnnotationStore } from "../electron/annotations";
import {
  planningBudget,
  curriculumPreviewDescription,
} from "../src/lib/pathwayPlanning";
import { resolvePlanningPreference } from "../src/lib/planningPreferences";
import { defaultData } from "../src/lib/defaults";
import realPlanningFixture from "./fixtures/planning-real-biology-2026-10-28.json";

const resources: { store: StudioStore; planning: PlanningService }[] = [],
  dirs: string[] = [];
afterEach(async () => {
  for (const { planning, store } of resources.splice(0)) {
    if (store.db.open) {
      planning.dispose();
      await Promise.resolve();
      store.close();
    }
  }
  for (const path of dirs.splice(0))
    await rm(path, { recursive: true, force: true });
});
const outline = {
  modules: [
    {
      id: "foundations",
      title: "Foundations",
      description: "Important starting ideas",
      priorities: ["Understand relationships"],
      prerequisites: [],
    },
    {
      id: "applications",
      title: "Applications",
      description: "Use the foundations",
      priorities: ["Apply an idea"],
      prerequisites: ["foundations"],
    },
  ],
};
function fixture(
  path = ":memory:",
  request?: ConstructorParameters<typeof PlanningService>[2]["request"],
  timeoutMs = 1000,
) {
  const store = new StudioStore(path),
    subjects = new SubjectStore(store),
    subject =
      subjects.list().find((item) => item.name === "Biology") ||
      subjects.create({
        name: "Biology",
        objective: "Understand the whole discipline",
        depth: "comprehensive",
      });
  const modelRequest = vi.fn(
    request ||
      (async (payload) => {
        const input = JSON.parse(payload.input[0].content);
        return JSON.stringify(
          input.module
            ? {
                nodes: [
                  {
                    id: "idea",
                    kind: "topic",
                    title: input.module.title + " concept",
                    description: "Explain the central relationship",
                    parentId: input.module.id,
                    prerequisites: [],
                  },
                  {
                    id: "relationship",
                    parentId: "idea",
                    kind: "concept",
                    title: input.module.title + " relationship",
                    description: "Explain the relationship using an example.",
                    prerequisites: [],
                  },
                ],
              }
            : outline,
        );
      }),
  );
  const planning = new PlanningService(store, subjects, {
    models: async () => [
      { id: "test-model", name: "Test model", reasoningLevels: ["medium"] },
      {
        id: "alternate-model",
        name: "Alternate model",
        reasoningLevels: ["low", "medium"],
      },
    ],
    request: modelRequest,
    changed: () => {},
    timeoutMs,
  });
  resources.push({ store, planning });
  return { store, subjects, subject, planning, modelRequest };
}
function intake(value: ReturnType<typeof fixture>) {
  return value.planning.putIntake({
    subjectId: value.subject.id,
    status: "ready",
    goal: "Understand biology as a discipline",
    motivation: "Curiosity",
    familiarity: "New to molecular biology",
    gaps: "How molecules make cells work",
    depth: "comprehensive",
    preferences: { ...defaultTeachingPreferences, delivery: "visual-first" },
    assessment: "skipped",
  });
}
const start = (value: ReturnType<typeof fixture>) =>
  value.planning.start({
    subjectId: value.subject.id,
    model: "test-model",
    reasoning: "medium",
  });
const finished = async (
  value: ReturnType<typeof fixture>,
  jobId: string,
  status = "awaiting-review",
) => {
  await vi.waitFor(() => {
    const saved = value.planning.get(jobId);
    expect(saved.status, saved.error).toBe(status);
  });
  return value.planning.get(jobId);
};

describe("durable subject intake and bounded planning", () => {
  it("reviews and applies saved dependency-complete modules while an unfinished request remains running", async () => {
    let completeSecond: (value: string) => void = () => {};
    const pending = new Promise<string>((resolve) => {
      completeSecond = resolve;
    });
    const value = fixture(undefined, async (payload) => {
      const input = JSON.parse(payload.input[0].content);
      if (!input.module) return JSON.stringify(outline);
      if (input.module.title === "Applications") return pending;
      return JSON.stringify({
        nodes: [
          {
            id: "idea",
            kind: "concept",
            title: "Foundation concept",
            description: "Recognize the central relationship.",
            prerequisites: [],
          },
        ],
      });
    });
    intake(value);
    const job = await start(value);
    await vi.waitFor(() =>
      expect(value.planning.get(job.id).completedModules).toBe(1),
    );
    const proposal = value.planning.reviewSaved(job.id);
    expect(value.planning.reviewSaved(job.id).id).toBe(proposal.id);
    expect(value.subjects.snapshot(value.subject.id).curriculum).toEqual([]);
    expect(
      proposal.operations.filter(
        (operation) => operation.entity === "curriculum",
      ),
    ).toHaveLength(2);
    value.subjects.accept({
      subjectId: value.subject.id,
      proposalId: proposal.id,
    });
    expect(value.planning.get(job.id).status).toBe("running");
    expect(value.subjects.snapshot(value.subject.id).curriculum).toHaveLength(
      2,
    );
    completeSecond(
      JSON.stringify({
        nodes: [
          {
            id: "idea",
            kind: "concept",
            title: "Application concept",
            prerequisites: [],
          },
        ],
      }),
    );
    const done = await finished(value, job.id);
    expect(done.proposalId).not.toBe(proposal.id);
    value.subjects.accept({
      subjectId: value.subject.id,
      proposalId: done.proposalId!,
    });
    const saved = value.subjects.snapshot(value.subject.id);
    expect(saved.curriculum).toHaveLength(4);
    expect(
      saved.curriculum.every((node) => node.status === "not-started"),
    ).toBe(true);
  });
  it("does not expose a partial proposal whose module depends on an unfinished later module", async () => {
    const pending = new Promise<string>(() => {});
    const reordered = {
      modules: [
        { ...outline.modules[0], prerequisites: ["applications"] },
        { ...outline.modules[1], prerequisites: [] },
      ],
    };
    const value = fixture(undefined, async (payload) => {
      const input = JSON.parse(payload.input[0].content);
      if (!input.module) return JSON.stringify(reordered);
      return input.module.title === "Applications"
        ? pending
        : JSON.stringify({
            nodes: [
              {
                id: "idea",
                kind: "concept",
                title: "A concept",
                prerequisites: [],
              },
            ],
          });
    });
    intake(value);
    const job = await start(value);
    await vi.waitFor(() =>
      expect(value.planning.get(job.id).completedModules).toBe(1),
    );
    expect(() => value.planning.reviewSaved(job.id)).toThrow(
      "prerequisites ready",
    );
    expect(value.subjects.snapshot(value.subject.id).curriculum).toEqual([]);
  });
  it("replaces a stale checkpoint review after learner edits without overwriting those edits", async () => {
    const value = fixture();
    intake(value);
    const done = await finished(value, (await start(value)).id);
    const first = value.planning.reviewSaved(done.id);
    value.subjects.apply({
      subjectId: value.subject.id,
      baseRevision: value.subjects.snapshot(value.subject.id).subject.revision,
      label: "Learner topic",
      origin: "learner",
      operations: [
        {
          entity: "curriculum",
          op: "put",
          id: "learner-topic",
          value: {
            kind: "topic",
            title: "My topic",
            description: "Keep this",
            status: "covered",
            userEdited: true,
          },
        },
      ],
    });
    const second = value.planning.reviewSaved(done.id);
    expect(second.id).not.toBe(first.id);
    expect(
      value.store.db
        .prepare("SELECT state FROM memory_proposals WHERE id=?")
        .get(first.id),
    ).toEqual({ state: "rejected" });
    value.subjects.accept({
      subjectId: value.subject.id,
      proposalId: second.id,
    });
    expect(
      value.subjects
        .snapshot(value.subject.id)
        .curriculum.find((node) => node.id === "learner-topic"),
    ).toMatchObject({
      description: "Keep this",
      status: "covered",
      userEdited: true,
    });
  });
  it("records honest per-request timing and a current module without claiming remote completion", async () => {
    const value = fixture(undefined, async (payload) =>
      JSON.parse(payload.input[0].content).module
        ? new Promise<string>(() => {})
        : JSON.stringify(outline),
    );
    intake(value);
    const job = await start(value);
    await vi.waitFor(() =>
      expect(value.planning.get(job.id).currentModuleId).toBeTruthy(),
    );
    const saved = value.planning.get(job.id);
    expect(saved.requestState).toBe("possibly-admitted");
    expect(
      Date.parse(saved.requestDeadlineAt!) -
        Date.parse(saved.requestStartedAt!),
    ).toBe(1000);
    expect(saved.heartbeatAt).toBeTruthy();
    expect(saved.completedModules).toBe(0);
  });
  it("does not request a model before explicit setup completion or skip", async () => {
    const value = fixture();
    await expect(start(value)).rejects.toThrow("learning setup");
    expect(value.modelRequest).not.toHaveBeenCalled();
    const saved = intake(value);
    expect(saved.preferences.delivery).toBe("visual-first");
    expect(saved.assessment).toBe("skipped");
    expect(value.modelRequest).not.toHaveBeenCalled();
    expect(() => value.planning.putIntake({ ...saved, revision: 0 })).toThrow(
      "changed",
    );
  });
  it("checkpoints an outline and bounded modules, then awaits an obvious review without applying knowledge", async () => {
    const value = fixture();
    intake(value);
    const job = await start(value),
      done = await finished(value, job.id);
    expect(done.outline).toHaveLength(2);
    expect(done.completedModules).toBe(2);
    expect(done.totalModules).toBe(2);
    expect(done.chunks).toHaveLength(2);
    expect(done.proposalId).toBeTruthy();
    expect(value.modelRequest).toHaveBeenCalledTimes(3);
    expect(value.subjects.snapshot(value.subject.id).curriculum).toEqual([]);
    const moduleInput = JSON.parse(
      value.modelRequest.mock.calls[1][0].input[0].content,
    );
    expect(moduleInput.intake.preferences.delivery).toBe("visual-first");
    expect(moduleInput.intake.familiarity).toContain("New");
    value.subjects.accept({
      subjectId: value.subject.id,
      proposalId: done.proposalId!,
    });
    expect(value.planning.markComplete(job.id).status).toBe("complete");
    expect(
      value.subjects
        .snapshot(value.subject.id)
        .curriculum.every((node) => node.status === "not-started"),
    ).toBe(true);
  });
  it("retains successful chunks after failure and explicitly resumes only unfinished work", async () => {
    let failed = false;
    const value = fixture(undefined, async (payload) => {
      const input = JSON.parse(payload.input[0].content);
      if (!input.module) return JSON.stringify(outline);
      if (input.module.title === "Applications" && !failed) {
        failed = true;
        throw new Error("Simulated provider interruption");
      }
      return JSON.stringify({
        nodes: [
          {
            id: "idea",
            kind: "topic",
            title: input.module.title + " idea",
            prerequisites: [],
          },
          {
            id: "relationship",
            parentId: "idea",
            kind: "concept",
            title: input.module.title + " relationship",
            prerequisites: [],
          },
        ],
      });
    });
    intake(value);
    const job = await start(value),
      failedJob = await finished(value, job.id, "failed");
    expect(failedJob.completedModules).toBe(1);
    expect(failedJob.chunks[0].nodes[0].title).toBe("Foundations");
    expect(value.subjects.snapshot(value.subject.id).curriculum).toEqual([]);
    await value.planning.resume({ jobId: job.id });
    const done = await finished(value, job.id);
    expect(done.completedModules).toBe(2);
    expect(done.retryCount).toBe(1);
    expect(value.modelRequest).toHaveBeenCalledTimes(4);
    expect(
      value.modelRequest.mock.calls.filter(
        ([payload]) =>
          payload.input[0].content.includes('"module":{"id"') &&
          JSON.parse(payload.input[0].content).module.title === "Foundations",
      ),
    ).toHaveLength(1);
  });
  it("recovers interrupted requests from SQLite without silently replaying them", async () => {
    const dir = await mkdtemp(join(process.cwd(), ".v21-planning-"));
    dirs.push(dir);
    const path = join(dir, "library.sqlite");
    const pending = new Promise<string>(() => {}),
      value = fixture(path, async (payload) =>
        JSON.parse(payload.input[0].content).module
          ? pending
          : JSON.stringify(outline),
      );
    intake(value);
    const job = await start(value);
    await vi.waitFor(() =>
      expect(value.planning.get(job.id).requestState).toBe("possibly-admitted"),
    );
    await vi.waitFor(() =>
      expect(value.planning.get(job.id).outline).toHaveLength(2),
    );
    value.planning.dispose();
    value.store.close();
    await Promise.resolve();
    const reopened = fixture(path),
      saved = reopened.planning.get(job.id);
    expect(saved.status).toBe("interrupted");
    expect(saved.outline).toHaveLength(2);
    expect(reopened.modelRequest).not.toHaveBeenCalled();
    expect(
      reopened.planning.intake(value.subject.id)?.preferences.delivery,
    ).toBe("visual-first");
    await reopened.planning.resume({ jobId: job.id });
    expect((await finished(reopened, job.id)).completedModules).toBe(2);
    expect(reopened.modelRequest).toHaveBeenCalledTimes(2);
  });
  it("cancels late responses without changing the subject or losing prior checkpoints", async () => {
    let release: (raw: string) => void = () => {};
    const pending = new Promise<string>((resolve) => {
        release = resolve;
      }),
      value = fixture(undefined, async () => pending);
    intake(value);
    const job = await start(value);
    await vi.waitFor(() =>
      expect(value.planning.get(job.id).requestState).toBe("possibly-admitted"),
    );
    expect(value.planning.cancel(job.id).status).toBe("canceled");
    release(JSON.stringify(outline));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(value.planning.get(job.id).status).toBe("canceled");
    expect(value.subjects.snapshot(value.subject.id).curriculum).toEqual([]);
  });
  it("turns timeouts and unavailable models into durable recoverable failure states", async () => {
    const value = fixture(undefined, () => new Promise<string>(() => {}), 15);
    intake(value);
    const job = await start(value);
    expect((await finished(value, job.id, "failed")).error).toContain(
      "time limit",
    );
    const unavailable = await value.planning.start({
      subjectId: value.subject.id,
      model: "missing-model",
    });
    expect(unavailable.status).toBe("failed");
    expect(unavailable.error).toContain("unavailable");
    expect(value.modelRequest).toHaveBeenCalledTimes(1);
  });
  it("rejects unknown dependencies and cycles without writing a malformed curriculum", async () => {
    const value = fixture(undefined, async (payload) =>
      JSON.stringify(
        JSON.parse(payload.input[0].content).module
          ? {
              nodes: [
                {
                  id: "x",
                  kind: "concept",
                  title: "Broken",
                  prerequisites: ["not-a-real-id"],
                },
              ],
            }
          : outline,
      ),
    );
    intake(value);
    const job = await start(value);
    const failedJob = await finished(value, job.id, "failed");
    expect(failedJob.completedModules).toBe(0);
    expect(failedJob.error).toContain("unknown dependency");
    expect(value.subjects.snapshot(value.subject.id).curriculum).toEqual([]);
  });
  it("deduplicates additions and preserves learner-edited nodes and progress", async () => {
    const value = fixture();
    value.subjects.apply({
      subjectId: value.subject.id,
      baseRevision: value.subject.revision,
      label: "A learner edit",
      origin: "learner",
      operations: [
        {
          entity: "curriculum",
          op: "put",
          id: "manual-foundations",
          value: {
            kind: "module",
            title: "Foundations",
            description: "Keep my explanation",
            status: "covered",
            userEdited: true,
          },
        },
      ],
    });
    intake(value);
    const done = await finished(value, (await start(value)).id);
    value.subjects.accept({
      subjectId: value.subject.id,
      proposalId: done.proposalId!,
    });
    const snapshot = value.subjects.snapshot(value.subject.id);
    expect(
      snapshot.curriculum.filter((node) => node.title === "Foundations"),
    ).toHaveLength(1);
    expect(
      snapshot.curriculum.find((node) => node.id === "manual-foundations"),
    ).toMatchObject({
      description: "Keep my explanation",
      status: "covered",
      userEdited: true,
    });
  });
  it("supports editing priorities and regenerating one section while keeping other chunks", async () => {
    const value = fixture();
    intake(value);
    const done = await finished(value, (await start(value)).id);
    value.planning.editModule({
      jobId: done.id,
      moduleId: done.outline[1].id,
      title: "Applied relationships",
      description: "A revised learner focus",
      priorities: ["Compare two models"],
    });
    expect(value.planning.get(done.id).completedModules).toBe(1);
    await value.planning.resume({ jobId: done.id });
    const updated = await finished(value, done.id);
    expect(updated.outline[1].title).toBe("Applied relationships");
    expect(value.modelRequest).toHaveBeenCalledTimes(4);
    expect(
      value.store.db
        .prepare("SELECT state FROM memory_proposals WHERE id=?")
        .get(done.proposalId),
    ).toEqual({ state: "rejected" });
  });
  it("keeps retry model indexes consistent with durable metadata and honors explicit provider-default reasoning", async () => {
    const value = fixture();
    intake(value);
    const done = await finished(value, (await start(value)).id);
    value.planning.editModule({
      jobId: done.id,
      moduleId: done.outline[1].id,
      title: "Applications",
      description: "Keep the focus",
      priorities: ["Apply concepts"],
    });
    await value.planning.resume({
      jobId: done.id,
      model: "alternate-model",
      reasoning: "",
    });
    const retried = await finished(value, done.id);
    expect(retried.model).toBe("alternate-model");
    expect(retried.reasoning).toBe("");
    expect(
      value.store.db
        .prepare("SELECT model FROM planning_jobs WHERE id=?")
        .get(done.id),
    ).toEqual({ model: "alternate-model" });
    expect(() => validatePlanningData(value.store.db)).not.toThrow();
  });
  it("limits remote planning calls to one while independently checkpointing different subjects", async () => {
    let active = 0,
      maximum = 0;
    const value = fixture(undefined, async (payload) => {
      active++;
      maximum = Math.max(active, maximum);
      await new Promise((resolve) => setTimeout(resolve, 20));
      active--;
      const input = JSON.parse(payload.input[0].content);
      return JSON.stringify(
        input.module
          ? {
              nodes: [
                {
                  id: "one",
                  kind: "topic",
                  title: input.module.title + " relationship",
                  prerequisites: [],
                },
                {
                  id: "relationship",
                  parentId: "one",
                  kind: "concept",
                  title: input.module.title + " causal relationship",
                  prerequisites: [],
                },
              ],
            }
          : outline,
      );
    });
    intake(value);
    const other = value.subjects.create({
      name: "Physics",
      objective: "Understand a broad discipline",
      depth: "overview",
    });
    value.planning.putIntake({
      ...value.planning.intake(value.subject.id)!,
      subjectId: other.id,
      revision: 0,
    });
    const first = await start(value),
      second = await value.planning.start({
        subjectId: other.id,
        model: "test-model",
      });
    await finished(value, first.id);
    await finished(value, second.id);
    expect(maximum).toBe(1);
    expect(value.modelRequest).toHaveBeenCalledTimes(6);
  });
  it("keeps similarly named topics in different modules distinct", async () => {
    const value = fixture(undefined, async (payload) =>
      JSON.stringify(
        JSON.parse(payload.input[0].content).module
          ? {
              nodes: [
                {
                  id: "overview",
                  kind: "topic",
                  title: "Overview",
                  prerequisites: [],
                },
                {
                  id: "relationship",
                  parentId: "overview",
                  kind: "concept",
                  title:
                    JSON.parse(payload.input[0].content).module.title +
                    " relationship",
                  prerequisites: [],
                },
              ],
            }
          : outline,
      ),
    );
    intake(value);
    const done = await finished(value, (await start(value)).id);
    value.subjects.accept({
      subjectId: value.subject.id,
      proposalId: done.proposalId!,
    });
    const topics = value.subjects
      .snapshot(value.subject.id)
      .curriculum.filter((node) => node.title === "Overview");
    expect(topics).toHaveLength(2);
    expect(new Set(topics.map((node) => node.parentId)).size).toBe(2);
  });
});

describe("planning latency and payload regressions (offline provider adapters)", () => {
  it("does not load checkpoint bodies for the global background indicator", async () => {
    const value = fixture();
    intake(value);
    const done = await finished(value, (await start(value)).id);
    const get = vi.spyOn(value.planning, "get");
    const metadata = value.planning.handle("planning:list") as ReturnType<
      PlanningService["list"]
    >;
    expect(metadata.find((job) => job.id === done.id)?.completedModules).toBe(
      2,
    );
    expect(metadata.every((job) => job.chunks.length === 0)).toBe(true);
    expect(get).not.toHaveBeenCalled();
    get.mockRestore();
  });
  it.each(["overview", "comprehensive", "advanced"] as const)(
    "uses a compact %s checkpoint contract rather than requesting lesson prose",
    async (depth) => {
      const value = fixture();
      intake(value);
      value.planning.putIntake({
        ...value.planning.intake(value.subject.id)!,
        depth,
      });
      const done = await finished(value, (await start(value)).id);
      const call = value.modelRequest.mock.calls.find(
        ([payload]) => JSON.parse(payload.input[0].content).module,
      )!;
      const input = JSON.parse(call[0].input[0].content),
        budget = planningBudget(depth);
      expect(input.budget.maxNodes).toBe(budget.maxNodes);
      expect(call[0].instructions).toContain(
        `at most ${budget.maxNodes} nodes total`,
      );
      expect(call[0].instructions).toContain(
        "Do not write explanations, complete questions, answer options or answer keys",
      );
      expect(input.knownNodes.length).toBeLessThanOrEqual(24);
      expect(
        done.chunks.every((chunk) =>
          chunk.nodes.some((node) => node.kind === "concept"),
        ),
      ).toBe(true);
      expect(
        done.chunks
          .flatMap((chunk) => chunk.nodes)
          .every((node) => node.description.length <= budget.descriptionChars),
      ).toBe(true);
    },
  );
  it("rejects an oversized checkpoint without saving partial unvalidated nodes", async () => {
    const value = fixture(undefined, async (payload) =>
      JSON.stringify(
        JSON.parse(payload.input[0].content).module
          ? {
              nodes: Array.from({ length: 11 }, (_, index) => ({
                id: "concept-" + index,
                kind: "concept",
                title: "Idea " + index,
                prerequisites: [],
              })),
            }
          : outline,
      ),
    );
    intake(value);
    value.planning.putIntake({
      ...value.planning.intake(value.subject.id)!,
      depth: "overview",
    });
    const failed = await finished(value, (await start(value)).id, "failed");
    expect(failed.completedModules).toBe(0);
    expect(failed.chunks).toEqual([]);
    expect(value.subjects.snapshot(value.subject.id).curriculum).toEqual([]);
  });
  it("requires meaningful concepts instead of accepting an untrackable list of lesson paragraphs", async () => {
    const value = fixture(undefined, async (payload) =>
      JSON.stringify(
        JSON.parse(payload.input[0].content).module
          ? {
              nodes: [
                {
                  id: "paragraph",
                  kind: "lesson",
                  title: "A paragraph about cells",
                  prerequisites: [],
                },
              ],
            }
          : outline,
      ),
    );
    intake(value);
    const failed = await finished(value, (await start(value)).id, "failed");
    expect(failed.error).toContain("meaningful concept records");
    expect(failed.chunks).toEqual([]);
  });
  it("keeps check answers out of new learner-visible curriculum records", async () => {
    const value = fixture(undefined, async (payload) =>
      JSON.stringify(
        JSON.parse(payload.input[0].content).module
          ? {
              nodes: [
                {
                  id: "idea",
                  kind: "concept",
                  title:
                    JSON.parse(payload.input[0].content).module.title + " idea",
                  description: "Understand a relationship.",
                  prerequisites: [],
                },
                {
                  id: "check",
                  kind: "lesson",
                  title: "Optional check",
                  description:
                    "Which statement is correct? A) Guess. B) Reason. Answer: B. Explain why.",
                  prerequisites: ["idea"],
                },
              ],
            }
          : outline,
      ),
    );
    intake(value);
    const done = await finished(value, (await start(value)).id);
    for (const node of done.chunks
      .flatMap((chunk) => chunk.nodes)
      .filter((node) => node.title === "Optional check")) {
      expect(node.description).not.toMatch(/Answer:|A\)|B\)/);
      expect(node.description).toContain("feedback");
    }
  });
});

describe("captured real-service biology regression fixtures (offline replay, not a new live run)", () => {
  it("reviews and applies an old nineteen-node checkpoint without imposing new generation limits or resetting it", async () => {
    const value = fixture(undefined, async (payload) =>
      JSON.parse(payload.input[0].content).module
        ? new Promise<string>(() => {})
        : JSON.stringify(outline),
    );
    intake(value);
    const started = await start(value);
    await vi.waitFor(() =>
      expect(value.planning.get(started.id).outline).toHaveLength(2),
    );
    const job = value.planning.cancel(started.id);
    const captured = realPlanningFixture.modules[0].nodes;
    const rootId = captured[0].id,
      moduleId = job.outline[0].id;
    const nodes = captured.map((node) => ({
      ...node,
      id: node.id === rootId ? moduleId : node.id,
      parentId:
        "parentId" in node && node.parentId === rootId
          ? moduleId
          : "parentId" in node
            ? node.parentId
            : undefined,
      prerequisites: node.prerequisites.map((prerequisite) =>
        prerequisite === rootId ? moduleId : prerequisite,
      ),
    }));
    expect(nodes).toHaveLength(19);
    const chunk = { moduleId, nodes, completedAt: new Date().toISOString() };
    value.store.db
      .prepare(
        "INSERT INTO planning_chunks(job_id,module_id,ordinal,value,completed_at) VALUES(?,?,?,?,?)",
      )
      .run(job.id, moduleId, 0, JSON.stringify(chunk), chunk.completedAt);
    job.completedModules = 1;
    const { chunks: _chunks, ...metadata } = job;
    value.store.db
      .prepare(
        "UPDATE planning_jobs SET completed_modules=1,value=? WHERE id=?",
      )
      .run(JSON.stringify(metadata), job.id);
    expect(() => validatePlanningData(value.store.db)).not.toThrow();
    const proposal = value.planning.reviewSaved(job.id);
    value.subjects.accept({
      subjectId: value.subject.id,
      proposalId: proposal.id,
    });
    expect(value.subjects.snapshot(value.subject.id).curriculum).toHaveLength(
      19,
    );
    expect(value.planning.get(job.id).chunks[0].nodes).toHaveLength(19);
    expect(
      value.planning
        .get(job.id)
        .chunks[0].nodes.some((node) => node.description.includes("Answer:")),
    ).toBe(true);
    expect(
      value.subjects
        .snapshot(value.subject.id)
        .curriculum.some((node) => node.description.includes("Answer:")),
    ).toBe(false);
  });
  it("preserves the provenance and detects the previously observed oversized overview output", async () => {
    expect(realPlanningFixture.provenance).toContain(
      "Captured real connected-model output",
    );
    const captured = realPlanningFixture.modules[0].nodes.filter(
      (node) => node.kind !== "module",
    );
    expect(captured.length).toBeGreaterThan(
      planningBudget("overview").maxNodes,
    );
    const value = fixture(undefined, async (payload) =>
      JSON.stringify(
        JSON.parse(payload.input[0].content).module
          ? { nodes: captured }
          : outline,
      ),
    );
    intake(value);
    value.planning.putIntake({
      ...value.planning.intake(value.subject.id)!,
      depth: "overview",
    });
    const failed = await finished(value, (await start(value)).id, "failed");
    expect(failed.chunks).toEqual([]);
  });
  it("hides captured answer-key descriptions without mutating the saved original output", () => {
    const checks = realPlanningFixture.modules[0].nodes.filter((node) =>
      /Answer:/.test(node.description),
    );
    expect(checks).toHaveLength(3);
    for (const node of checks) {
      const preview = curriculumPreviewDescription(
        node.description,
        node.title,
      );
      expect(preview).not.toMatch(/Answer:|A\)|B\)|C\)/);
      expect(preview).toContain("feedback");
      expect(node.description).toContain("Answer:");
    }
  });
});

describe("independent planning model preferences", () => {
  const models = [
    {
      id: "study-model",
      name: "Study model",
      reasoningLevels: ["xhigh", "medium", "low"],
    },
  ];
  it("defaults legacy planning to supported medium without changing tutor xhigh", () => {
    const settings = defaultData().settings;
    settings.models.tutor = { model: "study-model", reasoning: "xhigh" };
    expect(resolvePlanningPreference(settings, models)).toEqual({
      model: "study-model",
      reasoning: "medium",
    });
    expect(settings.models.tutor.reasoning).toBe("xhigh");
    expect(settings.planning).toBeUndefined();
  });
  it("honors explicit provider-default reasoning and separately selected planning models", () => {
    const settings = defaultData().settings;
    settings.models.tutor = { model: "study-model", reasoning: "xhigh" };
    settings.planning = { model: "planning-model", reasoning: "" };
    expect(
      resolvePlanningPreference(settings, [
        ...models,
        { id: "planning-model", name: "Planner", reasoningLevels: ["low"] },
      ]),
    ).toEqual({ model: "planning-model", reasoning: "" });
  });
  it("rejects explicit unavailable models and unsupported reasoning instead of switching silently", () => {
    const settings = defaultData().settings;
    settings.planning = { model: "missing-model", reasoning: "medium" };
    expect(() => resolvePlanningPreference(settings, models)).toThrow(
      "unavailable",
    );
    settings.planning = { model: "study-model", reasoning: "unsupported" };
    expect(() => resolvePlanningPreference(settings, models)).toThrow(
      "does not support",
    );
  });
});

describe("additive version 4 migration and recovery", () => {
  it("preserves independent Planning settings and the original tutor through save, reopen and backup restore", async () => {
    const dir = await mkdtemp(join(process.cwd(), ".v21-planning-"));
    dirs.push(dir);
    const path = join(dir, "settings.sqlite"),
      backup = join(dir, "settings-backup.sqlite");
    const value = fixture(path),
      data = value.store.load();
    data.settings.models.tutor = { model: "test-model", reasoning: "xhigh" };
    data.settings.planning = { model: "alternate-model", reasoning: "" };
    value.store.save(data);
    await value.store.backup(backup);
    value.planning.dispose();
    value.store.close();
    const reopened = fixture(path);
    expect(reopened.store.load().settings.models.tutor).toEqual({
      model: "test-model",
      reasoning: "xhigh",
    });
    expect(reopened.store.load().settings.planning).toEqual({
      model: "alternate-model",
      reasoning: "",
    });
    const target = fixture(join(dir, "restored.sqlite"));
    target.store.restoreBackup(backup);
    expect(target.store.load().settings.models.tutor).toEqual(
      data.settings.models.tutor,
    );
    expect(target.store.load().settings.planning).toEqual(
      data.settings.planning,
    );
  });
  it("backs up an actual populated v3 image before migration and preserves all user records", async () => {
    const dir = await mkdtemp(join(process.cwd(), ".v21-planning-"));
    dirs.push(dir);
    const path = join(dir, "library.sqlite"),
      value = fixture(path);
    const lesson = value.subjects.conversationCreate({
        subjectId: value.subject.id,
        title: "Original conversation",
      }),
      data = value.store.load();
    data.lessons.find((item) => item.id === lesson.id)!.notes =
      "An original note";
    data.lessons.find((item) => item.id === lesson.id)!.messages = [
      {
        id: "original-message",
        role: "assistant",
        text: "Original lesson",
        createdAt: "2026-10-28",
      },
    ];
    data.settings.profile = "A user-provided preference";
    data.appearance = { custom: "untouched" };
    value.store.save(data);
    const before = value.store.load();
    value.planning.dispose();
    value.store.db.transaction(() => {
      for (const table of [...v21Tables].reverse())
        value.store.db.exec(`DROP TABLE ${table}`);
      value.store.db.exec(
        "DELETE FROM migrations WHERE version=4; PRAGMA user_version=3;",
      );
    })();
    value.store.close();
    const reopened = fixture(path);
    expect(reopened.store.migrationBackupPath).toContain(".pre-v4-");
    expect(reopened.store.db.pragma("user_version", { simple: true })).toBe(4);
    expect(reopened.store.load()).toEqual(before);
    const backup = new Database(reopened.store.migrationBackupPath!, {
      readonly: true,
    });
    expect(backup.pragma("user_version", { simple: true })).toBe(3);
    expect(
      backup
        .prepare("SELECT name FROM sqlite_master WHERE name='planning_jobs'")
        .get(),
    ).toBeUndefined();
    backup.close();
    const bytes = await readFile(reopened.store.migrationBackupPath!),
      hash = createHash("sha256").update(bytes).digest("hex");
    reopened.store.close();
    const again = fixture(path);
    expect(again.store.migrationBackupPath).toBeUndefined();
    expect(
      createHash("sha256")
        .update(await readFile(reopened.store.migrationBackupPath!))
        .digest("hex"),
    ).toBe(hash);
  });
  it("backs up and restores intake, checkpointed jobs, and ordinary learning data transactionally", async () => {
    const dir = await mkdtemp(join(process.cwd(), ".v21-planning-"));
    dirs.push(dir);
    const value = fixture(join(dir, "source.sqlite"));
    intake(value);
    const done = await finished(value, (await start(value)).id),
      path = join(dir, "backup.sqlite");
    await value.store.backup(path);
    const target = fixture(join(dir, "target.sqlite"));
    target.store.restoreBackup(path);
    expect(target.planning.intake(value.subject.id)).toMatchObject({
      goal: "Understand biology as a discipline",
      preferences: { delivery: "visual-first" },
    });
    expect(target.planning.get(done.id).chunks).toHaveLength(2);
    expect(target.planning.get(done.id).proposalId).toBe(done.proposalId);
    expect(target.store.db.pragma("foreign_key_check")).toEqual([]);
  });
  it("retains subject preferences in portable archives without exporting admitted job requests", () => {
    const value = fixture();
    intake(value);
    const archive = value.subjects.exportArchive(value.subject.id);
    expect(archive.tables.subject_intakes).toHaveLength(1);
    expect(archive.tables.planning_jobs).toBeUndefined();
    const store = new StudioStore(":memory:"),
      subjects = new SubjectStore(store),
      planning = new PlanningService(store, subjects, {
        models: async () => [],
        request: async () => "",
        changed: () => {},
      });
    resources.push({ store, planning });
    subjects.restore({ archive });
    expect(planning.intake(value.subject.id)?.preferences.delivery).toBe(
      "visual-first",
    );
    expect(planning.list()).toEqual([]);
  });
  it("rejects a corrupted checkpoint backup before modifying the target library", async () => {
    const dir = await mkdtemp(join(process.cwd(), ".v21-planning-"));
    dirs.push(dir);
    const value = fixture(join(dir, "source.sqlite"));
    intake(value);
    const done = await finished(value, (await start(value)).id),
      path = join(dir, "corrupt.sqlite");
    await value.store.backup(path);
    const db = new Database(path);
    db.prepare("UPDATE planning_jobs SET completed_modules=19 WHERE id=?").run(
      done.id,
    );
    db.close();
    const target = fixture(join(dir, "target.sqlite")),
      before = target.store.load();
    expect(() => target.store.restoreBackup(path)).toThrow("inconsistent");
    expect(target.store.load()).toEqual(before);
    expect(target.planning.list()).toEqual([]);
  });
  it("round-trips annotated sources, graph suggestions and pinned positions in a subject archive", () => {
    const value = fixture();
    intake(value);
    const lesson = value.subjects.conversationCreate({
        subjectId: value.subject.id,
        title: "Molecular relationships",
      }),
      data = value.store.load();
    data.lessons.find((item) => item.id === lesson.id)!.messages = [
      {
        id: "source-message",
        role: "assistant",
        text: "A codon contains three RNA bases.",
        createdAt: "2026-10-28",
      },
    ];
    data.library.push({
      id: "source-note",
      kind: "note",
      subject: "Biology",
      subjectId: value.subject.id,
      title: "Codon note",
      content: "A codon is a three-base coding unit.",
      createdAt: "2026-10-28",
    });
    value.store.save(data);
    value.subjects.apply({
      subjectId: value.subject.id,
      baseRevision: value.subjects.snapshot(value.subject.id).subject.revision,
      label: "An unassessed concept",
      origin: "learner",
      operations: [
        {
          entity: "concept",
          op: "put",
          id: "codon-concept",
          value: {
            label: "codon",
            status: "unassessed",
            coverage: "introduced",
            evidence: "Explanation only",
            lessonId: lesson.id,
          },
        },
      ],
    });
    const annotations = new AnnotationStore(value.store),
      highlight = annotations.create({
        subjectId: value.subject.id,
        sourceKind: "message",
        sourceId: "source-message",
        conversationId: lesson.id,
        quote: "A codon contains three RNA bases.",
        color: "green",
        note: "A saved annotation",
        tags: ["RNA"],
      });
    const graph = annotations.graph({ subjectId: value.subject.id }),
      concept = graph.nodes.find((node) => node.kind === "concept")!;
    annotations.dispatch("graph:suggest", { subjectId: value.subject.id });
    annotations.dispatch("graph:position", {
      subjectId: value.subject.id,
      nodeId: concept.id,
      x: 240,
      y: 180,
      pinned: true,
    });
    const archive = value.subjects.exportArchive(value.subject.id),
      store = new StudioStore(":memory:"),
      subjects = new SubjectStore(store),
      planning = new PlanningService(store, subjects, {
        models: async () => [],
        request: async () => "",
        changed: () => {},
      });
    resources.push({ store, planning });
    subjects.restore({ archive });
    const restored = new AnnotationStore(store),
      restoredGraph = restored.graph({ subjectId: value.subject.id });
    expect(restored.list({ subjectId: value.subject.id })[0]).toMatchObject({
      id: highlight.id,
      color: "green",
      note: "A saved annotation",
    });
    expect(restoredGraph.positions[concept.id]).toMatchObject({
      x: 240,
      y: 180,
      pinned: true,
    });
    expect(
      restoredGraph.links.some(
        (link) => link.state === "suggested" && link.kind === "mentioned-in",
      ),
    ).toBe(true);
    expect(
      subjects
        .search({ subjectId: value.subject.id, query: "saved annotation" })
        .some(
          (result) =>
            result.kind === "highlight" &&
            result.messageId === "source-message",
        ),
    ).toBe(true);
    expect(subjects.snapshot(value.subject.id).concepts[0].status).toBe(
      "unassessed",
    );
  });
});
