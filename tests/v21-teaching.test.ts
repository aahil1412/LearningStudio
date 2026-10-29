import { afterEach, describe, expect, it, vi } from "vitest";
import { StudioStore } from "../electron/storage";
import { SubjectStore } from "../electron/subjects";
import { CheckpointService } from "../electron/checks";
import { defaultData } from "../src/lib/defaults";
import { defaultTeachingPreferences } from "../src/v21types";
import type { SubjectIntake } from "../src/v21types";
import {
  contentText,
  gradeMCQ,
  localVisualRequest,
  orderedMessageContent,
  prepareTeachingContent,
  translationCheckpoint,
  teachingControlState,
  readMCQResponse,
  applyTeachingBlockPolicy,
} from "../src/lib/teachingController";
import { requestedImageQuery } from "../src/lib/messageContent";
import { teachingInstructions } from "../src/lib/teaching";
import {
  parseTutorResponse,
  validateContentBlock,
} from "../src/lib/visualSpecs";
import { scientificCurves, sampleSurface } from "../src/lib/science/plots";
import type { Lesson, MCQBlock } from "../src/types";

const at = "2026-10-28T12:00:00.000Z";
const lesson: Lesson = {
  id: "lesson",
  title: "Translation",
  subject: "Molecular biology",
  mode: "Learn",
  objective: "Understand translation",
  position: "Decoding",
  messages: [],
  notes: "",
  createdAt: at,
  updatedAt: at,
};
const stores: StudioStore[] = [];
afterEach(() => {
  for (const store of stores.splice(0)) store.close();
  vi.restoreAllMocks();
});

describe("structured teaching decisions", () => {
  it("keeps an ordered stream, discards malformed siblings, and preserves legacy visual identifiers without duplicated text", () => {
    const parsed = parseTutorResponse(
      JSON.stringify({
        text: "duplicate projection",
        content: [
          { type: "text", text: "Look here." },
          {
            type: "illustration",
            spec: { template: "translation", title: "Read a codon" },
          },
          { type: "javascript", source: "bad()" },
          { type: "text", text: "Now explain." },
          translationCheckpoint,
        ],
      }),
    );
    expect(parsed.content?.map((b) => b.type)).toEqual([
      "text",
      "illustration",
      "text",
      "mcq",
    ]);
    expect(parsed.text).not.toContain("duplicate projection");
    const old = orderedMessageContent({
      id: "legacy",
      role: "assistant",
      text: "same",
      blocks: [
        { type: "text", text: "same" },
        { type: "plot", spec: { kind: "wave", title: "Original" } },
      ],
      createdAt: at,
    });
    expect(old).toHaveLength(2);
    expect(old[1].visualId).toBe("legacy:1");
    const stream = orderedMessageContent({
      id: "new",
      role: "assistant",
      text: parsed.text,
      blocks: parsed.blocks,
      content: parsed.content,
      createdAt: at,
    });
    expect(stream).toHaveLength(4);
    expect(stream[1].visualId).toBe("new:1");
  });
  it("puts reviewed translation terms and a substantive illustration before long prose and offers an optional MCQ", () => {
    const content = prepareTeachingContent(
      {
        text: "An explanation — with technical terminology.",
        blocks: [
          {
            type: "diagram",
            spec: {
              title: "Translation",
              nodes: [
                { id: "a", label: "RNA" },
                { id: "b", label: "Protein" },
              ],
              edges: [{ from: "a", to: "b" }],
            },
          },
        ],
      },
      lesson,
      "Teach translation",
      { ...defaultTeachingPreferences, delivery: "visual-first" },
    );
    expect(content.slice(0, 3).map((b) => b.type)).toEqual([
      "concept",
      "terms",
      "illustration",
    ]);
    expect(
      content.find((b) => b.type === "terms")?.items.map((t) => t.term),
    ).toEqual(
      expect.arrayContaining(["codon", "tRNA", "anticodon", "ribosome"]),
    );
    expect(content.at(-1)?.type).toBe("mcq");
    expect(content.some((b) => b.type === "diagram")).toBe(false);
    expect(contentText(content)).not.toContain("—");
  });
  it("respects requested-only checks, text-first delivery, and exact math/code while cleaning prose", () => {
    const content = prepareTeachingContent(
      {
        text: "Reason — then act. `$x — y$` and $a—b$ stay exact.",
        blocks: [],
      },
      lesson,
      "Explain a concept",
      {
        ...defaultTeachingPreferences,
        delivery: "text-first",
        checkFrequency: "requested",
      },
    );
    expect(content.map((b) => b.type)).toEqual(["text"]);
    expect(contentText(content)).toContain("Reason. Then act");
    expect(contentText(content)).toContain("$a—b$");
    expect(
      teachingControlState(lesson, {
        ...defaultTeachingPreferences,
        checkFrequency: "requested",
      }).checkpoint,
    ).toContain("Only when explicitly requested");
  });
  it("authors generic image requests locally and retrieves only explicitly requested sources or real photographs", () => {
    expect(localVisualRequest("Show me an image of a tRNA")).toBeNull();
    expect(localVisualRequest("Make a figure of codon pairing")).toBeNull();
    expect(localVisualRequest("Search for an image of a tRNA")?.at(-1)).toEqual(
      {
        type: "image",
        query: "a tRNA",
        retrievalRequested: true,
      },
    );
    expect(
      requestedImageQuery("Please show me a real photograph of a cell"),
    ).toBe("a cell");
    expect(
      requestedImageQuery("Could you retrieve a sourced diagram of mitosis?"),
    ).toBe("mitosis");
    expect(
      requestedImageQuery("Do not search for images of DNA"),
    ).toBeUndefined();
    expect(
      requestedImageQuery("Explain why image search matters"),
    ).toBeUndefined();
    expect(localVisualRequest("Explain why images are useful")).toBeNull();
    expect(
      localVisualRequest("Explain the Boltzmann distribution derivation"),
    ).toBeNull();
  });
  it("uses the same authored-first policy before streaming mounts and at final lesson preparation", () => {
    const generatedImage = {
      type: "image" as const,
      query: "unrelated climate map",
      retrievalRequested: true,
    };
    expect(
      applyTeachingBlockPolicy(
        generatedImage,
        "Show a temperature field spatial map",
      ),
    ).toBeNull();
    const result = prepareTeachingContent(
      { text: "Here is the calculated field.", blocks: [generatedImage] },
      { ...lesson, subject: "Physics", objective: "Temperature fields" },
      "Show a temperature field spatial map",
    );
    expect(result.some((block) => block.type === "image")).toBe(false);
    expect(
      result.some(
        (block) => block.type === "plot" && block.spec.kind === "surface",
      ),
    ).toBe(true);
    const query = "Search for an educational image of a tRNA";
    expect(applyTeachingBlockPolicy(generatedImage, query)).toEqual({
      type: "image",
      query: "a tRNA",
      retrievalRequested: true,
    });
    expect(
      validateContentBlock({
        type: "image",
        query: "tRNA",
        retrievalRequested: true,
      }),
    ).toMatchObject({ retrievalRequested: true });
    expect(
      validateContentBlock({
        type: "image",
        query: "tRNA",
        retrievalRequested: "yes",
      }),
    ).toBeNull();
  });
  it.each([
    ["Show me an image of tRNA", undefined],
    ["Make a figure of translation", undefined],
    ["Find the value indicated by this figure", undefined],
    ["Find an image of tRNA, no web search", undefined],
    ["Find an image of tRNA without internet search", undefined],
    ["Show me a sourced image of tRNA", "tRNA"],
    ["Show me an image from Wikimedia Commons of tRNA", "tRNA"],
    ["Show me an image from Openverse about mitosis", "mitosis"],
    ["Show me a real photograph of a cell", "a cell"],
    ["Source an image of tRNA", "tRNA"],
    ["Explain how translation works", undefined],
  ])("respects the actual retrieval intent in %s", (request, query) => {
    expect(requestedImageQuery(request!)).toBe(query);
  });
  it.each([
    "Explain the temperature field without any plot",
    "Show a thermal field, but no surface",
    "Explain a Boltzmann distribution without a graph",
  ])(
    "does not force a calculated figure when explicitly declined: %s",
    (request) => {
      expect(localVisualRequest(request)).toBeNull();
    },
  );
  it("calculates a scalar temperature field locally and declares its illustrative assumptions", () => {
    const content = localVisualRequest("Show a temperature field spatial map")!;
    const block = content.find((item) => item.type === "plot");
    if (block?.type !== "plot") throw new Error("Expected calculated surface");
    expect(validateContentBlock(block)).not.toBeNull();
    const sampled = sampleSurface(block.spec, block.spec.parameters!, 5);
    expect(sampled.positions[12 * 3 + 2]).toBeCloseTo(333);
    const warmer = sampleSurface(
      block.spec,
      { ...block.spec.parameters, A: 60 },
      5,
    );
    expect(warmer.positions[12 * 3 + 2]).toBeCloseTo(353);
    expect(contentText(content)).toContain("not a measured climate map");
    expect(content[0].type).toBe("text");
  });
  it("requests a short first text unit, authored scenes, and concise ordinary Learn responses", () => {
    const prompt = teachingInstructions(lesson, defaultData().settings, [], {
      question: "Explain cell signaling",
    });
    expect(prompt).toContain("Start content with one short text block");
    expect(prompt).toContain("Normal Learn: 120-220 words");
    expect(prompt).toContain("scene:{participants:");
    expect(prompt).toContain("2-4 participants");
    expect(prompt).toContain("Use image retrieval ONLY for explicit");
    expect(prompt).not.toContain(
      "Scientific image requests require an image block",
    );
  });
  it("does not inject a translation diagram or a repeated checkpoint into unrelated tangents and feedback turns", () => {
    const tangent = prepareTeachingContent(
      { text: "A Python dictionary associates keys with values.", blocks: [] },
      lesson,
      "What is a Python dictionary?",
      defaultTeachingPreferences,
    );
    expect(tangent.map((b) => b.type)).toEqual(["text"]);
    const previous = {
      ...lesson,
      messages: [
        {
          id: "previous-check",
          role: "assistant" as const,
          text: "",
          content: [translationCheckpoint],
          createdAt: at,
        },
      ],
    };
    const feedback = prepareTeachingContent(
      {
        text: "Translation uses complementary codon-anticodon pairing, not identical sequences.",
        blocks: [translationCheckpoint],
      },
      previous,
      "Why was my answer wrong?",
      defaultTeachingPreferences,
    );
    expect(
      feedback.some((b) => b.type === "mcq" || b.type === "exercise"),
    ).toBe(false);
  });
  it("shows an optional baseline only with explicit subject consent, independently of routine-check frequency", () => {
    const intake: SubjectIntake = {
      subjectId: "subject",
      revision: 1,
      status: "ready",
      goal: "Understand biology",
      motivation: "Curiosity",
      familiarity: "Beginning",
      strengths: "",
      gaps: "",
      depth: "overview",
      preferences: {
        ...defaultTeachingPreferences,
        checkFrequency: "requested",
      },
      assessment: "requested",
      assessmentNotes: "",
      createdAt: at,
      updatedAt: at,
    };
    const baseline: MCQBlock = {
      ...translationCheckpoint,
      purpose: "baseline",
    };
    expect(
      prepareTeachingContent(
        { text: "", blocks: [baseline] },
        lesson,
        "Begin",
        intake.preferences,
      ).some((b) => b.type === "mcq"),
    ).toBe(false);
    expect(
      prepareTeachingContent(
        { text: "", blocks: [baseline] },
        lesson,
        "Begin",
        intake.preferences,
        { intake },
      ).some((b) => b.type === "mcq" && b.purpose === "baseline"),
    ).toBe(true);
  });
  it("calculates a dimensionally labeled Boltzmann density whose numerical integral matches the exact finite-window area", () => {
    const blocks = localVisualRequest(
      "Show an interactive Boltzmann distribution plot",
    )!;
    const block = blocks.find((b) => b.type === "plot")!;
    expect(block.type).toBe("plot");
    if (block.type !== "plot") throw new Error("Expected a calculated plot");
    expect(validateContentBlock(block)).not.toBeNull();
    expect(block.spec.xLabel).toContain("K");
    const curve = scientificCurves(block.spec, { T: 300 }).curves[0];
    const x = curve.x as number[],
      y = curve.y as number[];
    const area = y
      .slice(1)
      .reduce(
        (sum, value, i) => sum + (value + y[i]) * 0.5 * (x[i + 1] - x[i]),
        0,
      );
    expect(area).toBeCloseTo(1 - Math.exp(-2500 / 300), 3);
    expect(y[0]).toBeCloseTo(1 / 300);
    expect(scientificCurves(block.spec, { T: 600 }).curves[0].y[0]).toBeCloseTo(
      1 / 600,
    );
    expect(contentText(blocks)).toContain("constant density of states");
  });
  it("rejects ambiguous MCQs and checks complete selections for multiple answers without granting mastery", () => {
    expect(
      validateContentBlock({
        ...translationCheckpoint,
        correctChoiceIds: ["missing"],
      }),
    ).toBeNull();
    expect(
      validateContentBlock({
        ...translationCheckpoint,
        choices: [translationCheckpoint.choices[0]],
      }),
    ).toBeNull();
    const multiple: MCQBlock = {
      ...translationCheckpoint,
      multiple: true,
      correctChoiceIds: ["adaptor", "dna"],
    };
    expect(gradeMCQ(multiple, ["adaptor"]).correct).toBe(false);
    expect(gradeMCQ(multiple, ["adaptor", "dna"])).toMatchObject({
      correct: true,
      mastery: false,
    });
    expect(gradeMCQ(translationCheckpoint, [], true)).toMatchObject({
      correct: false,
      mastery: false,
    });
    expect(() => gradeMCQ(translationCheckpoint, ["bad"])).toThrow(
      "valid question choices",
    );
  });
  it("recovers stale saved choice IDs without a render-time grading failure and keeps integer attempt counts above one hundred", () => {
    const stale = readMCQResponse(
      JSON.stringify({
        version: 1,
        selected: ["old-choice-id"],
        submitted: true,
        unknown: false,
        attempts: 144.9,
      }),
      translationCheckpoint,
    );
    expect(stale).toMatchObject({
      selected: [],
      submitted: false,
      unknown: false,
      recovered: true,
      attempts: 144,
    });
    expect(() => gradeMCQ(translationCheckpoint, stale.selected)).not.toThrow();
    const duplicate = readMCQResponse(
      JSON.stringify({
        version: 1,
        selected: ["adaptor", "adaptor"],
        submitted: true,
        attempts: 3,
      }),
      { ...translationCheckpoint, multiple: true },
    );
    expect(duplicate).toMatchObject({
      selected: [],
      submitted: false,
      recovered: true,
      attempts: 3,
    });
    const valid = readMCQResponse(
      JSON.stringify({
        version: 1,
        selected: ["adaptor"],
        submitted: true,
        attempts: 145,
      }),
      translationCheckpoint,
    );
    expect(valid).toMatchObject({
      selected: ["adaptor"],
      submitted: true,
      recovered: false,
      attempts: 145,
    });
    expect(gradeMCQ(translationCheckpoint, valid.selected).correct).toBe(true);
  });
});

function setup(withLinks = true) {
  const store = new StudioStore(":memory:");
  stores.push(store);
  store.save(defaultData());
  const subjects = new SubjectStore(store),
    subject = subjects.create({
      name: "Molecular biology",
      objective: "Understand protein synthesis",
    });
  subjects.apply({
    subjectId: subject.id,
    baseRevision: subject.revision,
    label: "Explicit concept setup",
    operations: [
      {
        entity: "concept",
        op: "put",
        id: "decoding",
        value: {
          label: "Codon recognition",
          status: "unassessed",
          coverage: "covered",
          evidence: "Covered in an explanation; not yet assessed.",
        },
      },
      {
        entity: "curriculum",
        op: "put",
        id: "decoding-node",
        value: {
          kind: "concept",
          title: "Codon recognition",
          description: "tRNA adaptors",
          position: 0,
          status: "covered",
          conceptId: "decoding",
        },
      },
    ],
  });
  const conversation = subjects.conversationCreate({
    subjectId: subject.id,
    title: "Translation",
    mode: "Learn",
    curriculumNodeId: withLinks ? "decoding-node" : undefined,
  });
  const data = store.load();
  data.lessons.find((l) => l.id === conversation.id)!.messages = [
    {
      id: "checkpoint-message",
      role: "assistant",
      text: "Conceptual checkpoint",
      content: [
        {
          ...translationCheckpoint,
          conceptIds: withLinks ? ["decoding"] : undefined,
          curriculumNodeId: withLinks ? "decoding-node" : undefined,
        },
      ],
      createdAt: at,
      status: "complete",
    },
  ];
  store.save(data);
  return {
    store,
    subjects,
    subject,
    conversation,
    service: new CheckpointService(store, subjects),
    input: {
      conversationId: conversation.id,
      messageId: "checkpoint-message",
      blockIndex: 0,
      selectedIds: ["adaptor"],
      requestId: "first-attempt",
    },
  };
}
describe("canonical optional checkpoints", () => {
  it("records a skipped baseline so another conversation does not launch it again", () => {
    const { store, subject, service, input } = setup();
    const intake: SubjectIntake = {
      subjectId: subject.id,
      revision: 1,
      status: "ready",
      goal: "Understand biology",
      motivation: "Curiosity",
      familiarity: "Beginning",
      strengths: "",
      gaps: "",
      depth: "overview",
      preferences: defaultTeachingPreferences,
      assessment: "requested",
      assessmentNotes: "",
      createdAt: at,
      updatedAt: at,
    };
    store.db
      .prepare(
        "INSERT INTO subject_intakes(subject_id,revision,status,value,created_at,updated_at) VALUES(?,?,?,?,?,?)",
      )
      .run(subject.id, 1, "ready", JSON.stringify(intake), at, at);
    const data = store.load();
    const block = data.lessons[0].messages[0].content![0];
    if (block.type !== "mcq") throw new Error("Expected checkpoint");
    block.purpose = "baseline";
    store.save(data);
    service.submit({ ...input, selectedIds: [], skipped: true });
    const row = store.db
      .prepare("SELECT value FROM subject_intakes WHERE subject_id=?")
      .get(subject.id) as { value: string };
    expect(JSON.parse(row.value)).toMatchObject({
      assessment: "skipped",
      revision: 2,
    });
  });
  it("retrieves actual checkpoint responses in the controller and shares unlinked outcomes across subject chats", () => {
    const { store, subjects, subject, conversation, service, input } =
      setup(false);
    service.submit({
      ...input,
      selectedIds: ["dna"],
      requestId: "a-real-mistake",
    });
    const saved = store.load().lessons.find((l) => l.id === conversation.id)!;
    const control = teachingControlState(saved, defaultTeachingPreferences);
    expect(control.recentCheckpointResults).toMatchObject([
      {
        correct: false,
        selected: [expect.stringContaining("DNA")],
        attempts: 1,
      },
    ]);
    const second = subjects.conversationCreate({
      subjectId: subject.id,
      title: "Another conversation",
      mode: "Explore",
    });
    const retrieved = subjects.context({
      subjectId: subject.id,
      conversationId: second.id,
      query: "mRNA codon amino acid checkpoint",
      tokenBudget: 1800,
    });
    expect(JSON.stringify(retrieved)).toContain("Checkpoint to revisit");
    expect(subjects.snapshot(subject.id).memory).toHaveLength(1);
    service.submit({ ...input, requestId: "better-next-attempt" });
    expect(subjects.snapshot(subject.id).memory).toHaveLength(1);
    expect(subjects.snapshot(subject.id).memory[0].kind).toBe("finding");
  });
  it("records source-linked evidence and review history atomically, with partial progress only and idempotent retries", () => {
    const { store, subjects, subject, service, input } = setup();
    expect(service.submit(input)).toMatchObject({
      correct: true,
      attempts: 1,
      mastery: false,
      evidenceCount: 1,
    });
    const snapshot = subjects.snapshot(subject.id);
    expect(snapshot.concepts[0].status).toBe("partial");
    expect(snapshot.curriculum[0].status).toBe("partial");
    expect(snapshot.evidence[0].messageId).toBe("checkpoint-message");
    const data = store.load();
    expect(data.reviewCards).toHaveLength(1);
    expect(data.reviewHistory).toHaveLength(1);
    expect(data.reviewHistory![0].correct).toBe(true);
    expect(service.submit(input)).toMatchObject({ attempts: 1 });
    expect(store.load().reviewHistory).toHaveLength(1);
    const restore = new SubjectStore(store).snapshot(subject.id);
    expect(restore.concepts[0].status).not.toBe("demonstrated");
  });
  it("keeps skip nonblocking and ungraded; unknown remains a real review event", () => {
    const { store, subjects, subject, service, input } = setup();
    const originalEvidence = subjects.snapshot(subject.id).evidence.length;
    expect(
      service.submit({ ...input, skipped: true, selectedIds: [] }),
    ).toMatchObject({ correct: false, attempts: 0 });
    expect(store.load().reviewHistory ?? []).toHaveLength(0);
    expect(subjects.snapshot(subject.id).evidence).toHaveLength(
      originalEvidence,
    );
    expect(
      service.submit({
        ...input,
        unknown: true,
        selectedIds: [],
        requestId: "unknown-attempt",
      }),
    ).toMatchObject({ correct: false, attempts: 1 });
    expect(subjects.snapshot(subject.id).concepts[0].status).toBe("unassessed");
    expect(store.load().reviewHistory![0].answer).toBe("I don't know");
  });
  it("rejects forged selections and rolls back responses/reviews when evidence persistence fails", () => {
    const { store, subjects, service, input } = setup(),
      before = store.load();
    expect(() => service.submit({ ...input, selectedIds: ["forged"] })).toThrow(
      "valid question choices",
    );
    expect(store.load()).toEqual(before);
    vi.spyOn(subjects, "apply").mockImplementationOnce(() => {
      throw new Error("Simulated storage interruption");
    });
    expect(() => service.submit(input)).toThrow(
      "Simulated storage interruption",
    );
    expect(store.load()).toEqual(before);
    expect(
      service.submit({ ...input, requestId: "retry-after-interruption" })
        .correct,
    ).toBe(true);
  });
});
