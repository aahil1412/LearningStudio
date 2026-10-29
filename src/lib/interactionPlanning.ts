import type { ContentBlock, Lesson } from "../types";
import type { TeachingPreferences } from "../v21types";
import {
  circuitExperiment,
  equilibriumExperiment,
} from "./explainers/examples";

/** A local modality router. Choosing a figure never adds a model request. */
export function planVisualInteraction(question: string, objective = "") {
  const continuation =
    /^\s*(continue|next|resume|begin|start|go on)(?:\s+(?:please|the lesson|this lesson|from here))?[.!?]*\s*$/i.test(
      question,
    );
  const topic = continuation ? `${question} ${objective}` : question;
  if (
    /\b(?:transcri(?:ption|be)|central dogma|gene expression|dna.{0,80}(?:rna.{0,30}protein|mutat|protein|amino[- ]?acid|base.{0,20}(?:chang|edit|substitut)\w*)|mutat.{0,60}(?:protein|gene|dna)|cod(?:ing|on).{0,35}mutat)\b/i.test(
      topic,
    )
  )
    return {
      mechanism: "sequence transformation",
      action: "step transcription, edit a base, compare codons and peptide",
      block: {
        type: "illustration",
        spec: {
          template: "gene-expression-lab",
          title: "From DNA to RNA to protein: change one base and compare",
          caption:
            "Synthetic coding sequence using the standard genetic code. This model explains transcription, reading frames and amino-acid sequence; it does not predict protein folding.",
        },
      } as ContentBlock,
    };
  if (
    /\b(?:gradient descent|learning rate|loss landscape|optim(?:ization|isation).{0,25}(?:gradient|descent))\b/i.test(
      topic,
    )
  )
    return {
      mechanism: "iterated optimization",
      action:
        "move the starting point, change learning rate, step and compare computed trajectories",
      block: {
        type: "illustration",
        spec: {
          template: "optimization-lab",
          title: "Take a gradient step, then change the learning rate",
          optimization: {
            landscape: "quadratic",
            learningRate: 0.1,
            start: [3, 2],
            iterations: 60,
          },
          caption:
            "Analytic two-dimensional example losses. Steps follow the negative gradient; a 3D surface shows the same mathematical loss.",
        },
      } as ContentBlock,
    };
  if (
    /\b(?:chemical equilibrium|equilibrium constant|reversible reaction|mass action)\b/i.test(
      topic,
    ) &&
    (!/\b(?:kinetic|kinetics|rate law|reaction order)\b/i.test(topic) ||
      /\bequilibrium\b/i.test(topic))
  )
    return {
      mechanism: "conserved equilibrium composition",
      action:
        "change total concentration and equilibrium constant, compare both species",
      block: {
        type: "illustration",
        spec: equilibriumExperiment,
      } as ContentBlock,
    };
  if (
    /\b(?:ohm['’]?s? law|ohmic|voltage.{0,30}(?:resistan|current)|resistan.{0,30}current)\b/i.test(
      topic,
    )
  )
    return {
      mechanism: "quantitative circuit relationship",
      action:
        "change voltage or resistance and inspect calculated current and power",
      block: { type: "illustration", spec: circuitExperiment } as ContentBlock,
    };
  return null;
}
export function integratePlannedInteraction(
  content: ContentBlock[],
  lesson: Lesson,
  question: string,
  preferences: TeachingPreferences,
) {
  if (
    preferences.delivery === "text-first" &&
    !/\b(?:visual|interact|simulat|diagram|experiment)\w*\b/i.test(question)
  )
    return content;
  if (
    /\b(?:why.{0,40}(?:wrong|correct|answer)|my answer|I chose|I picked|quiz me|test me)\b/i.test(
      question,
    ) ||
    lesson.mode === "Review" ||
    lesson.mode === "Practice"
  )
    return content;
  const plan = planVisualInteraction(
    question,
    `${lesson.objective} ${lesson.position}`,
  );
  if (!plan || plan.block.type !== "illustration") return content;
  const desired = plan.block.spec.template;
  if (
    content.some(
      (b) => b.type === "illustration" && b.spec.template === desired,
    )
  )
    return content;
  // Upgrade the older, ordered lesson cell at its original position. Moving the
  // new lab ahead of its prerequisite definitions breaks the teaching sequence.
  if (desired === "gene-expression-lab") {
    const legacy = content.findIndex(
      (b) => b.type === "illustration" && b.spec.template === "translation",
    );
    if (legacy >= 0)
      return content.map((block, index) =>
        index === legacy ? plan.block : block,
      );
  }
  if (content.some((b) => b.type === "molecule" || b.type === "image"))
    return content;
  const remaining = content.filter(
    (b) =>
      !(
        b.type === "illustration" &&
        ["scene", "process"].includes(b.spec.template)
      ),
  );
  const index = remaining.findIndex(
    (b) => b.type !== "concept" && b.type !== "terms" && b.type !== "text",
  );
  const firstText = remaining.findIndex((b) => b.type === "text");
  if (firstText >= 0) {
    const text = (
      remaining[firstText] as Extract<ContentBlock, { type: "text" }>
    ).text;
    if (text.length > 420) {
      // Markdown is an authored unit. Sentence/paragraph-looking boundaries may
      // be inside math, code or a citation; prepend the lab without slicing it.
      remaining.splice(firstText, 0, plan.block);
      return remaining;
    }
    remaining.splice(firstText + 1, 0, plan.block);
    return remaining;
  }
  remaining.splice(index < 0 ? remaining.length : index, 0, plan.block);
  return remaining;
}
