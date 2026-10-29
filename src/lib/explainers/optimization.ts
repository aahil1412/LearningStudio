/** Exact, deterministic teaching landscapes. All coordinates and losses are unitless.
 * No model-generated code is evaluated. The rescaling is displayed in the UI.
 * Formulas verified against SFU's Rosenbrock test-function reference and TU Delft's
 * published Himmelblau implementation. Analytic derivatives are independently
 * checked with central finite differences in optimization-explainer.test.ts.
 * https://www.sfu.ca/~ssurjano/rosen.html
 * https://cpp.api.tudat.space/tutorials/applicationWalkthroughs/himmelblau.html */
export type Landscape = "quadratic" | "ravine" | "himmelblau";
export type Point2 = [number, number];
export type DescentPoint = {
  step: number;
  point: Point2;
  loss: number;
  gradient: Point2;
};
export type DescentTrace = {
  points: DescentPoint[];
  status: "stationary" | "limit" | "diverged";
  message: string;
};
export const landscapes: Record<
  Landscape,
  {
    name: string;
    formula: string;
    description: string;
    xDomain: Point2;
    yDomain: Point2;
    start: Point2;
    rate: number;
  }
> = {
  quadratic: {
    name: "Elliptical bowl",
    formula: "L(x,y) = (x² + 4y²) / 2",
    description:
      "The y direction is four times as curved. A step that is gentle along x can overshoot along y.",
    xDomain: [-4, 4],
    yDomain: [-4, 4],
    start: [-3, 2.5],
    rate: 0.18,
  },
  ravine: {
    name: "Curved ravine",
    formula: "L(x,y) = [(1 − x)² + 100(y − x²)²] / 100",
    description:
      "A rescaled Rosenbrock landscape. The narrow valley bends, so the local downhill direction keeps changing.",
    xDomain: [-2.2, 2.2],
    yDomain: [-1, 3.2],
    start: [-1.2, 1],
    rate: 0.035,
  },
  himmelblau: {
    name: "Multiple basins",
    formula: "L(x,y) = [(x² + y − 11)² + (x + y² − 7)²] / 100",
    description:
      "A rescaled Himmelblau landscape. Different starting points can lead to different minima with the same loss.",
    xDomain: [-5, 5],
    yDomain: [-5, 5],
    start: [-3, -1],
    rate: 0.06,
  },
};
/** Imported visual state is untrusted; prototype names are not landscapes. */
export function isLandscape(value: unknown): value is Landscape {
  return typeof value === "string" && Object.hasOwn(landscapes, value);
}

export function landscapeLoss(kind: Landscape, [x, y]: Point2): number {
  if (kind === "quadratic") return (x * x + 4 * y * y) / 2;
  if (kind === "ravine") return ((1 - x) ** 2 + 100 * (y - x * x) ** 2) / 100;
  return ((x * x + y - 11) ** 2 + (x + y * y - 7) ** 2) / 100;
}
export function landscapeGradient(kind: Landscape, [x, y]: Point2): Point2 {
  if (kind === "quadratic") return [x, 4 * y];
  if (kind === "ravine")
    return [(2 * (x - 1) - 400 * x * (y - x * x)) / 100, 2 * (y - x * x)];
  const a = x * x + y - 11,
    b = x + y * y - 7;
  return [(4 * x * a + 2 * b) / 100, (2 * a + 4 * y * b) / 100];
}
export function descentTrace(
  kind: Landscape,
  start: Point2,
  rate: number,
  iterations = 120,
): DescentTrace {
  if (
    !isLandscape(kind) ||
    !start.every(Number.isFinite) ||
    start.some((v) => Math.abs(v) > 1e4) ||
    !Number.isFinite(rate) ||
    rate <= 0 ||
    rate > 1 ||
    !Number.isInteger(iterations) ||
    iterations < 1 ||
    iterations > 300
  )
    throw new Error(
      "Choose a finite starting point, learning rate above zero and at most 300 updates.",
    );
  const points: DescentPoint[] = [];
  let point: Point2 = [...start];
  for (let step = 0; step <= iterations; step++) {
    const loss = landscapeLoss(kind, point),
      gradient = landscapeGradient(kind, point);
    if (
      ![...point, loss, ...gradient].every(Number.isFinite) ||
      loss > 1e10 ||
      point.some((v) => Math.abs(v) > 1e5)
    )
      return {
        points,
        status: "diverged",
        message:
          "The calculated updates grew beyond the numerical safety bound. The path was stopped, not clamped into a fake solution. Lower the learning rate.",
      };
    points.push({ step, point: [...point], loss, gradient });
    if (Math.hypot(...gradient) < 1e-6)
      return {
        points,
        status: "stationary",
        message:
          "The gradient is near zero at this point. A stationary point alone does not prove a global minimum.",
      };
    point = [point[0] - rate * gradient[0], point[1] - rate * gradient[1]];
  }
  return {
    points,
    status: "limit",
    message:
      "The requested updates are calculated. Reaching the step limit is not a claim that optimization has converged.",
  };
}
export function inLandscapeView(kind: Landscape, [x, y]: Point2) {
  const { xDomain, yDomain } = landscapes[kind];
  return (
    x >= xDomain[0] && x <= xDomain[1] && y >= yDomain[0] && y <= yDomain[1]
  );
}
export function sampleLandscape(kind: Landscape, count = 72) {
  if (!Number.isInteger(count) || count < 8 || count > 150)
    throw new Error("Use a bounded landscape grid.");
  const meta = landscapes[kind],
    values: number[] = [];
  for (let row = 0; row < count; row++) {
    const y =
      meta.yDomain[1] -
      (row / (count - 1)) * (meta.yDomain[1] - meta.yDomain[0]);
    for (let col = 0; col < count; col++) {
      const x =
        meta.xDomain[0] +
        (col / (count - 1)) * (meta.xDomain[1] - meta.xDomain[0]);
      values.push(landscapeLoss(kind, [x, y]));
    }
  }
  return { count, values, min: Math.min(...values), max: Math.max(...values) };
}
