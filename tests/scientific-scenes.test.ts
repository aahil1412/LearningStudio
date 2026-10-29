import { describe, expect, it } from "vitest";
import { illustrationSchema } from "../src/lib/visualSpecs";
import { scientificScenes } from "./scientific-scenes-fixture";

describe("authored scientific scene validation", () => {
  it("accepts all three scientifically qualified teaching examples", () => {
    for (const spec of Object.values(scientificScenes))
      expect(illustrationSchema.safeParse(spec).success).toBe(true);
  });
  it("rejects invalid IDs, duplicates, self-links and missing participants", () => {
    const source = scientificScenes.enzyme;
    for (const change of [
      (spec: typeof source) => {
        spec.scene!.relations[0].to = "missing";
      },
      (spec: typeof source) => {
        spec.scene!.relations[0].to = "enzyme";
      },
      (spec: typeof source) => {
        spec.scene!.relations.push({ ...spec.scene!.relations[0] });
      },
      (spec: typeof source) => {
        const edge = spec.scene!.relations[0];
        spec.scene!.relations.push({ ...edge, from: edge.to, to: edge.from });
      },
      (spec: typeof source) => {
        spec.scene!.steps![0].activeIds.push("enzyme");
      },
      (spec: typeof source) => {
        spec.scene!.steps![1].id = spec.scene!.steps![0].id;
      },
      (spec: typeof source) => {
        spec.scene!.steps![0].activeIds = ["absent"];
      },
      (spec: typeof source) => {
        spec.scene!.participants[0].label = " ";
      },
    ]) {
      const spec = structuredClone(source);
      change(spec);
      expect(illustrationSchema.safeParse(spec).success).toBe(false);
    }
  });
  it("accepts causal feedback while rejecting repeated edges instead of forbidding scientific cycles", () => {
    const spec = structuredClone(scientificScenes["gene-expression"]);
    spec.scene!.relations.push({
      from: "protein",
      to: "dna",
      kind: "regulation",
      label:
        "A regulatory protein can affect transcription in an appropriate gene circuit.",
    });
    expect(illustrationSchema.safeParse(spec).success).toBe(true);
  });
});
