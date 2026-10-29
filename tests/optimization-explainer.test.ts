import { describe, expect, it } from "vitest";
import { illustrationSchema } from "../src/lib/visualSpecs";
import {
  descentTrace,
  landscapeGradient,
  isLandscape,
  landscapeLoss,
  landscapes,
  sampleLandscape,
  type Landscape,
} from "../src/lib/explainers/optimization";

describe("calculated gradient descent explainer", () => {
  it("rejects inherited names and malformed restored landscape values", () => {
    for (const value of ["toString", "__proto__", "constructor", null, {}, 1]) {
      expect(isLandscape(value)).toBe(false);
      expect(() => descentTrace(value as Landscape, [0, 0], 0.1)).toThrow();
    }
    for (const value of ["quadratic", "ravine", "himmelblau"])
      expect(isLandscape(value)).toBe(true);
  });
  it("validates authored control bounds against the engine and actual renderer", () => {
    const spec = (optimization: Record<string, unknown>) =>
      illustrationSchema.safeParse({
        template: "optimization-lab",
        title: "Calculated descent",
        optimization,
      });
    expect(spec({ learningRate: 0.001, iterations: 300 }).success).toBe(true);
    expect(spec({ learningRate: 0.0001 }).success).toBe(false);
    expect(spec({ iterations: 301 }).success).toBe(false);
    expect(spec({ start: [4, 4] }).success).toBe(true);
    expect(spec({ start: [4.5, 0] }).success).toBe(false);
    expect(spec({ landscape: "ravine", start: [2.2, 3.2] }).success).toBe(true);
    expect(spec({ landscape: "ravine", start: [-3, 1] }).success).toBe(false);
    expect(spec({ landscape: "ravine", start: [0, -1.1] }).success).toBe(false);
    expect(spec({ landscape: "himmelblau", start: [-5, 5] }).success).toBe(
      true,
    );
  });
  for (const kind of Object.keys(landscapes) as Landscape[]) {
    it(`${kind}: analytic gradient agrees with independent finite differences`, () => {
      const point: [number, number] = [0.73, -0.42],
        h = 1e-5;
      const actual = landscapeGradient(kind, point);
      for (let axis = 0; axis < 2; axis++) {
        const low: [number, number] = [...point],
          high: [number, number] = [...point];
        low[axis] -= h;
        high[axis] += h;
        expect(actual[axis]).toBeCloseTo(
          (landscapeLoss(kind, high) - landscapeLoss(kind, low)) / (2 * h),
          7,
        );
      }
    });
  }
  it("takes the actual negative-gradient update and changing the rate changes the path", () => {
    const slow = descentTrace("quadratic", [2, 1], 0.1, 2);
    const fast = descentTrace("quadratic", [2, 1], 0.25, 2);
    expect(slow.points[1].point).toEqual([1.8, 0.6]);
    expect(fast.points[1].point).toEqual([1.5, 0]);
    expect(slow.points[1].loss).toBeLessThan(slow.points[0].loss);
    expect(fast.points[1].point).not.toEqual(slow.points[1].point);
  });
  it("converges on a bowl with a stable rate, but does not clamp a divergent rate", () => {
    const stable = descentTrace("quadratic", [-3, 2.5], 0.18, 160);
    expect(stable.status).toBe("stationary");
    expect(stable.points.at(-1)!.loss).toBeLessThan(1e-10);
    const unstable = descentTrace("quadratic", [-3, 2.5], 0.9, 160);
    expect(unstable.status).toBe("diverged");
    expect(unstable.points.at(-1)!.loss).toBeGreaterThan(
      unstable.points[0].loss,
    );
    expect(
      unstable.points.every((p) =>
        [p.loss, ...p.point, ...p.gradient].every(Number.isFinite),
      ),
    ).toBe(true);
  });
  it("recognizes a stationary point without claiming a global-minimum proof", () => {
    const stationary = descentTrace("quadratic", [0, 0], 0.2);
    expect(stationary.points).toHaveLength(1);
    expect(stationary.message).toContain("does not prove a global minimum");
    expect(landscapeLoss("ravine", [1, 1])).toBe(0);
    expect(landscapeLoss("himmelblau", [3, 2])).toBe(0);
    expect(landscapeGradient("himmelblau", [3, 2])).toEqual([0, 0]);
  });
  it("retains genuine multiple-basin behavior and bounded reproducible sampling", () => {
    const a = descentTrace("himmelblau", [3, 1], 0.15, 300).points.at(-1)!;
    const b = descentTrace("himmelblau", [-3, -2], 0.15, 300).points.at(-1)!;
    expect(a.loss).toBeLessThan(1e-6);
    expect(b.loss).toBeLessThan(1e-6);
    expect(
      Math.hypot(a.point[0] - b.point[0], a.point[1] - b.point[1]),
    ).toBeGreaterThan(3);
    const sample = sampleLandscape("quadratic", 21);
    expect(sample.values).toHaveLength(441);
    expect(sample.values[220]).toBe(0);
    expect(sample.values).toEqual(sampleLandscape("quadratic", 21).values);
  });
  it("rejects invalid numerical inputs rather than running unbounded or nonfinite calculations", () => {
    expect(() => descentTrace("quadratic", [NaN, 0], 0.1)).toThrow();
    expect(() => descentTrace("quadratic", [0, 0], 0)).toThrow();
    expect(() => descentTrace("quadratic", [0, 0], 0.1, 999999)).toThrow();
    expect(() => sampleLandscape("quadratic", 1000)).toThrow();
  });
});
