import { describe, expect, it } from "vitest";
import type { ExperimentSpec } from "../src/explainerTypes";
import type { ContentBlock } from "../src/types";
import {
  experimentSchema,
  compileExperiment,
  experimentValues,
  experimentGeometry,
  experimentCurves,
  experimentDefaults,
  experimentLabels,
  experimentSpringPoints,
  experimentParticlePositions,
} from "../src/lib/explainers/experiment";
import {
  circuitExperiment,
  equilibriumExperiment,
} from "../src/lib/explainers/examples";
import {
  planVisualInteraction,
  integratePlannedInteraction,
} from "../src/lib/interactionPlanning";
import { makeInteractiveLesson } from "../src/lib/interactiveLessons";
import { validateContentBlock } from "../src/lib/visualSpecs";
import { defaultTeachingPreferences } from "../src/v21types";
import { prepareTeachingContent } from "../src/lib/teachingController";

describe("bounded data-only interactive experiments", () => {
  it("draws springs and particle marks along the full segment including zero endpoints", () => {
    const spring = experimentSpringPoints({ x: 50, y: 20, x2: 50, y2: 220 });
    expect(spring[0]).toEqual({ x: 50, y: 20 });
    expect(spring.at(-1)).toEqual({ x: 50, y: 220 });
    expect(spring[1].x).not.toBe(50);
    expect(spring[8].y).toBe(120);
    expect(
      experimentParticlePositions({ x: 100, y: 100, x2: 0, y2: 0, count: 2 }),
    ).toEqual([
      { x: 75, y: 75 },
      { x: 25, y: 25 },
    ]);
    expect(experimentParticlePositions({ x: 0, y: 0, count: 0 })).toEqual([]);
  });
  it("reports invalid negative shape dimensions instead of drawing a different quantity", () => {
    const spec = structuredClone(equilibriumExperiment.experiment!);
    spec.scene!.elements[0].height = "-1";
    const model = compileExperiment(spec);
    expect(() =>
      experimentGeometry(
        model,
        experimentValues(model, experimentDefaults(spec)),
      ),
    ).toThrow(/cannot be negative/);
  });
  it("wraps long scientific words within label bounds and marks truncated labels", () => {
    const spec = structuredClone(equilibriumExperiment.experiment!);
    spec.scene!.elements[0].label = "W".repeat(120);
    const model = compileExperiment(spec);
    const labels = experimentLabels(
      experimentGeometry(
        model,
        experimentValues(model, experimentDefaults(spec)),
      ),
      800,
      300,
    );
    const label = labels.find((item) => item?.id === "reactantBar")!;
    expect(label.lines).toHaveLength(3);
    expect(label.lines.at(-1)).toContain("…");
    expect(label.box.width).toBeLessThanOrEqual(240);
    expect(label.lines.every((part) => part.length <= 12)).toBe(true);
  });
  it("calculates Ohm's law, power and the same plotted relationship", () => {
    const spec = experimentSchema.parse(circuitExperiment.experiment);
    const model = compileExperiment(spec);
    const initial = experimentValues(model, experimentDefaults(spec));
    expect(initial.current).toBe(1);
    expect(initial.power).toBe(6);
    const doubled = experimentValues(model, { voltage: 12, resistance: 6 });
    expect(doubled.current).toBe(2);
    expect(doubled.power).toBe(24);
    const curve = experimentCurves(model, doubled)[0];
    expect(curve.points.at(-1)).toEqual({ x: 12, y: 2 });
    const marks = (values: Record<string, number>) =>
      experimentGeometry(model, values).find(
        (e) => e.element.id === "carriers",
      )!.geometry.count;
    expect(marks(doubled)).toBe(2 * marks(initial));
  });
  it("conserves concentration for every tested equilibrium setting", () => {
    const spec = experimentSchema.parse(equilibriumExperiment.experiment),
      model = compileExperiment(spec);
    for (const total of [0.1, 1, 3.2, 5])
      for (const ratio of [0.1, 1, 2.7, 10]) {
        const v = experimentValues(model, { total, ratio });
        expect(v.reactant + v.product).toBeCloseTo(total, 12);
        expect(v.product / v.reactant).toBeCloseTo(ratio, 12);
        const g = experimentGeometry(model, v);
        expect(g[0].geometry.height + g[1].geometry.height).toBeCloseTo(
          (180 * total) / 5,
          12,
        );
      }
  });
  it("clamps restored controls and rejects executable expressions or invalid dependencies", () => {
    const spec = structuredClone(circuitExperiment.experiment!);
    const model = compileExperiment(spec);
    expect(
      experimentValues(model, { voltage: 1e9, resistance: -1 }, 1e9),
    ).toMatchObject({ voltage: 12, resistance: 1, time: 6 });
    for (const expression of [
      "window.alert(1)",
      "fetch('secret')",
      "voltage=5",
      "constructor",
      "unknown+1",
    ]) {
      expect(
        experimentSchema.safeParse({
          ...spec,
          derived: [{ id: "test", label: "test", expression, unit: "" }],
        }).success,
      ).toBe(false);
    }
    expect(
      experimentSchema.safeParse({
        ...spec,
        derived: [
          { id: "a", label: "a", expression: "b", unit: "" },
          { id: "b", label: "b", expression: "a", unit: "" },
        ],
      }).success,
    ).toBe(false);
    expect(
      experimentSchema.safeParse({
        ...spec,
        parameters: [...spec.parameters, spec.parameters[0]],
      }).success,
    ).toBe(false);
    expect(
      experimentSchema.safeParse({
        ...spec,
        stages: [
          {
            id: "bad",
            title: "bad",
            explanation: "bad",
            parameters: { missing: 1 },
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      experimentSchema.safeParse({
        ...spec,
        stages: [
          {
            id: "bad",
            title: "bad",
            explanation: "bad",
            focusIds: ["unknown"],
          },
        ],
      }).success,
    ).toBe(false);
  });
  it("preserves undefined curve gaps and recovers from invalid numeric states", () => {
    const spec: ExperimentSpec = {
      question: "Investigate a reciprocal",
      parameters: [
        { id: "a", label: "a", unit: "", min: 0, max: 2, step: 0.1, value: 1 },
      ],
      derived: [
        { id: "reciprocal", label: "reciprocal", expression: "1/a", unit: "" },
      ],
      plot: {
        domain: [-1, 1],
        xLabel: "x",
        yLabel: "y",
        curves: [{ id: "curve", label: "1/x", expression: "1/x" }],
      },
      assumptions: ["Undefined at zero."],
    };
    const m = compileExperiment(experimentSchema.parse(spec));
    expect(() => experimentValues(m, { a: 0 })).toThrow(/undefined/);
    expect(experimentValues(m, experimentDefaults(spec)).reciprocal).toBe(1);
    expect(
      experimentCurves(m, experimentValues(m, { a: 1 }))[0].points[100].y,
    ).toBeNull();
  });
  it("fits annotation boxes inside the figure and keeps labels apart", () => {
    for (const spec of [
      circuitExperiment.experiment!,
      equilibriumExperiment.experiment!,
    ]) {
      const m = compileExperiment(spec),
        v = experimentValues(m, experimentDefaults(spec));
      const labels = experimentLabels(
        experimentGeometry(m, v),
        spec.scene!.width,
        spec.scene!.height,
      ).filter((l) => l !== null);
      expect(labels.length).toBeGreaterThan(0);
      for (const [i, l] of labels.entries()) {
        expect(l.box.x).toBeGreaterThanOrEqual(0);
        expect(l.box.x + l.box.width).toBeLessThanOrEqual(spec.scene!.width);
        expect(l.box.y).toBeGreaterThanOrEqual(0);
        expect(l.box.y + l.box.height).toBeLessThanOrEqual(spec.scene!.height);
        for (const other of labels.slice(i + 1))
          expect(
            l.box.x >= other.box.x + other.box.width ||
              l.box.x + l.box.width <= other.box.x ||
              l.box.y >= other.box.y + other.box.height ||
              l.box.y + l.box.height <= other.box.y,
          ).toBe(true);
      }
    }
  });
  it("accepts valid original experiments through the production content schema", () => {
    expect(
      validateContentBlock({ type: "illustration", spec: circuitExperiment })
        ?.type,
    ).toBe("illustration");
    expect(
      validateContentBlock({
        type: "illustration",
        spec: equilibriumExperiment,
      })?.type,
    ).toBe("illustration");
    expect(
      validateContentBlock({
        type: "illustration",
        spec: { template: "experiment", title: "No experiment" },
      }),
    ).toBeNull();
    for (const kind of ["gene", "optimization", "equilibrium"] as const) {
      const lesson = makeInteractiveLesson(kind);
      expect(
        lesson.messages[0].content!.every((b) => validateContentBlock(b)),
      ).toBe(true);
      expect(lesson.messages[0].text).toBe("");
    }
  });
});

describe("production interaction planning", () => {
  const lesson = makeInteractiveLesson("gene");
  it("upgrades a legacy translation cell in place after its definitions", () => {
    const content: ContentBlock[] = [
      { type: "text", text: "An orientation." },
      {
        type: "terms",
        items: [
          { term: "codon", definition: "Three RNA bases read together." },
        ],
      },
      {
        type: "text",
        text: "These terms prepare you to inspect the mechanism.",
      },
      {
        type: "illustration",
        spec: { template: "translation", title: "Translation" },
      },
      { type: "text", text: "Then compare the resulting chain." },
    ];
    const result = integratePlannedInteraction(
      content,
      lesson,
      "Continue",
      defaultTeachingPreferences,
    );
    expect(result.map((b) => b.type)).toEqual(content.map((b) => b.type));
    expect(result.slice(0, 3)).toEqual(content.slice(0, 3));
    expect(result[3].type === "illustration" && result[3].spec.template).toBe(
      "gene-expression-lab",
    );
    expect(result[4]).toEqual(content[4]);
    expect(result.filter((b) => b.type === "illustration")).toHaveLength(1);
  });
  it("does not substitute equilibrium composition for a kinetic rate-law question", () => {
    expect(
      planVisualInteraction("Explain mass action kinetics and the rate law"),
    ).toBeNull();
    expect(
      planVisualInteraction(
        "Explain chemical equilibrium and opposing reaction kinetics",
      )?.mechanism,
    ).toContain("equilibrium");
  });
  it("automatically plans useful calculations for ordinary explanations without a diagram request", () => {
    expect(
      planVisualInteraction(
        "How does information in DNA become an amino-acid chain, and what happens if a base changes?",
      )?.mechanism,
    ).toBe("sequence transformation");
    expect(
      planVisualInteraction("Translate this French sentence into English"),
    ).toBeNull();
    expect(
      planVisualInteraction("How does gene expression turn DNA into protein?")
        ?.mechanism,
    ).toBe("sequence transformation");
    expect(
      planVisualInteraction(
        "Why can a large learning rate fail in gradient descent?",
      )?.mechanism,
    ).toBe("iterated optimization");
    expect(
      planVisualInteraction("Explain chemical equilibrium")?.mechanism,
    ).toContain("equilibrium");
    expect(planVisualInteraction("Explain Ohm's law")?.mechanism).toContain(
      "circuit",
    );
    expect(
      planVisualInteraction("How does democracy work?", lesson.objective),
    ).toBeNull();
    expect(
      planVisualInteraction(
        "Continue with quantum mechanics",
        lesson.objective,
      ),
    ).toBeNull();
    expect(planVisualInteraction("Continue", lesson.objective)?.mechanism).toBe(
      "sequence transformation",
    );
  });
  it("places interaction before an extended explanation without deleting or duplicating prose", () => {
    const text =
      "  A short orientation.\n\n" +
      "Extended explanation. ".repeat(45) +
      "\n\n ";
    const original: ContentBlock = { type: "text", text };
    const result = integratePlannedInteraction(
      [original],
      lesson,
      "Explain gene expression",
      defaultTeachingPreferences,
    );
    expect(result.map((b) => b.type)).toEqual(["illustration", "text"]);
    expect(result[1]).toBe(original);
    expect(result[1].type === "text" && result[1].text).toBe(text);
    expect(
      integratePlannedInteraction(
        result,
        lesson,
        "Explain gene expression",
        defaultTeachingPreferences,
      ),
    ).toEqual(result);
  });
  it.each([
    [
      "inline math",
      "The expression $\\underbrace{" +
        "x+".repeat(260) +
        "x}_{n\\text{ terms}}$ stays complete.",
    ],
    [
      "display math",
      "$$\n\\underbrace{" + "x+".repeat(260) + "x}_{n\\text{ terms}}\n$$",
    ],
    [
      "fenced code",
      "```typescript\nconst initial = 1;\n\n" +
        "const next = initial + 1;\n".repeat(24) +
        "```",
    ],
    [
      "inline code",
      "Inspect `" +
        "state[coordinate] += gradient; ".repeat(24) +
        "` without cutting its delimiters.",
    ],
    [
      "citation link",
      "[" +
        "A source label. ".repeat(40) +
        "](https://example.edu/reference?section=gradient#proof)",
    ],
  ])("preserves every byte and delimiter of a long %s block", (_kind, text) => {
    expect(text.length).toBeGreaterThan(420);
    const result = integratePlannedInteraction(
      [{ type: "text", text }],
      lesson,
      "Explain gradient descent",
      defaultTeachingPreferences,
    );
    expect(result.map((block) => block.type)).toEqual(["illustration", "text"]);
    expect(result.filter((block) => block.type === "text")).toEqual([
      { type: "text", text },
    ]);
  });
  it("keeps short orientation after/before boundaries and existing authored figure streams intact", () => {
    const orientation: ContentBlock = {
      type: "text",
      text: "The gradient is a local direction. Inspect $L(x,y)$ next.",
    };
    const short = integratePlannedInteraction(
      [orientation],
      lesson,
      "Explain gradient descent",
      defaultTeachingPreferences,
    );
    expect(short[0]).toBe(orientation);
    expect(short.map((block) => block.type)).toEqual(["text", "illustration"]);
    const authored: ContentBlock[] = [
      orientation,
      { type: "equation", latex: "L(x,y)=x^2+y^2" },
      {
        type: "illustration",
        spec: { template: "optimization-lab", title: "Authored position" },
      },
      {
        type: "text",
        text: "Then follow the original explanation. ".repeat(30),
      },
    ];
    expect(
      integratePlannedInteraction(
        authored,
        lesson,
        "Explain gradient descent",
        defaultTeachingPreferences,
      ),
    ).toBe(authored);
  });
  it("respects explicit retrieval, text-first, practice and tangents", () => {
    const content = [{ type: "text" as const, text: "A concise answer." }];
    expect(
      integratePlannedInteraction(content, lesson, "Explain transcription", {
        ...defaultTeachingPreferences,
        delivery: "text-first",
      }),
    ).toEqual(content);
    expect(
      integratePlannedInteraction(
        content,
        { ...lesson, mode: "Practice" },
        "Explain transcription",
        defaultTeachingPreferences,
      ),
    ).toEqual(content);
    expect(
      integratePlannedInteraction(
        content,
        lesson,
        "How are mountains formed?",
        defaultTeachingPreferences,
      ),
    ).toEqual(content);
    const image = [
      ...content,
      {
        type: "image" as const,
        query: "RNA polymerase photograph",
        retrievalRequested: true,
      },
    ];
    expect(
      integratePlannedInteraction(
        image,
        lesson,
        "Explain transcription",
        defaultTeachingPreferences,
      ),
    ).toEqual(image);
  });
  it("does not add a second legacy translation figure when a gene lab is already present", () => {
    const content = prepareTeachingContent(
      {
        text: "Transcription makes mRNA. Translation uses a ribosome and codons.",
        blocks: [],
      },
      lesson,
      "Explain gene expression",
      { delivery: "visual-first", checkFrequency: "requested" },
    );
    const labs = content.filter((b) => b.type === "illustration");
    expect(labs).toHaveLength(1);
    expect(labs[0].type === "illustration" && labs[0].spec.template).toBe(
      "gene-expression-lab",
    );
  });
});
