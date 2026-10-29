import {
  evaluateExpression,
  parseExpression,
  validVariable,
} from "./expressions";
export type OdeSpec = {
  variables: string[];
  derivatives: string[];
  initial: number[];
  duration: number;
  step: number;
};
export function validateOde(
  spec: OdeSpec,
  parameters: Record<string, number> = {},
) {
  if (
    !spec ||
    !Array.isArray(spec.variables) ||
    spec.variables.length < 1 ||
    spec.variables.length > 6 ||
    new Set(spec.variables).size !== spec.variables.length ||
    spec.variables.some(
      (v) => !validVariable(v) || v === "t" || Object.hasOwn(parameters, v),
    )
  )
    throw new Error(
      "Use 1–6 unique ODE variable names, distinct from parameters and t.",
    );
  if (
    spec.initial.length !== spec.variables.length ||
    spec.derivatives.length !== spec.variables.length ||
    spec.initial.some((v) => !Number.isFinite(v) || Math.abs(v) > 1e9)
  )
    throw new Error(
      "Every variable requires a finite initial value and derivative.",
    );
  if (
    !Number.isFinite(spec.duration) ||
    spec.duration <= 0 ||
    spec.duration > 1000 ||
    !Number.isFinite(spec.step) ||
    spec.step < 0.0001 ||
    spec.step > spec.duration ||
    Math.ceil(spec.duration / spec.step) > 8000
  )
    throw new Error(
      "Use a positive duration ≤1000 and at most 8000 integration steps (step ≥0.0001).",
    );
  return spec.derivatives.map((source) =>
    parseExpression(source, [
      "t",
      ...spec.variables,
      ...Object.keys(parameters),
    ]),
  );
}
/** Classical fourth-order Runge–Kutta with bounded work and finite-state checks. */
export function integrateOde(
  spec: OdeSpec,
  parameters: Record<string, number> = {},
) {
  const asts = validateOde(spec, parameters);
  const times = [0],
    states = [spec.initial.slice()];
  let t = 0,
    state = spec.initial.slice();
  const derivative = (time: number, values: number[]) => {
    const scope = {
      ...parameters,
      t: time,
      ...Object.fromEntries(spec.variables.map((v, i) => [v, values[i]])),
    };
    return asts.map((ast) => evaluateExpression(ast, scope));
  };
  for (let i = 0; i < Math.ceil(spec.duration / spec.step); i++) {
    const h = Math.min(spec.step, spec.duration - t);
    if (h <= 0) break;
    const k1 = derivative(t, state),
      k2 = derivative(
        t + h / 2,
        state.map((v, j) => v + (h * k1[j]) / 2),
      ),
      k3 = derivative(
        t + h / 2,
        state.map((v, j) => v + (h * k2[j]) / 2),
      ),
      k4 = derivative(
        t + h,
        state.map((v, j) => v + h * k3[j]),
      );
    state = state.map(
      (v, j) => v + (h * (k1[j] + 2 * k2[j] + 2 * k3[j] + k4[j])) / 6,
    );
    t = Math.min(spec.duration, t + h);
    if (state.some((v) => !Number.isFinite(v) || Math.abs(v) > 1e9))
      throw new Error(
        `The numerical solution diverged near t=${t.toPrecision(4)}. Reduce the step, check the model, and consider a solver for stiff systems.`,
      );
    times.push(t);
    states.push(state.slice());
  }
  return { times, states };
}
export function sampleExpressions(
  expressions: string[],
  variables: string[],
  parameters: Record<string, number>,
  domain: [number, number],
  count = 501,
) {
  if (
    expressions.length < 1 ||
    expressions.length > 4 ||
    count < 2 ||
    count > 2001 ||
    domain.some((v) => !Number.isFinite(v) || Math.abs(v) > 1e6) ||
    domain[0] >= domain[1]
  )
    throw new Error("Invalid expression sampling bounds.");
  const asts = expressions.map((source) =>
    parseExpression(source, [...variables, ...Object.keys(parameters)]),
  );
  const samples = Array.from(
    { length: count },
    (_, i) => domain[0] + ((domain[1] - domain[0]) * i) / (count - 1),
  );
  const values = asts.map((ast) =>
    samples.map((value) => {
      const result = evaluateExpression(ast, {
        ...parameters,
        [variables[0]]: value,
      });
      return Number.isFinite(result) ? result : null;
    }),
  );
  // A pole or jump is a gap, rather than a misleading connecting line.
  for (const series of values)
    for (let i = 1; i < series.length; i++) {
      const a = series[i - 1],
        b = series[i];
      if (
        a !== null &&
        b !== null &&
        Math.abs(a - b) > 1000 * (1 + Math.abs(samples[i] - samples[i - 1]))
      )
        series[i] = null;
    }
  return { samples, values, asts };
}
