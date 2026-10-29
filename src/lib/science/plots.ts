import type { PlotSpec } from "../../types";
import {
  differentiate,
  evaluateExpression,
  expressionString,
  parseExpression,
} from "./expressions";
import { integrateOde, sampleExpressions } from "./numerics";
export type ScientificCurve = {
  name: string;
  x: (number | null)[];
  y: (number | null)[];
  z?: (number | null)[];
};
export function scientificCurves(
  spec: PlotSpec,
  parameters: Record<string, number>,
): { curves: ScientificCurve[]; derivative?: string } {
  const domain = spec.domain ?? [-5, 5],
    expressions = spec.expressions ?? [];
  if (spec.kind === "ode") {
    if (!spec.ode)
      throw new Error(
        "An ODE requires variables, derivatives, initial values, duration and step.",
      );
    const result = integrateOde(spec.ode, parameters);
    return {
      curves: spec.ode.variables.map((name, i) => ({
        name,
        x: result.times,
        y: result.states.map((state) => state[i]),
      })),
    };
  }
  if (spec.kind === "parametric") {
    if (expressions.length < 2 || expressions.length > 3)
      throw new Error(
        "A parametric curve requires x(t), y(t), and optionally z(t).",
      );
    const result = sampleExpressions(expressions, ["t"], parameters, domain);
    return {
      curves: [
        {
          name: "Parametric curve",
          x: result.values[0],
          y: result.values[1],
          ...(expressions.length === 3 ? { z: result.values[2] } : {}),
        },
      ],
    };
  }
  if (spec.kind !== "function")
    throw new Error("This specification uses a 3D renderer.");
  const result = sampleExpressions(expressions, ["x"], parameters, domain);
  const curves: ScientificCurve[] = expressions.map((expression, i) => ({
    name: expression,
    x: result.samples,
    y: result.values[i],
  }));
  let derivative: string | undefined;
  if (spec.showDerivative) {
    const ast = differentiate(result.asts[0]);
    derivative = expressionString(ast);
    curves.push({
      name: "Symbolic derivative",
      x: result.samples,
      y: result.samples.map((x) => {
        const value = evaluateExpression(ast, { ...parameters, x });
        return Number.isFinite(value) ? value : null;
      }),
    });
  }
  return { curves, derivative };
}
export function sampleSurface(
  spec: PlotSpec,
  parameters: Record<string, number>,
  resolution = 45,
) {
  const [min, max] = spec.domain ?? [-5, 5],
    [yMin, yMax] = spec.yDomain ?? [min, max];
  if (
    resolution < 3 ||
    resolution > 81 ||
    ![min, max, yMin, yMax].every(Number.isFinite) ||
    min >= max ||
    yMin >= yMax
  )
    throw new Error("Invalid surface sampling bounds.");
  const ast = parseExpression(spec.expressions?.[0] ?? "sin(x)*cos(y)", [
    "x",
    "y",
    ...Object.keys(parameters),
  ]);
  const positions: number[] = [],
    indices: number[] = [];
  const valid: boolean[] = [];
  for (let j = 0; j < resolution; j++)
    for (let i = 0; i < resolution; i++) {
      const x = min + ((max - min) * i) / (resolution - 1),
        y = yMin + ((yMax - yMin) * j) / (resolution - 1);
      const z = evaluateExpression(ast, { ...parameters, x, y });
      const finite = Number.isFinite(z) && Math.abs(z) <= 1e6;
      positions.push(x, y, finite ? z : 0);
      valid.push(finite);
    }
  for (let j = 0; j < resolution - 1; j++)
    for (let i = 0; i < resolution - 1; i++) {
      const a = j * resolution + i,
        b = a + 1,
        c = a + resolution,
        d = c + 1;
      if (valid[a] && valid[b] && valid[c]) indices.push(a, b, c);
      if (valid[b] && valid[c] && valid[d]) indices.push(b, d, c);
    }
  if (!indices.length)
    throw new Error("The surface has no finite values in this domain.");
  return { positions, indices, resolution };
}
export function sampleVectorField(
  spec: PlotSpec,
  parameters: Record<string, number>,
  resolution = 7,
) {
  if (spec.expressions?.length !== 3)
    throw new Error(
      "A 3D vector field requires exactly three component expressions.",
    );
  const asts = spec.expressions.map((e) =>
      parseExpression(e, ["x", "y", "z", ...Object.keys(parameters)]),
    ),
    [min, max] = spec.domain ?? [-3, 3];
  if (
    resolution < 2 ||
    resolution > 11 ||
    !Number.isFinite(min) ||
    !Number.isFinite(max) ||
    min >= max
  )
    throw new Error("Invalid vector field bounds.");
  const arrows: {
    origin: [number, number, number];
    vector: [number, number, number];
    magnitude: number;
  }[] = [];
  for (let i = 0; i < resolution; i++)
    for (let j = 0; j < resolution; j++)
      for (let k = 0; k < resolution; k++) {
        const x = min + ((max - min) * i) / (resolution - 1),
          y = min + ((max - min) * j) / (resolution - 1),
          z = min + ((max - min) * k) / (resolution - 1),
          vector = asts.map((ast) =>
            evaluateExpression(ast, { ...parameters, x, y, z }),
          ) as [number, number, number],
          magnitude = Math.hypot(...vector);
        if (
          vector.every(Number.isFinite) &&
          magnitude > 1e-12 &&
          magnitude < 1e6
        )
          arrows.push({ origin: [x, y, z], vector, magnitude });
      }
  if (!arrows.length)
    throw new Error(
      "The vector field contains no finite nonzero vectors in this domain.",
    );
  return arrows;
}
