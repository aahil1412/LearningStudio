import { expect, it } from "vitest";
import {
  chooseTeachingVisual,
  tutorSkillInstructions,
} from "../src/lib/tutorSkills";
import { selectProviderPreferences } from "../src/lib/providerSelection";
import { defaultData } from "../src/lib/defaults";
import { validateStudioData } from "../electron/storage";
import { validateContentBlock } from "../src/lib/visualSpecs";
import type { ContentBlock } from "../src/types";
const scene = (title: string, labels: string[]): ContentBlock => ({
  type: "illustration",
  spec: {
    template: "scene",
    title,
    scene: {
      participants: labels.map((label, index) => ({
        id: String(index),
        label,
        shape: "particle",
      })),
      relations: [],
    },
  },
});
it("upgrades the reported legacy blobs to meaningful trusted controls without mutating saved data", () => {
  const cases = [
    {
      block: scene("Yang-Mills: gluons interact with gluons", [
        "Quark",
        "Gluon A",
        "Gluon B",
      ]),
      template: "interaction-vertices",
    },
    {
      block: scene("One field, different states", [
        "Electron field",
        "Electron excitation",
      ]),
      template: "field-explorer",
    },
    {
      block: scene("One way proteins aggregate", [
        "Folded protein",
        "Partly unfolded protein",
        "Aggregate",
      ]),
      template: "protein-aggregation",
    },
  ];
  for (const { block, template } of cases) {
    const raw = JSON.stringify(block);
    const selected = chooseTeachingVisual(block);
    expect(selected.type === "illustration" && selected.spec.template).toBe(
      template,
    );
    expect(validateContentBlock(selected)).toBeTruthy();
    expect(JSON.stringify(block)).toBe(raw);
  }
});
it("does not convert an authored biology figure just because a request mentions QFT as a comparison", () => {
  const selected = chooseTeachingVisual(
    scene("Protein aggregation", ["Protein", "Aggregate"]),
    "Compare this to QFT",
  );
  expect(selected.type === "illustration" && selected.spec.template).toBe(
    "protein-aggregation",
  );
});
it("keeps unrelated relationship diagrams and includes the actual runtime authoring contract", () => {
  const block = scene("Supply and demand", ["Supply", "Demand"]);
  expect(chooseTeachingVisual(block)).toBe(block);
  expect(tutorSkillInstructions()).toContain("interaction-vertices");
  expect(tutorSkillInstructions()).toContain(
    "A label lookup alone is a conceptual diagram",
  );
});
it("provisioning without switching preserves models and explicit provider switching restores independent choices", () => {
  const settings = {
    ...defaultData().settings,
    models: {
      tutor: { model: "chat-model", reasoning: "xhigh" },
      visual: { model: "visual-model", reasoning: "low" },
      review: { model: "review-model", reasoning: "medium" },
    },
    planning: { model: "plan-model", reasoning: "low" },
  };
  expect(selectProviderPreferences(settings, "chatgpt")).toBe(settings);
  const local = selectProviderPreferences(settings, "local-fixture");
  expect(local.models.tutor.model).toBe("");
  const edited = {
    ...local,
    models: {
      ...local.models,
      tutor: { model: "provider:local-fixture:tiny", reasoning: "" },
    },
  };
  const restored = selectProviderPreferences(edited, "chatgpt");
  expect(restored.models).toEqual(settings.models);
  expect(restored.planning).toEqual(settings.planning);
  expect(
    selectProviderPreferences(restored, "local-fixture").models.tutor.model,
  ).toContain("tiny");
  const persisted = validateStudioData({
    ...defaultData(),
    settings: restored,
  });
  expect(
    persisted.settings.modelProfiles?.["local-fixture"].models.tutor.model,
  ).toContain("tiny");
});
