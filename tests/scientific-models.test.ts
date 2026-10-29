import { describe, it, expect } from "vitest";
import { fieldValue, aggregationKinetics } from "../src/lib/scientificModels";
import { illustrationSchema } from "../src/lib/visualSpecs";
import { exportVisualState } from "../electron/exporter";
const wave = {
  amplitude: 1,
  wavelength: 2,
  width: 1,
  speed: 1,
  mode: "packet" as const,
};
const protein = {
  concentration: 1,
  unfoldedFraction: 0.5,
  attraction: 0.3,
  partition: 4,
  condensate: false,
};
describe("trusted interactive teaching models", () => {
  it("calculates a translating Gaussian-enveloped classical field, not a probability or particle count", () => {
    expect(fieldValue(0, 3, wave)).toBe(1);
    expect(fieldValue(1, 4, wave)).toBe(1);
    expect(fieldValue(1, 3, wave)).toBeCloseTo(-Math.exp(-0.5), 12);
    expect(fieldValue(0.5, 3, wave)).toBeCloseTo(0, 12);
    expect(fieldValue(0, 3, { ...wave, amplitude: 0 })).toBe(0);
    expect(fieldValue(2, 3, { ...wave, mode: "wave" })).toBe(1);
  });
  it("conserves protein material and respects phase partition mass balance", () => {
    for (const condensate of [false, true])
      for (const time of [0, 1, 6, 12]) {
        const p = { ...protein, condensate },
          m = aggregationKinetics(p, time);
        expect(
          m.free + protein.concentration * m.aggregatedFraction,
        ).toBeCloseTo(protein.concentration, 12);
        expect(m.aggregatedFraction).toBeGreaterThanOrEqual(0);
        expect(m.aggregatedFraction).toBeLessThanOrEqual(
          protein.unfoldedFraction,
        );
        if (condensate) {
          expect(
            0.75 * m.concentrationOutside + 0.25 * m.concentrationInside,
          ).toBeCloseTo(m.free, 12);
          expect(m.concentrationInside / m.concentrationOutside).toBeCloseTo(
            p.partition,
            12,
          );
        }
      }
    expect(
      aggregationKinetics({ ...protein, condensate: true }, 6)
        .aggregatedFraction,
    ).toBeGreaterThan(aggregationKinetics(protein, 6).aggregatedFraction);
    expect(
      aggregationKinetics({ ...protein, condensate: true, partition: 1 }, 6)
        .aggregatedFraction,
    ).toBeCloseTo(aggregationKinetics(protein, 6).aggregatedFraction, 12);
  });
  it("has no association without susceptible chains, rate, or elapsed time", () => {
    for (const p of [
      { ...protein, attraction: 0 },
      { ...protein, unfoldedFraction: 0 },
    ])
      expect(aggregationKinetics(p, 12).aggregatedFraction).toBe(0);
    expect(aggregationKinetics(protein, 0).aggregatedFraction).toBe(0);
  });
  it("rejects nonfinite/out-of-range controls and forbidden elementary QED vertices", () => {
    for (const template of [
      "field-explorer",
      "protein-aggregation",
      "interaction-vertices",
    ])
      expect(
        illustrationSchema.safeParse({ template, title: "Valid model" })
          .success,
      ).toBe(true);
    for (const field of [{ amplitude: 3 }, { width: 0 }, { speed: Infinity }])
      expect(
        illustrationSchema.safeParse({
          template: "field-explorer",
          title: "Invalid",
          field,
        }).success,
      ).toBe(false);
    for (const vertex of ["three-boson", "four-boson"])
      expect(
        illustrationSchema.safeParse({
          template: "interaction-vertices",
          title: "Forbidden",
          interaction: { theory: "qed", vertex },
        }).success,
      ).toBe(false);
  });
  it("exports only finite allowed interaction parameters and starts paused", () => {
    expect(
      exportVisualState(
        {
          type: "illustration",
          spec: { template: "field-explorer", title: "Field" },
        },
        {
          "field.amplitude": 1.4,
          "field.time": 2,
          "field.mode": "packet",
          "field.playing": true,
          "field.width": -4,
          "field.selectedX": 4,
          PRIVATE: "secret",
        },
      ),
    ).toEqual({
      "field.amplitude": 1.4,
      "field.time": 2,
      "field.mode": "packet",
      "field.selectedX": 4,
    });
    expect(
      exportVisualState(
        {
          type: "illustration",
          spec: { template: "protein-aggregation", title: "Association" },
        },
        {
          "aggregation.partition": 6,
          "aggregation.condensate": true,
          "aggregation.selected": 12,
          "aggregation.playing": true,
          private: "hidden",
        },
      ),
    ).toEqual({
      "aggregation.partition": 6,
      "aggregation.condensate": true,
      "aggregation.selected": 12,
    });
    expect(
      exportVisualState(
        {
          type: "illustration",
          spec: {
            template: "interaction-vertices",
            title: "QED",
            interaction: { theory: "qed" },
          },
        },
        {
          "interaction.theory": "qed",
          "interaction.vertex": "four-boson",
          "interaction.selection": "PRIVATE",
        },
      ),
    ).toEqual({ "interaction.theory": "qed" });
  });
});
