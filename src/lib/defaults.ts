import type { StudioData } from "../types";
export const defaultData = (): StudioData => ({
  version: 1,
  lessons: [],
  concepts: [],
  relations: [],
  library: [],
  settings: {
    personalization: false,
    profile: "",
    assessments: false,
    backgroundConsent: false,
    models: {
      tutor: { model: "", reasoning: "" },
      visual: { model: "", reasoning: "" },
      review: { model: "", reasoning: "" },
    },
    leftWidth: 244,
    rightWidth: 376,
    labOpen: false,
    visualizationPlacement: "inline",
  },
  appearance: null,
});
export const subjectCatalog = [
  "Mathematics",
  "Natural sciences",
  "Engineering",
  "Computing",
  "Humanities",
  "Social sciences",
  "Arts & design",
  "Languages",
  "Everyday life",
];
