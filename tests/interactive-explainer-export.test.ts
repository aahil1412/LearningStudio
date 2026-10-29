import { describe, expect, it } from "vitest";
import { composeOfflineBook, exportVisualState } from "../electron/exporter";
import type { ContentBlock } from "../src/types";
import {
  descentTrace,
  type Landscape,
  type Point2,
} from "../src/lib/explainers/optimization";
import {
  mutateDna,
  translateCodingDna,
  type GeneMutation,
} from "../src/lib/explainers/geneExpression";
import {
  compileExperiment,
  experimentValues,
} from "../src/lib/explainers/experiment";
import { exportFixture } from "./v2-export-fixture";

const gene: Extract<ContentBlock, { type: "illustration" }> = {
  type: "illustration",
  spec: {
    template: "gene-expression-lab",
    title: "Read a synthetic gene",
    gene: { codingDna: "ATGGCTTTTGAATAA" },
  },
};
const optimization: Extract<ContentBlock, { type: "illustration" }> = {
  type: "illustration",
  spec: {
    template: "optimization-lab",
    title: "Follow a loss gradient",
    optimization: { landscape: "quadratic", iterations: 60 },
  },
};
const experiment: Extract<ContentBlock, { type: "illustration" }> = {
  type: "illustration",
  spec: {
    template: "experiment",
    title: "Calculate an ideal force",
    experiment: {
      question: "How does mass change weight?",
      parameters: [
        {
          id: "mass",
          label: "Mass",
          unit: "kg",
          min: 1,
          max: 10,
          step: 0.5,
          value: 2,
        },
      ],
      derived: [
        { id: "force", label: "Weight", unit: "N", expression: "mass*9.81" },
      ],
      scene: {
        width: 800,
        height: 320,
        elements: [
          {
            id: "body",
            kind: "circle",
            label: "Body",
            x: "mass*40",
            y: "100",
            radius: "20",
          },
        ],
      },
      time: { duration: 6, step: 0.1, unit: "s" },
      stages: [
        {
          id: "light",
          title: "Small mass",
          explanation: "Inspect the calculated weight.",
        },
        {
          id: "heavy",
          title: "Larger mass",
          explanation: "More mass gives proportionally more weight.",
          parameters: { mass: 8 },
        },
      ],
      assumptions: ["Uniform g = 9.81 m/s² and ideal weight model."],
    },
  },
};

describe("portable interactive explainer state contracts", () => {
  it("preserves gene sequence, an actual mutation and reading position without exporting private fields or playback", () => {
    const state = exportVisualState(gene, {
      "gene.reference": "ATGGCTTTTGAATAA",
      "gene.mutation": {
        kind: "substitution",
        position: 6,
        base: "C",
        privateRecord: "PRIVATE_MUTATION_SENTINEL",
      },
      "gene.progress": 10,
      "gene.view": "mutation",
      "gene.labels": false,
      "gene.window": 4,
      "gene.selected": "pairing",
      "gene.playing": true,
      "gene.hidden": "PRIVATE_GENE_SENTINEL",
      "illustration.step": 99,
      "optimization.camera": { private: "PRIVATE_OTHER_SENTINEL" },
    });
    expect(state).toEqual({
      "gene.reference": "ATGGCTTTTGAATAA",
      "gene.mutation": { kind: "substitution", position: 6, base: "C" },
      "gene.progress": 10,
      "gene.view": "mutation",
      "gene.labels": false,
      "gene.window": 4,
      "gene.selected": "pairing",
    });
    const edited = mutateDna(
      state["gene.reference"] as string,
      state["gene.mutation"] as GeneMutation,
    );
    expect(translateCodingDna(edited).peptide).toBe("MALE");
    expect(JSON.stringify(state)).not.toContain("PRIVATE_");
  });

  it("validates progress against the edited transcript, including loss of the first AUG", () => {
    const input = {
      "gene.mutation": { kind: "substitution", position: 0, base: "C" },
      "gene.progress": 16,
    };
    expect(exportVisualState(gene, input)).toEqual({
      "gene.mutation": input["gene.mutation"],
    });
    expect(exportVisualState(gene, { ...input, "gene.progress": 15 })).toEqual({
      "gene.mutation": input["gene.mutation"],
      "gene.progress": 15,
    });
  });

  it("rejects malformed DNA, invalid mutation positions and fractional or oversized reading positions", () => {
    expect(
      exportVisualState(gene, {
        "gene.reference": "SECRET_NOT_A_SEQUENCE",
        "gene.mutation": { kind: "deletion", position: 999, base: "A" },
        "gene.progress": 0.5,
        "gene.window": Infinity,
        "gene.view": "PRIVATE",
        "gene.selected": "unknown",
        "gene.labels": "true",
      }),
    ).toEqual({});
    expect(
      exportVisualState(gene, {
        "gene.reference": "ATG",
        "gene.mutation": { kind: "deletion", position: 1, base: "T" },
        "gene.progress": 4,
        "gene.window": 3,
      }),
    ).toEqual({ "gene.reference": "ATG", "gene.progress": 4 });
    expect(
      exportVisualState(gene, {
        "gene.mutation": null,
        "gene.window": 0,
        "gene.progress": 0,
      }),
    ).toEqual({ "gene.mutation": null, "gene.window": 0, "gene.progress": 0 });
  });

  it("restores a computed optimization path and camera while isolating nested state", () => {
    const camera = {
      position: [9, -11, 10],
      target: [0, 0, 1.3],
      zoom: 1.2,
      accessToken: "PRIVATE_CAMERA_SENTINEL",
    };
    const input = {
      "optimization.landscape": "quadratic",
      "optimization.learningRate": 0.18,
      "optimization.start": [-3, 2.5],
      "optimization.iterations": 160,
      "optimization.step": 2,
      "optimization.compare": true,
      "optimization.show3d": true,
      "optimization.stage": 1,
      "optimization.camera": camera,
      "optimization.playing": true,
      "optimization.hidden": "PRIVATE_OPT_SENTINEL",
      "gene.reference": "ATG",
      "illustration.step": 12,
    };
    const state = exportVisualState(optimization, input);
    const trace = descentTrace(
      state["optimization.landscape"] as Landscape,
      state["optimization.start"] as Point2,
      state["optimization.learningRate"] as number,
      state["optimization.iterations"] as number,
    );
    expect(trace.points[1].point[0]).toBeCloseTo(-2.46, 12);
    expect(trace.points[1].point[1]).toBeCloseTo(0.7, 12);
    expect(state["optimization.step"]).toBe(2);
    expect(state["optimization.camera"]).toEqual({
      position: [9, -11, 10],
      target: [0, 0, 1.3],
      zoom: 1.2,
    });
    camera.position[0] = 999;
    expect(
      (state["optimization.camera"] as { position: number[] }).position[0],
    ).toBe(9);
    expect(Object.keys(state).sort()).toEqual([
      "optimization.camera",
      "optimization.compare",
      "optimization.iterations",
      "optimization.landscape",
      "optimization.learningRate",
      "optimization.show3d",
      "optimization.stage",
      "optimization.start",
      "optimization.step",
    ]);
    expect(JSON.stringify(state)).not.toContain("PRIVATE_");
    expect(state).not.toHaveProperty("optimization.playing");
  });

  it("restricts a start point to its selected landscape and step to its update limit", () => {
    expect(
      exportVisualState(optimization, {
        "optimization.landscape": "ravine",
        "optimization.start": [4, 0],
        "optimization.iterations": 10,
        "optimization.step": 11,
      }),
    ).toEqual({
      "optimization.landscape": "ravine",
      "optimization.iterations": 10,
    });
    expect(
      exportVisualState(optimization, {
        "optimization.landscape": "ravine",
        "optimization.start": [-1.2, 1],
        "optimization.iterations": 10,
        "optimization.step": 10,
      }),
    ).toEqual({
      "optimization.landscape": "ravine",
      "optimization.start": [-1.2, 1],
      "optimization.iterations": 10,
      "optimization.step": 10,
    });
    expect(
      exportVisualState(optimization, { "optimization.step": 61 }),
    ).toEqual({});
  });

  it.each([
    { position: [0, 0, 0], target: [0, 0, 0], zoom: 1 },
    { position: [1, 2, Infinity], target: [0, 0, 0], zoom: 1 },
    { position: [1, 2, 3, 4], target: [0, 0, 0], zoom: 1 },
    { position: [1e50, 2, 3], target: [0, 0, 0], zoom: 1 },
    { position: [1, 2, 3], target: [0, 0, 0], zoom: 0 },
  ])(
    "drops unusable cameras rather than exporting invalid view state: %j",
    (camera) => {
      expect(
        exportVisualState(optimization, { "optimization.camera": camera }),
      ).toEqual({});
    },
  );

  it("rejects nonfinite and out-of-range optimizer controls without silently accepting arbitrary fields", () => {
    expect(
      exportVisualState(optimization, {
        "optimization.landscape": "private-model",
        "optimization.learningRate": NaN,
        "optimization.start": [1, Infinity],
        "optimization.iterations": 1e9,
        "optimization.step": -1,
        "optimization.stage": 3,
        "optimization.compare": 1,
        "optimization.show3d": "yes",
        secret: "PRIVATE",
      }),
    ).toEqual({});
  });

  it("exports only declared experiment parameter IDs within bounds and recomputes the same readout", () => {
    const state = exportVisualState(experiment, {
      "experiment.parameters": {
        mass: 4,
        force: 999,
        accessToken: "PRIVATE_PARAM_SENTINEL",
        hidden: { message: "PRIVATE_NESTED_SENTINEL" },
      },
      "experiment.time": 2.5,
      "experiment.stage": 1,
      "experiment.selected": "body",
      "experiment.playing": true,
      "experiment.history": "PRIVATE_HISTORY_SENTINEL",
      "illustration.step": 3,
      "optimization.start": [1, 1],
    });
    expect(state).toEqual({
      "experiment.parameters": { mass: 4 },
      "experiment.time": 2.5,
      "experiment.stage": 1,
      "experiment.selected": "body",
    });
    const model = compileExperiment(experiment.spec.experiment!);
    expect(
      experimentValues(
        model,
        state["experiment.parameters"] as Record<string, number>,
        state["experiment.time"] as number,
      ).force,
    ).toBeCloseTo(39.24, 10);
    expect(JSON.stringify(state)).not.toContain("PRIVATE_");
  });

  it("drops inherited values, invalid selections, stages and times, without mutating the source", () => {
    const parameters = Object.create({ mass: 5 }) as Record<string, number>;
    expect(
      exportVisualState(experiment, {
        "experiment.parameters": parameters,
        "experiment.time": 7,
        "experiment.stage": 2,
        "experiment.selected": "private-note",
      }),
    ).toEqual({ "experiment.parameters": {} });
    expect(
      exportVisualState(experiment, {
        "experiment.parameters": { mass: 11 },
        "experiment.time": NaN,
        "experiment.stage": 0.5,
        "experiment.selected": "",
      }),
    ).toEqual({ "experiment.parameters": {}, "experiment.selected": "" });
    const untimed = {
      ...experiment,
      spec: {
        ...experiment.spec,
        experiment: {
          ...experiment.spec.experiment!,
          time: undefined,
          stages: undefined,
        },
      },
    };
    expect(
      exportVisualState(untimed, {
        "experiment.time": 0,
        "experiment.stage": 0,
      }),
    ).toEqual({});
  });

  it("applies the state boundary when composing a selected portable textbook chapter", () => {
    const { payload } = exportFixture(),
      chapter = payload.chapters[0],
      now = payload.exportedAt;
    chapter.blocks = [gene, optimization, experiment];
    payload.visuals = chapter.blocks.map((block, index) => ({
      id: `portable-${index}`,
      subjectId: "subject",
      block,
      placement: "inline",
      state: {
        "gene.reference": "ATGGCTTTTGAATAA",
        "optimization.learningRate": 0.18,
        "experiment.parameters": { mass: 4, private: 123 },
        "gene.playing": true,
        "optimization.playing": true,
        "experiment.playing": true,
        authToken: "PRIVATE_BOOK_TOKEN",
        memory: { content: "PRIVATE_BOOK_MEMORY" },
      },
      tags: [],
      annotations: [],
      createdAt: now,
      updatedAt: now,
    }));
    const book = composeOfflineBook(payload),
      json = JSON.stringify(book);
    expect(book.chapters[0].visualStates?.[0].state).toEqual({
      "gene.reference": "ATGGCTTTTGAATAA",
    });
    expect(book.chapters[0].visualStates?.[1].state).toEqual({
      "optimization.learningRate": 0.18,
    });
    expect(book.chapters[0].visualStates?.[2].state).toEqual({
      "experiment.parameters": { mass: 4 },
    });
    expect(json).not.toContain("PRIVATE_BOOK_");
    expect(json).not.toContain(".playing");
  });

  it("retains existing illustration behavior and rejects malformed top-level state", () => {
    const old: ContentBlock = {
      type: "illustration",
      spec: { template: "translation", title: "Legacy translation" },
    };
    expect(
      exportVisualState(old, {
        "illustration.step": 2,
        "illustration.selection": "trna",
        "illustration.playing": true,
      }),
    ).toEqual({ "illustration.step": 2, "illustration.selection": "trna" });
    for (const block of [gene, optimization, experiment])
      for (const input of [null, undefined, [], "PRIVATE", 42])
        expect(exportVisualState(block, input)).toEqual({});
  });
});
