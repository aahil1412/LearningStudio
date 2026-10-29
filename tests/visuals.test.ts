import { describe, expect, it } from "vitest";
import {
  calculatePlot,
  initialParameters,
  layoutDiagram,
  parseTutorResponse,
  validateContentBlock,
} from "../src/lib/visualSpecs";

describe("visual content contracts", () => {
  it("accepts safe typed figures and discards malformed siblings without blocking a lesson", () => {
    const response = parseTutorResponse(
      JSON.stringify({
        text: "Continue with the lesson.",
        blocks: [
          {
            type: "diagram",
            spec: {
              title: "Invalid",
              nodes: [{ id: "a", label: "A" }],
              edges: [{ from: "a", to: "missing" }],
            },
          },
          { type: "plot", spec: { kind: "derivative", title: "Slope" } },
          { type: "exercise", question: "" },
          { type: "image", query: "Cell division diagram" },
        ],
      }),
    );
    expect(response.text).toBe("Continue with the lesson.");
    expect(response.blocks.map((b) => b.type)).toEqual(["plot", "image"]);
  });
  it("recovers plain text and fenced structured responses", () => {
    expect(parseTutorResponse("{broken").text).toBe("{broken");
    expect(
      parseTutorResponse('```json\n{"text":"hello","blocks":[]}\n```').text,
    ).toBe("hello");
  });
  it("rejects executable blocks, huge diagrams, duplicate IDs and nonfinite parameters", () => {
    expect(
      validateContentBlock({ type: "javascript", code: "alert(1)" }),
    ).toBeNull();
    expect(
      validateContentBlock({
        type: "plot",
        spec: {
          kind: "wave",
          title: "Bad",
          parameters: { amplitude: Infinity },
        },
      }),
    ).toBeNull();
    expect(
      validateContentBlock({
        type: "diagram",
        spec: {
          title: "Bad",
          nodes: [
            { id: "a", label: "A" },
            { id: "a", label: "B" },
          ],
          edges: [],
        },
      }),
    ).toBeNull();
    expect(
      validateContentBlock({
        type: "diagram",
        spec: {
          title: "Huge",
          nodes: Array.from({ length: 100 }, (_, i) => ({
            id: `a${i}`,
            label: "A",
          })),
          edges: [],
        },
      }),
    ).toBeNull();
  });
});
describe("deterministic scientific plots", () => {
  it("calculates a true tangent with matching value and exact derivative", () => {
    const curves = calculatePlot(
      { kind: "derivative", title: "Derivative" },
      { point: 2 },
    );
    const index = curves[0].x.indexOf(2);
    expect(curves[0].y[index]).toBe(4);
    expect(curves[1].y[index]).toBe(4);
    expect(curves[1].y[index + 1] - curves[1].y[index]).toBeCloseTo(4 / 40);
  });
  it("normalizes Gaussian density numerically and clamps invalid initial parameters", () => {
    const [curve] = calculatePlot(
      { kind: "gaussian", title: "Gaussian" },
      { mean: 0, sigma: 1 },
    );
    expect(curve.y.reduce((a, b) => a + b, 0) / 40).toBeCloseTo(1, 5);
    expect(
      initialParameters({
        kind: "gaussian",
        title: "Gaussian",
        parameters: { sigma: -40 },
      }).sigma,
    ).toBe(0.2);
  });
  it("computes logistic growth toward the carrying capacity and finite oscillator values", () => {
    const [logistic] = calculatePlot(
      { kind: "logistic", title: "Growth" },
      { rate: 1, capacity: 100 },
    );
    expect(logistic.y[0]).toBe(1);
    expect(logistic.y.at(-1)).toBeCloseTo(100, 3);
    const osc = calculatePlot({ kind: "oscillator", title: "Oscillation" }, {});
    expect(osc[0].y[0]).toBe(1);
    expect(osc.every((c) => c.y.every(Number.isFinite))).toBe(true);
  });
});
describe("bounded diagram layout", () => {
  it("places prerequisites in successive rows and handles cycles without looping", () => {
    const result = layoutDiagram({
      title: "A chain",
      nodes: [
        { id: "a", label: "A" },
        { id: "b", label: "B" },
        { id: "c", label: "C" },
      ],
      edges: [
        { from: "a", to: "b" },
        { from: "b", to: "c" },
      ],
    });
    expect(result.positions.get("b")!.y).toBeGreaterThan(
      result.positions.get("a")!.y,
    );
    expect(result.positions.get("c")!.y).toBeGreaterThan(
      result.positions.get("b")!.y,
    );
    const cycle = layoutDiagram({
      title: "Cycle",
      nodes: [
        { id: "a", label: "A" },
        { id: "b", label: "B" },
      ],
      edges: [
        { from: "a", to: "b" },
        { from: "b", to: "a" },
      ],
    });
    expect(cycle.positions.size).toBe(2);
  });
});
