import { z } from "zod";
import type { ContentBlock, DiagramSpec, PlotSpec } from "../types";
import { parseExpression, validVariable } from "./science/expressions";
import { validateOde } from "./science/numerics";
import { gradingSchema } from "./learning";
import { experimentSchema } from "./explainers/experiment";
import { landscapes } from "./explainers/optimization";

const short = z.string().min(1).max(180);
const diagramSchema = z
  .object({
    title: short,
    nodes: z
      .array(
        z.object({
          id: z.string().regex(/^[\w-]{1,50}$/),
          label: short,
          detail: z.string().max(1200).optional(),
        }),
      )
      .min(1)
      .max(24),
    edges: z
      .array(
        z.object({
          from: short,
          to: short,
          label: z.string().max(80).optional(),
        }),
      )
      .max(48),
  })
  .superRefine((spec, ctx) => {
    const ids = new Set(spec.nodes.map((n) => n.id));
    if (ids.size !== spec.nodes.length)
      ctx.addIssue({
        code: "custom",
        message: "Diagram node IDs must be unique",
      });
    if (spec.edges.some((e) => !ids.has(e.from) || !ids.has(e.to)))
      ctx.addIssue({
        code: "custom",
        message: "Diagram connections must refer to existing nodes",
      });
  });
const domainSchema = z
  .tuple([
    z.number().finite().min(-1e6).max(1e6),
    z.number().finite().min(-1e6).max(1e6),
  ])
  .refine(
    (value) => value[0] < value[1],
    "Domain minimum must be smaller than maximum",
  );
const plotSchema = z
  .object({
    kind: z.enum([
      "wave",
      "derivative",
      "gaussian",
      "logistic",
      "oscillator",
      "function",
      "parametric",
      "surface",
      "vector",
      "ode",
    ]),
    title: short,
    xLabel: short.optional(),
    yLabel: short.optional(),
    zLabel: short.optional(),
    expressions: z.array(z.string().min(1).max(512)).min(1).max(4).optional(),
    domain: domainSchema.optional(),
    yDomain: domainSchema.optional(),
    showDerivative: z.boolean().optional(),
    parameterRanges: z
      .record(
        z.string().max(24),
        z
          .object({
            min: z.number().finite().min(-1e6).max(1e6),
            max: z.number().finite().min(-1e6).max(1e6),
            step: z.number().finite().positive().max(1e6),
          })
          .refine(
            (r) => r.min < r.max && r.step <= r.max - r.min,
            "Invalid slider range",
          ),
      )
      .optional(),
    ode: z
      .object({
        variables: z.array(z.string().max(24)).min(1).max(6),
        derivatives: z.array(z.string().min(1).max(512)).min(1).max(6),
        initial: z.array(z.number().finite().min(-1e9).max(1e9)).min(1).max(6),
        duration: z.number().finite().positive().max(1000),
        step: z.number().finite().min(0.0001).max(1000),
      })
      .optional(),
    parameters: z
      .record(z.string().max(32), z.number().finite().min(-1000).max(1000))
      .optional(),
  })
  .superRefine((spec, ctx) => {
    try {
      const parameters = spec.parameters ?? {};
      if (
        Object.keys(parameters).length > 12 ||
        Object.keys(parameters).some((name) => !validVariable(name))
      )
        throw new Error("Use at most 12 valid mathematical parameter names.");
      if (["function", "parametric", "surface", "vector"].includes(spec.kind)) {
        const count = spec.expressions?.length ?? 0;
        if (
          !count ||
          (spec.kind === "surface" && count !== 1) ||
          (spec.kind === "vector" && count !== 3) ||
          (spec.kind === "parametric" && (count < 2 || count > 3))
        )
          throw new Error(
            "Incorrect number of expressions for the selected mathematical representation.",
          );
        const variables =
          spec.kind === "parametric"
            ? ["t"]
            : spec.kind === "surface"
              ? ["x", "y"]
              : spec.kind === "vector"
                ? ["x", "y", "z"]
                : ["x"];
        if (Object.keys(parameters).some((name) => variables.includes(name)))
          throw new Error(
            "Parameters must have names distinct from coordinates.",
          );
        for (const expression of spec.expressions ?? [])
          parseExpression(expression, [
            ...variables,
            ...Object.keys(parameters),
          ]);
      }
      if (spec.kind === "ode") {
        if (!spec.ode) throw new Error("An ODE specification is required.");
        validateOde(spec.ode, parameters);
      }
    } catch (error) {
      ctx.addIssue({
        code: "custom",
        message:
          error instanceof Error
            ? error.message
            : "Invalid mathematical specification",
      });
    }
  });
export const illustrationSchema = z
  .object({
    template: z.enum([
      "translation",
      "membrane-transport",
      "reaction-energy",
      "process",
      "scene",
      "field-explorer",
      "protein-aggregation",
      "interaction-vertices",
      "gene-expression-lab",
      "optimization-lab",
      "experiment",
    ]),
    title: short,
    caption: z.string().max(2000).optional(),
    gene: z
      .object({
        codingDna: z.string().regex(/^[ACGT]{3,180}$/),
        label: z.string().max(180).optional(),
      })
      .partial()
      .optional(),
    optimization: z
      .object({
        landscape: z.enum(["quadratic", "ravine", "himmelblau"]).optional(),
        learningRate: z.number().finite().min(0.001).max(1).optional(),
        start: z
          .tuple([
            z.number().finite().min(-5).max(5),
            z.number().finite().min(-5).max(5),
          ])
          .optional(),
        iterations: z.number().int().min(1).max(300).optional(),
      })
      .superRefine((config, ctx) => {
        if (!config.start) return;
        const domain = landscapes[config.landscape || "quadratic"];
        if (
          config.start[0] < domain.xDomain[0] ||
          config.start[0] > domain.xDomain[1] ||
          config.start[1] < domain.yDomain[0] ||
          config.start[1] > domain.yDomain[1]
        )
          ctx.addIssue({
            code: "custom",
            path: ["start"],
            message:
              "The starting point must be inside the selected landscape's displayed coordinate bounds.",
          });
      })
      .optional(),
    experiment: experimentSchema.optional(),
    stages: z
      .array(
        z.object({
          id: z.string().regex(/^[\w-]{1,50}$/),
          label: z.string().min(1).max(100),
          description: z.string().max(500).optional(),
        }),
      )
      .min(2)
      .max(8)
      .optional(),
    reaction: z
      .object({
        activationEnergy: z.number().finite().positive().max(10000),
        freeEnergyChange: z.number().finite().min(-10000).max(10000),
        unit: z.enum(["kJ/mol", "kcal/mol", "relative units"]),
      })
      .optional(),
    interaction: z
      .object({
        theory: z.enum(["qed", "qcd"]).optional(),
        vertex: z.enum(["matter", "three-boson", "four-boson"]).optional(),
      })
      .optional(),
    field: z
      .object({
        mode: z.enum(["wave", "packet"]).optional(),
        amplitude: z.number().finite().min(0).max(2).optional(),
        wavelength: z.number().finite().min(0.5).max(6).optional(),
        width: z.number().finite().min(0.4).max(4).optional(),
        speed: z.number().finite().min(0.1).max(2).optional(),
      })
      .optional(),
    aggregation: z
      .object({
        concentration: z.number().finite().min(0.2).max(5).optional(),
        unfoldedFraction: z.number().finite().min(0).max(1).optional(),
        attraction: z.number().finite().min(0).max(2).optional(),
        partition: z.number().finite().min(1).max(12).optional(),
        condensate: z.boolean().optional(),
      })
      .optional(),
    scene: z
      .object({
        participants: z
          .array(
            z.object({
              id: z.string().regex(/^[\w-]{1,50}$/),
              label: z.string().trim().min(1).max(64),
              shape: z.enum([
                "cell",
                "complex",
                "rna",
                "dna",
                "protein",
                "unfolded-protein",
                "aggregate",
                "field",
                "photon",
                "fermion",
                "gluon",
                "particle",
                "compartment",
                "source",
                "barrier",
              ]),
              description: z.string().max(600).optional(),
            }),
          )
          .min(2)
          .max(4),
        relations: z
          .array(
            z.object({
              from: z.string().regex(/^[\w-]{1,50}$/),
              to: z.string().regex(/^[\w-]{1,50}$/),
              label: z.string().trim().min(1).max(100),
              kind: z.enum(["movement", "binding", "conversion", "regulation"]),
            }),
          )
          .max(6),
        steps: z
          .array(
            z.object({
              id: z.string().regex(/^[\w-]{1,50}$/),
              label: z.string().trim().min(1).max(100),
              description: z.string().trim().min(1).max(600),
              activeIds: z.array(z.string().regex(/^[\w-]{1,50}$/)).max(4),
            }),
          )
          .max(6)
          .optional(),
      })
      .optional(),
  })
  .superRefine((spec, ctx) => {
    if (
      spec.template === "interaction-vertices" &&
      spec.interaction?.theory === "qed" &&
      spec.interaction.vertex &&
      spec.interaction.vertex !== "matter"
    )
      ctx.addIssue({
        code: "custom",
        message:
          "QED has no elementary three- or four-photon self-interaction vertex.",
      });
    if (spec.template === "scene") {
      const ids = new Set(spec.scene?.participants.map((p) => p.id));
      if (
        !spec.scene ||
        ids.size !== spec.scene.participants.length ||
        spec.scene.relations.some(
          (r) => r.from === r.to || !ids.has(r.from) || !ids.has(r.to),
        ) ||
        spec.scene.steps?.some((s) => s.activeIds.some((id) => !ids.has(id)))
      )
        ctx.addIssue({
          code: "custom",
          message:
            "A scientific scene needs unique participants and valid relationships/steps.",
        });
      if (spec.scene) {
        const keys = spec.scene.relations.map((edge) =>
          [
            edge.kind,
            ...(edge.kind === "binding"
              ? [edge.from, edge.to].sort()
              : [edge.from, edge.to]),
          ].join(":"),
        );
        if (new Set(keys).size !== keys.length)
          ctx.addIssue({
            code: "custom",
            message: "Scientific scene relationships must not repeat.",
          });
        if (
          spec.scene.steps &&
          (new Set(spec.scene.steps.map((step) => step.id)).size !==
            spec.scene.steps.length ||
            spec.scene.steps.some(
              (step) => new Set(step.activeIds).size !== step.activeIds.length,
            ))
        )
          ctx.addIssue({
            code: "custom",
            message:
              "Scientific scene step identifiers and active participants must be unique.",
          });
      }
    }
    if (spec.template === "experiment" && !spec.experiment)
      ctx.addIssue({
        code: "custom",
        message: "An experiment needs a validated model specification.",
      });
    if (spec.template === "process" && !spec.stages?.length)
      ctx.addIssue({
        code: "custom",
        message: "A process illustration needs validated stages.",
      });
    if (
      spec.stages &&
      new Set(spec.stages.map((s) => s.id)).size !== spec.stages.length
    )
      ctx.addIssue({
        code: "custom",
        message: "Stage identifiers must be unique.",
      });
    if (
      spec.reaction &&
      spec.reaction.activationEnergy <=
        Math.max(0, spec.reaction.freeEnergyChange)
    )
      ctx.addIssue({
        code: "custom",
        message:
          "The transition state must be above both reactants and products.",
      });
  });
export const mcqSchema = z
  .object({
    type: z.literal("mcq"),
    purpose: z.enum(["checkpoint", "baseline"]).optional(),
    id: z
      .string()
      .regex(/^[\w-]{1,100}$/)
      .optional(),
    question: z.string().min(1).max(5000),
    choices: z
      .array(
        z.object({
          id: z.string().regex(/^[\w-]{1,50}$/),
          text: z.string().min(1).max(2000),
          explanation: z.string().max(3000).optional(),
        }),
      )
      .min(2)
      .max(6),
    correctChoiceIds: z.array(z.string().min(1).max(50)).min(1).max(6),
    multiple: z.boolean().optional(),
    allowUnknown: z.boolean().optional(),
    explanation: z.string().max(10000).optional(),
    conceptIds: z.array(z.string().min(1).max(200)).max(12).optional(),
    curriculumNodeId: z.string().min(1).max(200).optional(),
  })
  .superRefine((block, ctx) => {
    const ids = new Set(block.choices.map((c) => c.id));
    if (
      ids.size !== block.choices.length ||
      new Set(block.correctChoiceIds).size !== block.correctChoiceIds.length ||
      block.correctChoiceIds.some((id) => !ids.has(id))
    )
      ctx.addIssue({
        code: "custom",
        message: "Question choices must have unique, valid identifiers.",
      });
    if (!block.multiple && block.correctChoiceIds.length !== 1)
      ctx.addIssue({
        code: "custom",
        message: "Multiple correct choices require multiple selection.",
      });
  });
const blockSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text"), text: z.string().max(60000) }),
  z.object({
    type: z.literal("concept"),
    title: short,
    prerequisites: z.array(z.string().max(300)).max(8).optional(),
    objective: z.string().max(1200).optional(),
  }),
  z.object({
    type: z.literal("terms"),
    items: z
      .array(
        z.object({
          term: z.string().min(1).max(100),
          definition: z.string().min(1).max(2000),
        }),
      )
      .min(1)
      .max(16),
  }),
  z.object({ type: z.literal("illustration"), spec: illustrationSchema }),
  mcqSchema,
  z.object({ type: z.literal("equation"), latex: z.string().max(6000) }),
  z.object({ type: z.literal("diagram"), spec: diagramSchema }),
  z.object({ type: z.literal("knowledge-graph"), spec: diagramSchema }),
  z.object({ type: z.literal("plot"), spec: plotSchema }),
  z.object({
    type: z.literal("chemical"),
    input: z.string().min(1).max(200000),
    format: z.enum(["smiles", "mol", "sdf"]),
    caption: z.string().max(400).optional(),
  }),
  z.object({
    type: z.literal("molecule"),
    source: z.enum(["pdb", "pubchem"]),
    id: z.string().regex(/^[a-zA-Z0-9_-]{1,30}$/),
    caption: z.string().max(400).optional(),
  }),
  z.object({
    type: z.literal("image"),
    query: z.string().min(1).max(200),
    retrievalRequested: z.boolean().optional(),
  }),
  z.object({
    type: z.literal("exercise"),
    question: z.string().min(1).max(5000),
    hint: z.string().max(5000).optional(),
    answer: z.string().max(10000).optional(),
    grading: gradingSchema.optional(),
  }),
]);
export function validateContentBlock(value: unknown): ContentBlock | null {
  const parsed = blockSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/** Treat a malformed structured reply as recoverable readable text. Never evaluate it. */
export function parseTutorResponse(raw: string): {
  text: string;
  blocks: ContentBlock[];
  content?: ContentBlock[];
} {
  const bounded = raw.slice(0, 250000);
  let candidate = bounded.trim();
  if (candidate.startsWith("```"))
    candidate = candidate
      .replace(/^```(?:json)?\s*/, "")
      .replace(/\s*```$/, "");
  try {
    const value: unknown = JSON.parse(candidate);
    if (!value || typeof value !== "object" || Array.isArray(value))
      return { text: bounded, blocks: [] };
    const obj = value as Record<string, unknown>;
    if (Array.isArray(obj.content)) {
      const content = obj.content
        .slice(0, 64)
        .map(validateContentBlock)
        .filter((b): b is ContentBlock => b !== null);
      if (content.length) {
        const text = content
          .map((b) =>
            b.type === "text"
              ? b.text
              : b.type === "concept"
                ? b.title
                : b.type === "terms"
                  ? b.items.map((t) => `${t.term}: ${t.definition}`).join("\n")
                  : "",
          )
          .filter(Boolean)
          .join("\n\n")
          .slice(0, 60000);
        return { text, blocks: content, content };
      }
    }
    const blocks = Array.isArray(obj.blocks)
      ? obj.blocks
          .slice(0, 24)
          .map(validateContentBlock)
          .filter((b): b is ContentBlock => b !== null)
      : [];
    const text = typeof obj.text === "string" ? obj.text.slice(0, 60000) : "";
    if (!text && !blocks.length) return { text: bounded, blocks: [] };
    return { text, blocks };
  } catch {
    return { text: bounded, blocks: [] };
  }
}

export const plotControls: Record<
  PlotSpec["kind"],
  {
    key: string;
    label: string;
    min: number;
    max: number;
    step: number;
    initial: number;
  }[]
> = {
  function: [],
  parametric: [],
  surface: [],
  vector: [],
  ode: [],
  wave: [
    {
      key: "amplitude",
      label: "Amplitude",
      min: 0.1,
      max: 3,
      step: 0.1,
      initial: 1,
    },
    {
      key: "frequency",
      label: "Frequency (Hz)",
      min: 0.1,
      max: 3,
      step: 0.1,
      initial: 1,
    },
    {
      key: "phase",
      label: "Phase (rad)",
      min: 0,
      max: 6.28,
      step: 0.05,
      initial: 0,
    },
  ],
  derivative: [
    {
      key: "point",
      label: "Tangent at x",
      min: -3,
      max: 3,
      step: 0.1,
      initial: 1,
    },
  ],
  gaussian: [
    { key: "mean", label: "Mean μ", min: -3, max: 3, step: 0.1, initial: 0 },
    {
      key: "sigma",
      label: "Standard deviation σ",
      min: 0.2,
      max: 2.5,
      step: 0.1,
      initial: 1,
    },
  ],
  logistic: [
    {
      key: "rate",
      label: "Growth rate r (1/time)",
      min: 0.1,
      max: 2,
      step: 0.1,
      initial: 0.8,
    },
    {
      key: "capacity",
      label: "Carrying capacity K",
      min: 10,
      max: 200,
      step: 5,
      initial: 100,
    },
  ],
  oscillator: [
    {
      key: "damping",
      label: "Damping γ (1/s)",
      min: 0,
      max: 0.9,
      step: 0.05,
      initial: 0.15,
    },
    {
      key: "frequency",
      label: "Angular frequency ω (rad/s)",
      min: 0.5,
      max: 4,
      step: 0.1,
      initial: 2,
    },
  ],
};
export function initialParameters(spec: PlotSpec): Record<string, number> {
  return Object.fromEntries(
    plotControls[spec.kind].map((c) => [
      c.key,
      Math.min(c.max, Math.max(c.min, spec.parameters?.[c.key] ?? c.initial)),
    ]),
  );
}
export function calculatePlot(spec: PlotSpec, values: Record<string, number>) {
  const p = { ...initialParameters(spec), ...values };
  const x = Array.from({ length: 401 }, (_, i) =>
    spec.kind === "logistic" || spec.kind === "oscillator"
      ? i / 20
      : -5 + i / 40,
  );
  if (spec.kind === "wave")
    return [
      {
        name: "Displacement",
        x,
        y: x.map(
          (t) =>
            p.amplitude * Math.sin(2 * Math.PI * p.frequency * t + p.phase),
        ),
      },
    ];
  if (spec.kind === "gaussian")
    return [
      {
        name: "Probability density",
        x,
        y: x.map(
          (t) =>
            Math.exp(-0.5 * ((t - p.mean) / p.sigma) ** 2) /
            (p.sigma * Math.sqrt(2 * Math.PI)),
        ),
      },
    ];
  if (spec.kind === "logistic")
    return [
      {
        name: "Population",
        x,
        y: x.map(
          (t) => p.capacity / (1 + (p.capacity - 1) * Math.exp(-p.rate * t)),
        ),
      },
    ];
  if (spec.kind === "oscillator")
    return [
      {
        name: "Displacement",
        x,
        y: x.map((t) => Math.exp(-p.damping * t) * Math.cos(p.frequency * t)),
      },
      { name: "Decay envelope", x, y: x.map((t) => Math.exp(-p.damping * t)) },
    ];
  return [
    { name: "f(x) = x²", x, y: x.map((t) => t * t) },
    {
      name: `Tangent, slope = ${(2 * p.point).toFixed(2)}`,
      x,
      y: x.map((t) => 2 * p.point * (t - p.point) + p.point * p.point),
    },
  ];
}

/** Layered DAG layout; cycles are placed in the final layer without looping. */
export function layoutDiagram(spec: DiagramSpec) {
  const ranks = new Map<string, number>();
  const indegree = new Map(spec.nodes.map((n) => [n.id, 0]));
  for (const e of spec.edges) indegree.set(e.to, (indegree.get(e.to) ?? 0) + 1);
  const queue = spec.nodes.filter((n) => !indegree.get(n.id)).map((n) => n.id);
  for (const id of queue) ranks.set(id, 0);
  for (let i = 0; i < queue.length; i++) {
    const id = queue[i];
    for (const edge of spec.edges.filter((e) => e.from === id)) {
      ranks.set(
        edge.to,
        Math.max(ranks.get(edge.to) ?? 0, (ranks.get(id) ?? 0) + 1),
      );
      indegree.set(edge.to, (indegree.get(edge.to) ?? 1) - 1);
      if (indegree.get(edge.to) === 0) queue.push(edge.to);
    }
  }
  const last = Math.max(0, ...ranks.values());
  const layers = new Map<number, string[]>();
  for (const node of spec.nodes) {
    const rank = ranks.get(node.id) ?? last + 1;
    const layer = layers.get(rank) ?? [];
    layer.push(node.id);
    layers.set(rank, layer);
  }
  // A compact reading-column layout avoids shrinking labels into miniature type.
  const columns = Math.max(1, ...[...layers.values()].map((l) => l.length));
  const width = Math.max(360, columns * 210 + 40);
  const positions = new Map<string, { x: number; y: number }>();
  [...layers.entries()]
    .sort((a, b) => a[0] - b[0])
    .forEach(([, ids], row) =>
      ids.forEach((id, col) =>
        positions.set(id, {
          x: width / 2 + (col - (ids.length - 1) / 2) * 210,
          y: 45 + row * 105,
        }),
      ),
    );
  return { width, height: Math.max(180, layers.size * 105), positions };
}
