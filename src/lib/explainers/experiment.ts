import { z } from "zod";
import type { ExperimentSpec, ExperimentElement } from "../../explainerTypes";
import {
  parseExpression,
  evaluateExpression,
  validVariable,
  type Expression,
} from "../science/expressions";

const identifier = z
  .string()
  .regex(/^[A-Za-z][A-Za-z0-9_]{0,23}$/)
  .refine(validVariable);
const expression = z.string().min(1).max(512);
const finite = z.number().finite().min(-1e6).max(1e6);
const label = z.string().min(1).max(160);
const tone = z.enum(["cool", "warm", "violet", "green", "neutral"]);
const interval = z
  .tuple([finite, finite])
  .refine(([a, b]) => a < b, "Use an increasing axis range.");
export const experimentSchema = z
  .object({
    question: z.string().min(1).max(600),
    parameters: z
      .array(
        z
          .object({
            id: identifier,
            label,
            unit: z.string().max(60),
            min: finite,
            max: finite,
            step: z.number().finite().positive(),
            value: finite,
          })
          .refine(
            (p) =>
              p.min < p.max &&
              p.step <= p.max - p.min &&
              p.value >= p.min &&
              p.value <= p.max,
            "Invalid parameter bounds.",
          ),
      )
      .min(1)
      .max(8),
    derived: z
      .array(
        z.object({
          id: identifier,
          label,
          expression,
          unit: z.string().max(60),
        }),
      )
      .max(12)
      .optional(),
    scene: z
      .object({
        width: z.number().int().min(600).max(1200),
        height: z.number().int().min(220).max(700),
        elements: z
          .array(
            z.object({
              id: identifier,
              kind: z.enum([
                "circle",
                "rect",
                "line",
                "arrow",
                "text",
                "spring",
                "particles",
              ]),
              label,
              detail: z.string().max(1000).optional(),
              x: expression,
              y: expression,
              x2: expression.optional(),
              y2: expression.optional(),
              width: expression.optional(),
              height: expression.optional(),
              radius: expression.optional(),
              text: z.string().max(200).optional(),
              count: expression.optional(),
              tone: tone.optional(),
              drag: z
                .object({
                  parameterId: identifier,
                  axis: z.enum(["x", "y"]),
                  from: finite,
                  to: finite,
                })
                .refine((d) => d.from !== d.to)
                .optional(),
            }),
          )
          .min(1)
          .max(24),
      })
      .optional(),
    plot: z
      .object({
        domain: interval,
        range: interval.optional(),
        xLabel: label,
        yLabel: label,
        curves: z
          .array(
            z.object({
              id: identifier,
              label,
              expression,
              tone: tone.optional(),
            }),
          )
          .min(1)
          .max(4),
      })
      .optional(),
    time: z
      .object({
        duration: z.number().finite().min(0.1).max(300),
        step: z.number().finite().min(0.01).max(2),
        unit: label,
      })
      .optional(),
    stages: z
      .array(
        z.object({
          id: identifier,
          title: label,
          explanation: z.string().min(1).max(1000),
          parameters: z.record(identifier, finite).optional(),
          time: z.number().finite().min(0).max(300).optional(),
          focusIds: z.array(identifier).max(24).optional(),
        }),
      )
      .min(1)
      .max(8)
      .optional(),
    assumptions: z.array(z.string().min(1).max(600)).min(1).max(8),
  })
  .superRefine((spec, ctx) => {
    try {
      compileExperiment(spec);
    } catch (error) {
      ctx.addIssue({
        code: "custom",
        message: error instanceof Error ? error.message : "Invalid experiment.",
      });
    }
  });

export type CompiledExperiment = {
  spec: ExperimentSpec;
  derived: { id: string; ast: Expression }[];
  elements: {
    element: ExperimentElement;
    expressions: Record<string, Expression>;
  }[];
  curves: { id: string; ast: Expression }[];
};
const keys = [
  "x",
  "y",
  "x2",
  "y2",
  "width",
  "height",
  "radius",
  "count",
] as const;
export function compileExperiment(spec: ExperimentSpec): CompiledExperiment {
  if (!spec.scene && !spec.plot)
    throw new Error("An experiment needs a visual scene or calculated plot.");
  const names = spec.parameters.map((p) => p.id),
    derived = (spec.derived || []).map((d) => d.id);
  if (
    new Set([...names, ...derived]).size !== names.length + derived.length ||
    [...names, ...derived].some((n) => n === "x" || n === "time")
  )
    throw new Error(
      "Parameter and derived names must be unique and distinct from x and time.",
    );
  const known = [...names, "time"];
  const parsed: { id: string; ast: Expression }[] = [];
  // Ordered dependencies make cycles and forward references explicit validation errors.
  for (const item of spec.derived || []) {
    parsed.push({ id: item.id, ast: parseExpression(item.expression, known) });
    known.push(item.id);
  }
  const ids = new Set(spec.scene?.elements.map((e) => e.id) || []);
  if (ids.size !== (spec.scene?.elements.length || 0))
    throw new Error("Scene element identifiers must be unique.");
  if (
    new Set(spec.plot?.curves.map((c) => c.id)).size !==
    (spec.plot?.curves.length || 0)
  )
    throw new Error("Curve identifiers must be unique.");
  const elements = (spec.scene?.elements || []).map((element) => {
    if (
      ["line", "arrow", "spring"].includes(element.kind) &&
      (!element.x2 || !element.y2)
    )
      throw new Error("Lines and springs need two endpoints.");
    if (element.kind === "rect" && (!element.width || !element.height))
      throw new Error("Rectangles need width and height expressions.");
    if (element.kind === "particles" && !element.count)
      throw new Error("Particle groups need a bounded count expression.");
    if (element.drag && !names.includes(element.drag.parameterId))
      throw new Error("A drag handle must reference an existing parameter.");
    const expressions: Record<string, Expression> = {};
    for (const key of keys)
      if (element[key] !== undefined)
        expressions[key] = parseExpression(element[key]!, known);
    return { element, expressions };
  });
  if (
    new Set(spec.stages?.map((s) => s.id)).size !== (spec.stages?.length || 0)
  )
    throw new Error("Stage identifiers must be unique.");
  for (const stage of spec.stages || []) {
    for (const [id, value] of Object.entries(stage.parameters || {})) {
      const parameter = spec.parameters.find((p) => p.id === id);
      if (!parameter || value < parameter.min || value > parameter.max)
        throw new Error("A stage parameter must use its declared bounds.");
    }
    if (
      stage.time !== undefined &&
      (!spec.time || stage.time > spec.time.duration)
    )
      throw new Error("Stage time is outside the experiment timeline.");
    if (stage.focusIds?.some((id) => !ids.has(id)))
      throw new Error("A stage must focus existing scene elements.");
  }
  return {
    spec,
    derived: parsed,
    elements,
    curves: (spec.plot?.curves || []).map((c) => ({
      id: c.id,
      ast: parseExpression(c.expression, [...known, "x"]),
    })),
  };
}
export function experimentValues(
  compiled: CompiledExperiment,
  input: Record<string, number>,
  time = 0,
) {
  const values: Record<string, number> = {
    time: Math.min(
      compiled.spec.time?.duration || 0,
      Math.max(0, Number.isFinite(time) ? time : 0),
    ),
  };
  for (const p of compiled.spec.parameters) {
    const v = input[p.id];
    values[p.id] = Number.isFinite(v)
      ? Math.max(p.min, Math.min(p.max, v))
      : p.value;
  }
  for (const d of compiled.derived) {
    const value = evaluateExpression(d.ast, values);
    if (!Number.isFinite(value) || Math.abs(value) > 1e12)
      throw new Error(
        `The formula for ${d.id} is undefined at these settings. Try another value or reset.`,
      );
    values[d.id] = value;
  }
  return values;
}
export function experimentGeometry(
  compiled: CompiledExperiment,
  values: Record<string, number>,
) {
  return compiled.elements.map(({ element, expressions }) => ({
    element,
    geometry: Object.fromEntries(
      Object.entries(expressions).map(([key, ast]) => {
        const value = evaluateExpression(ast, values);
        if (!Number.isFinite(value) || Math.abs(value) > 100000)
          throw new Error(
            `The geometry for ${element.label} is undefined. Change a parameter or reset.`,
          );
        if (["width", "height", "radius", "count"].includes(key) && value < 0)
          throw new Error(
            `The ${key} for ${element.label} cannot be negative. Change a parameter or reset.`,
          );
        return [key, value];
      }),
    ),
  }));
}
export function experimentCurves(
  compiled: CompiledExperiment,
  values: Record<string, number>,
) {
  const domain = compiled.spec.plot?.domain || [0, 1];
  return compiled.curves.map((curve) => ({
    id: curve.id,
    points: Array.from({ length: 201 }, (_, i) => {
      const x = domain[0] + ((domain[1] - domain[0]) * i) / 200;
      const y = evaluateExpression(curve.ast, { ...values, x });
      return { x, y: Number.isFinite(y) && Math.abs(y) < 1e12 ? y : null };
    }),
  }));
}
export function experimentDefaults(spec: ExperimentSpec) {
  return Object.fromEntries(spec.parameters.map((p) => [p.id, p.value]));
}

/** Place marks along both coordinates; zero is a valid endpoint. */
export function experimentParticlePositions(g: Record<string, number>) {
  const count = Math.max(0, Math.min(40, Math.round(g.count ?? 0)));
  return Array.from({ length: count }, (_, i) => ({
    x: g.x + (((g.x2 ?? g.x + 400) - g.x) * (i + 0.5)) / count,
    y: g.y + (((g.y2 ?? g.y) - g.y) * (i + 0.5)) / count,
  }));
}

/** Zigzags follow the full segment, with displacement perpendicular to it. */
export function experimentSpringPoints(g: Record<string, number>) {
  const dx = g.x2 - g.x,
    dy = g.y2 - g.y;
  const length = Math.hypot(dx, dy) || 1;
  return Array.from({ length: 17 }, (_, i) => {
    const offset = i === 0 || i === 16 ? 0 : i % 2 ? 14 : -14;
    return {
      x: g.x + (dx * i) / 16 - (dy / length) * offset,
      y: g.y + (dy * i) / 16 + (dx / length) * offset,
    };
  });
}

const textWidth = (value: string) =>
  Array.from(value).reduce(
    (width, char) =>
      width +
      (/[MW@#%]/.test(char) ? 20 : /[ilI1.,'′:;|! ]/.test(char) ? 6 : 12),
    0,
  );
function fitLabel(value: string) {
  const lines: string[] = [];
  let line = "";
  for (const token of value.trim().split(/\s+/)) {
    if (line && textWidth(line + " " + token) <= 224) {
      line += " " + token;
      continue;
    }
    if (line) lines.push(line);
    line = "";
    for (const char of token) {
      if (line && textWidth(line + char) > 224) {
        lines.push(line);
        line = "";
      }
      line += char;
    }
  }
  if (line) lines.push(line);
  const shown = lines.slice(0, 3);
  if (lines.length > 3) {
    let last = shown[2];
    while (textWidth(last + "…") > 224) last = last.slice(0, -1);
    shown[2] = last + "…";
  }
  return shown;
}

/** Labels are fitted by the renderer, not drawn over the scientific objects. */
export function experimentLabels(
  items: ReturnType<typeof experimentGeometry>,
  width: number,
  height: number,
) {
  type Box = { x: number; y: number; width: number; height: number };
  const overlaps = (a: Box, b: Box) =>
    a.x < b.x + b.width + 7 &&
    a.x + a.width + 7 > b.x &&
    a.y < b.y + b.height + 7 &&
    a.y + a.height + 7 > b.y;
  const bounds = items.map(({ element: e, geometry: g }) => {
    const x2 = g.x2 ?? g.x,
      y2 = g.y2 ?? g.y,
      r = g.radius ?? 14;
    if (e.kind === "text")
      return {
        x: g.x,
        y: g.y - 20,
        width: textWidth(e.text || e.label),
        height: 24,
      };
    return e.kind === "rect"
      ? {
          x: g.x,
          y: g.y,
          width: Math.max(1, g.width),
          height: Math.max(1, g.height),
        }
      : ["line", "arrow", "spring", "particles"].includes(e.kind)
        ? {
            x:
              Math.min(g.x, e.kind === "particles" ? (g.x2 ?? g.x + 400) : x2) -
              (e.kind === "spring" ? 16 : e.kind === "particles" ? r : 2),
            y:
              Math.min(g.y, y2) -
              (e.kind === "spring" ? 16 : e.kind === "particles" ? r : 2),
            width:
              Math.max(
                4,
                Math.abs(
                  (e.kind === "particles" ? (g.x2 ?? g.x + 400) : x2) - g.x,
                ),
              ) +
              (e.kind === "spring" ? 32 : e.kind === "particles" ? 2 * r : 4),
            height:
              Math.max(4, Math.abs(y2 - g.y)) +
              (e.kind === "spring" ? 32 : e.kind === "particles" ? 2 * r : 4),
          }
        : { x: g.x - r, y: g.y - r, width: 2 * r, height: 2 * r };
  });
  const occupied: Box[] = [];
  return items.map(({ element: e }, i) => {
    if (e.kind === "text") return null;
    const shown = fitLabel(e.label),
      boxWidth = Math.min(240, Math.max(0, ...shown.map(textWidth)) + 8),
      boxHeight = shown.length * 24;
    const object = bounds[i],
      cx = object.x + object.width / 2,
      cy = object.y + object.height / 2;
    const candidates = [
      { x: cx - boxWidth / 2, y: object.y - boxHeight - 17 },
      { x: cx - boxWidth / 2, y: object.y + object.height + 17 },
      { x: object.x - boxWidth - 20, y: cy - boxHeight / 2 },
      { x: object.x + object.width + 20, y: cy - boxHeight / 2 },
    ].map((b) => ({
      ...b,
      x: Math.max(12, Math.min(width - boxWidth - 12, b.x)),
      y: Math.max(12, Math.min(height - boxHeight - 12, b.y)),
      width: boxWidth,
      height: boxHeight,
    }));
    const box = candidates.find(
      (c) =>
        !bounds.some((b) => overlaps(c, b)) &&
        !occupied.some((b) => overlaps(c, b)),
    );
    if (!box) return null;
    occupied.push(box);
    return {
      id: e.id,
      lines: shown,
      x: box.x + boxWidth / 2,
      y: box.y + 19,
      anchor: { x: cx, y: cy },
      box,
    };
  });
}
