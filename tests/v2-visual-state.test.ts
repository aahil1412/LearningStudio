import { describe, it, expect, vi } from "vitest";
vi.mock("../src/lib/bridge", () => ({ invoke: vi.fn(), isDesktop: false }));
import {
  assetIdentifier,
  duplicateVisualInstance,
  jsonValue,
  makeVisualInstance,
  resolvePlacement,
  updateVisualInstance,
  visualAssetIds,
  replaceVisualAssetIds,
  createVisualThemeObserver,
} from "../src/lib/visualState";
import {
  canvasSvg,
  validateLearningCanvas,
} from "../src/components/v2/LearningCanvas";
describe("durable visual instance identity", () => {
  it("preserves identity when moving and copies data without sharing mutable state", () => {
    const instance = makeVisualInstance(
      "subject-a",
      { type: "plot", spec: { kind: "wave", title: "A wave" } },
      {
        id: "same-instance",
        state: { "plot.parameters": { amplitude: 2 } },
        placement: "inline",
      },
    );
    const moved = updateVisualInstance(instance, { placement: "side" });
    expect(moved.id).toBe(instance.id);
    expect(moved.state).toEqual(instance.state);
    expect(Date.parse(moved.updatedAt)).toBeGreaterThan(
      Date.parse(instance.updatedAt),
    );
    const copy = duplicateVisualInstance(instance);
    expect(copy.id).not.toBe(instance.id);
    (copy.state["plot.parameters"] as { amplitude: number }).amplitude = 3;
    expect(
      (instance.state["plot.parameters"] as { amplitude: number }).amplitude,
    ).toBe(2);
  });
  it("resolves auto preference while respecting an explicit instance choice", () => {
    const instance = makeVisualInstance("subject-a", {
      type: "equation",
      latex: "x^2",
    });
    expect(resolvePlacement(instance, "split")).toBe("split");
    expect(
      resolvePlacement({ ...instance, placement: "inline" }, "split"),
    ).toBe("inline");
  });
  it("uses subject-scoped content addresses for immutable source buffers", async () => {
    const value = { data: "actual supplied coordinates", format: "pdb" };
    expect(await assetIdentifier("a", value)).toBe(
      await assetIdentifier("a", value),
    );
    expect(await assetIdentifier("a", value)).not.toBe(
      await assetIdentifier("b", value),
    );
    expect(() => jsonValue({ value: Infinity })).toThrow();
    expect(() => jsonValue({ callback: () => 42 })).toThrow();
  });
  it("rebinds imported immutable source references without changing camera or parameter values", () => {
    const state = {
      "molecule.structure": { assetId: "old:asset:source" },
      "molecule.camera": [1, 2, 3],
      "plot.parameters": { amplitude: 2 },
    };
    expect(visualAssetIds(state)).toEqual(["old:asset:source"]);
    const rebound = replaceVisualAssetIds(
      state,
      new Map([["old:asset:source", "new:asset:source"]]),
    );
    expect(rebound["molecule.structure"].assetId).toBe("new:asset:source");
    expect(rebound["molecule.camera"]).toEqual(state["molecule.camera"]);
    expect(state["molecule.structure"].assetId).toBe("old:asset:source");
  });
  it("does not invalidate SDK scenes when persistence reapplies identical theme attributes", () => {
    let notify = () => {};
    const attributes = { style: "--figure:#eee", class: "" },
      root = {
        getAttribute: (key: keyof typeof attributes) => attributes[key],
        dataset: { theme: "light" },
      };
    vi.stubGlobal("document", { documentElement: root });
    vi.stubGlobal(
      "MutationObserver",
      class {
        constructor(callback: () => void) {
          notify = callback;
        }
      },
    );
    try {
      const changed = vi.fn();
      createVisualThemeObserver(changed);
      notify();
      notify();
      expect(changed).not.toHaveBeenCalled();
      attributes.style = "--figure:#252e3b";
      notify();
      notify();
      expect(changed).toHaveBeenCalledTimes(1);
      root.dataset.theme = "dark";
      notify();
      expect(changed).toHaveBeenCalledTimes(2);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
describe("authored learning canvas records", () => {
  const canvas = {
    nodes: [
      {
        id: "note",
        kind: "text" as const,
        x: 0,
        y: 0,
        width: 300,
        height: 200,
        text: "<script> is text, never executable",
      },
      {
        id: "figure",
        kind: "visual" as const,
        x: 400,
        y: 0,
        width: 500,
        height: 500,
        visualId: "visual-id",
        block: {
          type: "plot" as const,
          spec: { kind: "wave" as const, title: "Authored wave" },
        },
      },
    ],
    edges: [{ id: "link", source: "note", target: "figure" }],
    viewport: { x: 20, y: 30, zoom: 0.7 },
    annotations: [],
  };
  it("persists nodes, reusable specifications, connections and viewport without screenshots", () => {
    expect(validateLearningCanvas(canvas)).toEqual(canvas);
    const svg = canvasSvg(canvas);
    expect(svg).toContain("&lt;script&gt;");
    expect(svg).not.toContain("<script>");
    expect(svg).toContain("Authored wave");
    expect(svg).toContain("<metadata>");
  });
  it("rejects invalid relationships, unbounded coordinates and executable visual types", () => {
    expect(() =>
      validateLearningCanvas({
        ...canvas,
        edges: [{ id: "bad", source: "missing", target: "figure" }],
      }),
    ).toThrow();
    expect(() =>
      validateLearningCanvas({
        ...canvas,
        nodes: [{ ...canvas.nodes[0], x: Infinity }],
      }),
    ).toThrow();
    expect(() =>
      validateLearningCanvas({
        ...canvas,
        nodes: [
          {
            ...canvas.nodes[1],
            block: { type: "javascript", code: "alert(1)" },
          },
        ],
      }),
    ).toThrow();
  });
});
