import type { ContentBlock, Lesson } from "../types";
import { equilibriumExperiment } from "./explainers/examples";
export type InteractiveExample = "gene" | "optimization" | "equilibrium";
export function makeInteractiveLesson(kind: InteractiveExample): Lesson {
  const now = new Date().toISOString();
  const titles = {
    gene: "DNA, RNA and protein: change the message",
    optimization: "Gradient descent: choose the next step",
    equilibrium: "Chemical equilibrium: change the balance",
  };
  const content: ContentBlock[] =
    kind === "gene"
      ? [
          {
            type: "text",
            text: "Change one DNA base and follow what happens. First step through transcription. Then translate the RNA and compare the resulting amino-acid sequence with the original.",
          },
          {
            type: "illustration",
            spec: {
              template: "gene-expression-lab",
              title: "Follow the message from DNA to protein",
              gene: {
                codingDna: "ATGGCTTTTGAATAA",
                label: "Synthetic teaching sequence",
              },
              caption:
                "A synthetic, simplified coding region using the standard genetic code. No protein shape or clinical effect is predicted.",
            },
          },
          {
            type: "text",
            text: "DNA stores an ordered sequence of bases. During **transcription**, RNA polymerase reads the complementary template and builds RNA in the 5′ to 3′ direction. During **translation**, the ribosome reads RNA in three-base **codons**; tRNAs pair complementary **anticodons** and bring amino acids. A stop codon ends the chain. In this model, translation begins at the first AUG. Try a substitution, then a one-base deletion: the deletion can change how later bases are grouped.\n\nThe sequence is invented for teaching, not taken from an organism. Promoters, RNA processing, alternative genetic codes and folding are outside this model. [NCBI standard genetic code](https://www.ncbi.nlm.nih.gov/Taxonomy/Utils/wprintgc.cgi).",
          },
          {
            type: "mcq",
            question:
              "Why can deleting one base change several later amino acids?",
            choices: [
              {
                id: "frame",
                text: "It can shift the grouping of later bases into three-base codons.",
                explanation:
                  "A one-base deletion changes the reading frame unless another change restores it.",
              },
              {
                id: "all",
                text: "Every DNA change always removes the entire protein.",
                explanation:
                  "Effects vary. Some substitutions leave an amino acid unchanged, while others alter or stop translation.",
              },
            ],
            correctChoiceIds: ["frame"],
            allowUnknown: true,
            explanation:
              "A reading-frame shift changes codon boundaries. This optional checkpoint records one answer, not durable mastery.",
          },
        ]
      : kind === "optimization"
        ? [
            {
              type: "text",
              text: "Put the starting point on the loss landscape and take one step. Change the learning rate and compare the paths. The contour map and rotatable surface show the same loss function.",
            },
            {
              type: "illustration",
              spec: {
                template: "optimization-lab",
                title: "Follow a computed gradient trajectory",
                optimization: {
                  landscape: "quadratic",
                  learningRate: 0.1,
                  start: [3, 2],
                  iterations: 60,
                },
                caption:
                  "Analytic example losses with exact gradients. A large step may overshoot or diverge; the display reports that instead of faking convergence.",
              },
            },
            {
              type: "equation",
              latex:
                "\\boldsymbol{x}_{k+1}=\\boldsymbol{x}_k-\\eta\\nabla L(\\boldsymbol{x}_k)",
            },
            {
              type: "text",
              text: "The **gradient** gives the direction of fastest local increase of the loss. A gradient-descent update moves in the opposite direction, scaled by the **learning rate** $\\eta$. A small step can be slow. A large step can cross the valley and increase the loss. Change the starting point to test whether the same setting behaves similarly elsewhere.\n\nThese deterministic examples illustrate a numerical method. They do not train a neural network or imply that every nonconvex loss has one global solution. [Stanford Convex Optimization](https://web.stanford.edu/~boyd/cvxbook/bv_cvxbook.pdf).",
            },
          ]
        : [
            {
              type: "text",
              text: "Keep the total amount fixed and change the equilibrium constant. Watch one species gain exactly what the other loses. This is a composition calculation, not a movie of reaction rates.",
            },
            { type: "illustration", spec: equilibriumExperiment },
            {
              type: "equation",
              latex:
                "K=\\frac{[B]}{[A]},\\quad [A]+[B]=C,\\quad [A]=\\frac{C}{1+K},\\quad [B]=\\frac{CK}{1+K}",
            },
            {
              type: "text",
              text: "This ideal 1:1 example assumes a supplied equilibrium constant and fixed total concentration. It does not infer real molecular identities or temperature-dependent values. [OpenStax: Equilibrium constants](https://openstax.org/books/chemistry-2e/pages/13-2-equilibrium-constants).",
            },
          ];
  return {
    id: crypto.randomUUID(),
    title: titles[kind],
    subject:
      kind === "gene"
        ? "Biology"
        : kind === "optimization"
          ? "Computing"
          : "Chemistry",
    mode: "Learn",
    objective: titles[kind],
    position: "Explore the first mechanism",
    example: true,
    notes: "",
    createdAt: now,
    updatedAt: now,
    messages: [
      {
        id: crypto.randomUUID(),
        role: "assistant",
        text: "",
        content,
        blocks: content,
        status: "complete",
        createdAt: now,
      },
    ],
  };
}
