/** Data-only contracts for trusted, inline educational experiments. */
export type GeneExpressionConfig = { codingDna?: string; label?: string };
export type OptimizationConfig = {
  landscape?: "quadratic" | "ravine" | "himmelblau";
  learningRate?: number;
  start?: [number, number];
  iterations?: number;
};
export type ExperimentParameter = {
  id: string;
  label: string;
  unit: string;
  min: number;
  max: number;
  step: number;
  value: number;
};
export type ExperimentDerived = {
  id: string;
  label: string;
  expression: string;
  unit: string;
};
export type ExperimentElement = {
  id: string;
  kind: "circle" | "rect" | "line" | "arrow" | "text" | "spring" | "particles";
  label: string;
  detail?: string;
  x: string;
  y: string;
  x2?: string;
  y2?: string;
  width?: string;
  height?: string;
  radius?: string;
  text?: string;
  count?: string;
  tone?: "cool" | "warm" | "violet" | "green" | "neutral";
  drag?: { parameterId: string; axis: "x" | "y"; from: number; to: number };
};
export type ExperimentSpec = {
  question: string;
  parameters: ExperimentParameter[];
  derived?: ExperimentDerived[];
  scene?: { width: number; height: number; elements: ExperimentElement[] };
  plot?: {
    domain: [number, number];
    range?: [number, number];
    xLabel: string;
    yLabel: string;
    curves: {
      id: string;
      label: string;
      expression: string;
      tone?: ExperimentElement["tone"];
    }[];
  };
  time?: { duration: number; step: number; unit: string };
  stages?: {
    id: string;
    title: string;
    explanation: string;
    parameters?: Record<string, number>;
    time?: number;
    focusIds?: string[];
  }[];
  assumptions: string[];
};
