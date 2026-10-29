import { chooseTeachingVisual } from "./tutorSkills";
import type { ContentBlock, Lesson, MCQBlock, Message } from "../types";
import type { SubjectContext } from "../v2types";
import {
  defaultTeachingPreferences,
  type TeachingPreferences,
  type SubjectIntake,
} from "../v21types";
import { validateContentBlock } from "./visualSpecs";
import { requestedImageQuery } from "./messageContent";
import { integratePlannedInteraction } from "./interactionPlanning";
export { requestedImageQuery } from "./messageContent";

export function resolveTeachingPreferences(
  value?: Partial<TeachingPreferences>,
): TeachingPreferences {
  return { ...defaultTeachingPreferences, ...value };
}

/** The controller sends a compact, explicit teaching state rather than a biography. */
export function teachingControlState(
  lesson: Lesson,
  preferences: TeachingPreferences,
  context?: SubjectContext,
) {
  const concepts = (context?.concepts ?? []).filter(
    (c): c is Record<string, unknown> => Boolean(c) && typeof c === "object",
  );
  const demonstrated = concepts
    .filter((c) => c.status === "demonstrated")
    .map((c) => ({ id: c.id, label: c.label }));
  const needsAttention = concepts
    .filter(
      (c) =>
        typeof c.status === "string" &&
        ["misconception", "review", "unresolved", "partial"].includes(c.status),
    )
    .map((c) => ({ id: c.id, label: c.label, status: c.status }));
  const checks = lesson.messages
    .flatMap((m) => m.content ?? m.blocks ?? [])
    .filter((b) => b.type === "mcq" || b.type === "exercise").length;
  const recentCheckpointResults = lesson.messages
    .flatMap((message) =>
      (message.content ?? message.blocks ?? []).flatMap((block, index) => {
        if (block.type !== "mcq") return [];
        const saved = lesson.exerciseResponses?.[`${message.id}:${index}`];
        if (!saved) return [];
        const response = readMCQResponse(saved.answer);
        if (!response.submitted && !saved.skipped) return [];
        const selected = response.selected.filter((id) =>
          block.choices.some((c) => c.id === id),
        );
        const validSelection =
          selected.length === response.selected.length &&
          (Boolean(block.multiple) || selected.length <= 1);
        return [
          {
            messageId: message.id,
            question: block.question.slice(0, 700),
            selected: selected.map((id) =>
              block.choices.find((c) => c.id === id)!.text.slice(0, 300),
            ),
            unknown: response.unknown,
            skipped: saved.skipped,
            correct:
              response.submitted && validSelection
                ? gradeMCQ(block, selected, response.unknown).correct
                : null,
            attempts: response.attempts,
            interpretation:
              "Checkpoint evidence only; do not infer durable mastery or a learner explanation.",
          },
        ];
      }),
    )
    .slice(-8);
  return {
    mode: lesson.mode,
    objective: lesson.objective,
    position: lesson.position,
    currentGoal: lesson.goals?.find((g) => g.status === "current"),
    preferences,
    demonstrated,
    needsAttention,
    recentChecks: checks,
    recentCheckpointResults,
    responseFormat: "ordered-content-stream",
    checkpoint:
      preferences.checkFrequency === "requested"
        ? "Only when explicitly requested"
        : preferences.checkFrequency === "occasionally"
          ? "At a natural conceptual boundary, avoid consecutive checks"
          : "At the end of the current concept/topic, optional",
    preservePositionDuringTangent: true,
  };
}

export const translationTerms: Extract<ContentBlock, { type: "terms" }> = {
  type: "terms",
  items: [
    {
      term: "mRNA",
      definition:
        "Messenger RNA. A molecule carrying a sequence of bases that a ribosome reads to build a protein.",
    },
    {
      term: "codon",
      definition:
        "A group of three mRNA bases. Most codons specify an amino acid, a small building block of proteins; three codons signal stop.",
    },
    {
      term: "tRNA",
      definition:
        "Transfer RNA. An adaptor molecule that brings a particular amino acid to a ribosome.",
    },
    {
      term: "anticodon",
      definition:
        "Three bases on a tRNA that pair with a complementary mRNA codon in the opposite orientation.",
    },
    {
      term: "ribosome",
      definition:
        "The cell's RNA-and-protein machinery that reads mRNA and joins amino acids into a chain.",
    },
    {
      term: "polypeptide",
      definition:
        "A chain of amino acids joined by peptide bonds. It grows from its amino (N) end toward its carboxyl (C) end during translation.",
    },
  ],
};

export const translationCheckpoint: MCQBlock = {
  type: "mcq",
  id: "translation-codon-pairing",
  question:
    "What connects an mRNA codon to the amino acid added to a growing protein?",
  choices: [
    {
      id: "adaptor",
      text: "A tRNA pairs its anticodon with the codon and carries the corresponding amino acid.",
      explanation:
        "A tRNA is an adaptor: its anticodon reads a codon, while its other end carries an amino acid.",
    },
    {
      id: "dna",
      text: "DNA enters the ribosome and bonds directly to the amino acid.",
      explanation:
        "The ribosome reads mRNA. DNA does not serve as the direct template inside the ribosome.",
    },
    {
      id: "identical",
      text: "The ribosome joins amino acids by matching identical codon and anticodon sequences.",
      explanation:
        "Codons and anticodons pair through complementary bases in opposite orientations, rather than identical sequences.",
    },
  ],
  correctChoiceIds: ["adaptor"],
  allowUnknown: true,
  explanation:
    "Codon recognition selects a tRNA, and the ribosome links the amino acid carried by that tRNA to the growing chain. A single correct answer is evidence for this checkpoint, not proof of lasting mastery.",
};

export const boltzmannContent: ContentBlock[] = [
  {
    type: "concept",
    title: "How temperature spreads energy",
    prerequisites: [
      "A probability density describes probability per unit of energy.",
    ],
    objective:
      "Compare a simple Boltzmann energy distribution at different temperatures.",
  },
  {
    type: "text",
    text: "For a system with a constant density of energy states and energies $E\\geq0$, the normalized Boltzmann density decreases exponentially with energy. The plot uses $x=E/k_B$, so its horizontal axis has units of kelvin. Here $k_B$ is Boltzmann's constant and $T$ is absolute temperature.",
  },
  {
    type: "equation",
    latex: "p(x)=\\frac{1}{T}e^{-x/T},\\qquad x=E/k_B\\geq0,\\quad T>0",
  },
  {
    type: "plot",
    spec: {
      kind: "function",
      title: "Boltzmann energy density, constant density of states",
      xLabel: "Energy / k_B (K)",
      yLabel: "Probability density (K⁻¹)",
      expressions: ["exp(-x/T)/T"],
      domain: [0, 2500],
      parameters: { T: 300 },
      parameterRanges: { T: { min: 50, max: 1000, step: 10 } },
    },
  },
  {
    type: "text",
    text: "Raise the temperature to broaden the distribution. The total area from zero to infinity stays one. This finite plotting window omits probability $e^{-2500/T}$ above its upper limit. This continuum example assumes a constant density of states. Systems with degeneracy or discrete energy levels require the corresponding state weights and partition function. [Reference: MIT Statistical Mechanics, canonical distribution and density of states](https://www.ocw.mit.edu/courses/8-333-statistical-mechanics-i-statistical-mechanics-of-particles-fall-2013/0cdb670a825c6aaea7e229ac40776cbf_MIT8_333F13_Lec13.pdf).",
  },
];

export const temperatureFieldContent: ContentBlock[] = [
  {
    type: "text",
    text: "A temperature field assigns a temperature to each position. This illustrative surface shows a warm region on a uniform background. Adjust the temperature rise and width to explore how the spatial profile changes.",
  },
  {
    type: "plot",
    spec: {
      kind: "surface",
      title: "An illustrative temperature field",
      expressions: ["T0+A*exp(-(x^2+y^2)/(2*s^2))"],
      domain: [-4, 4],
      yDomain: [-4, 4],
      parameters: { T0: 293, A: 40, s: 1 },
      parameterRanges: {
        T0: { min: 250, max: 350, step: 1 },
        A: { min: 0, max: 100, step: 1 },
        s: { min: 0.2, max: 3, step: 0.1 },
      },
      xLabel: "x (m)",
      yLabel: "y (m)",
      zLabel: "Temperature (K)",
    },
  },
  {
    type: "equation",
    latex: "T(x,y)=T_0+A\\exp\\left[-\\frac{x^2+y^2}{2s^2}\\right]",
  },
  {
    type: "text",
    text: "Here $T_0$ is the background temperature, $A$ is the temperature rise, and $s$ sets the width in meters. The peak at the origin is $T_0+A$. This is a calculated example field, not a measured climate map or a time-dependent solution of the heat equation.",
  },
];

/** A requested retrieval is executed independently from the model and can work while disconnected. */
export function localVisualRequest(request: string): ContentBlock[] | null {
  const query = requestedImageQuery(request);
  if (query)
    return [
      {
        type: "text",
        text: `Searching reusable educational images for **${query.replace(/[[\]<>]/g, "")}**. Each result includes its source and license. Choose an alternative if the first figure is unsuitable.`,
      },
      { type: "image", query, retrievalRequested: true },
    ];
  // Respect a request for text-only reasoning even when it names a plot.
  if (
    /\b(?:without|no|avoid|do not|don't)\s+(?:\w+\s+){0,2}(?:plots?|graphs?|surfaces?|simulations?|visuals?|figures?|images?)\b/i.test(
      request,
    )
  )
    return null;
  if (
    /boltzmann/i.test(request) &&
    /\b(plot|graph|simulation|interactive)\b/i.test(request)
  )
    return boltzmannContent;
  if (
    /\b(?:temperature|thermal)\b/i.test(request) &&
    /\b(?:field|spatial)\b/i.test(request) &&
    /\b(?:plot|surface|map|visual\w*|show|figure|illustrat\w*)\b/i.test(request)
  )
    return temperatureFieldContent;
  return null;
}

function cleanProse(text: string) {
  // Preserve code and LaTeX exactly; normalize only prose outside those spans.
  return text
    .split(/(```[\s\S]*?```|`[^`]*`|\$\$[\s\S]*?\$\$|\$[^$\n]*\$)/g)
    .map((part, index) =>
      index % 2
        ? part
        : part
            .replace(
              /\s*—\s*(\p{L})/gu,
              (_match, letter: string) => ". " + letter.toUpperCase(),
            )
            .replace(/\s*—\s*/g, ". ")
            .replace(/\.\s*\./g, "."),
    )
    .join("");
}

/** The same per-block rule runs before mounting streamed and completed content.
 * It never moves a block, creates a fallback, or initiates a network request. */
export function applyTeachingBlockPolicy(
  block: ContentBlock,
  request: string,
  settings?: Partial<TeachingPreferences>,
): ContentBlock | null {
  block = chooseTeachingVisual(block, request);
  if (block.type === "image") {
    const query = requestedImageQuery(request);
    // A model-provided flag cannot grant permission for an unrelated lookup.
    return query ? { ...block, query, retrievalRequested: true } : null;
  }
  if (!resolveTeachingPreferences(settings).avoidEmDashes) return block;
  switch (block.type) {
    case "text":
      return { ...block, text: cleanProse(block.text) };
    case "terms":
      return {
        ...block,
        items: block.items.map((item) => ({
          ...item,
          definition: cleanProse(item.definition),
        })),
      };
    case "mcq":
      return {
        ...block,
        question: cleanProse(block.question),
        choices: block.choices.map((choice) => ({
          ...choice,
          text: cleanProse(choice.text),
          explanation: choice.explanation
            ? cleanProse(choice.explanation)
            : undefined,
        })),
        explanation: block.explanation
          ? cleanProse(block.explanation)
          : undefined,
      };
    case "exercise":
      return {
        ...block,
        question: cleanProse(block.question),
        hint: block.hint ? cleanProse(block.hint) : undefined,
        answer: block.answer ? cleanProse(block.answer) : undefined,
      };
    case "concept":
      return {
        ...block,
        title: cleanProse(block.title),
        objective: block.objective ? cleanProse(block.objective) : undefined,
      };
    default:
      return block;
  }
}
export function contentText(content: ContentBlock[]) {
  return content
    .map((b) =>
      b.type === "text"
        ? b.text
        : b.type === "concept"
          ? b.title
          : b.type === "terms"
            ? b.items.map((t) => `${t.term}: ${t.definition}`).join("\n")
            : b.type === "mcq"
              ? b.question
              : "",
    )
    .filter(Boolean)
    .join("\n\n");
}

/** Apply ordering and validated deterministic visual planning after schema validation. */
export function prepareTeachingContent(
  input: { text: string; blocks: ContentBlock[]; content?: ContentBlock[] },
  lesson: Lesson,
  request: string,
  settings?: Partial<TeachingPreferences>,
  control?: { intake?: SubjectIntake | null },
): ContentBlock[] {
  const preferences = resolveTeachingPreferences(settings);
  let content: ContentBlock[] = input.content
    ? [...input.content]
    : [
        ...(input.text ? [{ type: "text" as const, text: input.text }] : []),
        ...input.blocks,
      ];
  content = content
    .map((b) => validateContentBlock(b))
    .filter((b): b is ContentBlock => Boolean(b))
    .map((b) => applyTeachingBlockPolicy(b, request, preferences))
    .filter((b): b is ContentBlock => Boolean(b));
  const explicit = localVisualRequest(request);
  if (explicit) {
    // The deterministic renderer handles real calculations or licensed retrieval.
    // Keep any additional model explanation after the requested visual output.
    content = [
      ...explicit,
      ...content.filter(
        (b) =>
          b.type !== "image" &&
          !(b.type === "plot" && /boltzmann/i.test(request)) &&
          !(
            b.type === "plot" &&
            b.spec.kind === "surface" &&
            /\b(?:temperature|thermal)\b/i.test(request)
          ),
      ),
    ];
  } else {
    const responseTopic = contentText(content).slice(0, 2000);
    content = integratePlannedInteraction(
      content,
      lesson,
      request,
      preferences,
    );
    const subjectTopic = `${lesson.subject} ${lesson.objective} ${lesson.position}`;
    const continuation =
      /^\s*(continue|next|resume|start|begin|go on|teach)\b/i.test(request);
    const biologicalTerms =
      /\b(?:biolog\w*|molecular|genetic\w*|protein\w*|tRNA|mRNA|ribosom\w*|codon|anticodon)\b/i;
    const activeTranslation =
      /\btranslation\b/i.test(request) &&
      biologicalTerms.test(`${request} ${subjectTopic}`) &&
      !/\b(language|French|Spanish|English|German|linguistic)\b/i.test(request);
    const biologicalTranslation =
      activeTranslation ||
      (/\btranslation\b/i.test(responseTopic) &&
        biologicalTerms.test(responseTopic)) ||
      (continuation &&
        /\btranslation\b/i.test(subjectTopic) &&
        biologicalTerms.test(subjectTopic));
    const explicitCheck =
      /\b(quiz|test me|checkpoint|MCQ|multiple.choice|practice question|check my understanding)\b/i.test(
        request,
      );
    const feedbackTurn =
      /\b(why.{0,45}(?:wrong|correct|choice|answer)|my answer|I (?:chose|picked)|explain (?:that|it) again)\b/i.test(
        request,
      );
    const lastAssistant = lesson.messages
      .filter((m) => m.role === "assistant")
      .at(-1);
    const lastContent = lastAssistant?.content ?? lastAssistant?.blocks ?? [];
    const lastHadCheck = lastContent.some(
      (b) => b.type === "mcq" || b.type === "exercise",
    );
    const allowCheck =
      explicitCheck ||
      (preferences.checkFrequency !== "requested" &&
        !feedbackTurn &&
        !(preferences.checkFrequency === "occasionally" && lastHadCheck));
    const allowBaseline =
      control?.intake?.assessment === "requested" &&
      !lesson.messages.some(
        (m) => m.role === "assistant" && m.status !== "failed",
      );
    content = content.filter(
      (b) => b.type !== "mcq" || b.purpose !== "baseline" || allowBaseline,
    );
    if (!allowCheck)
      content = content.filter(
        (b) =>
          (b.type !== "mcq" && b.type !== "exercise") ||
          (b.type === "mcq" && b.purpose === "baseline" && allowBaseline),
      );
    if (
      preferences.practice === "free-response" &&
      !/\b(MCQ|multiple.choice)\b/i.test(request)
    )
      content = content.filter((b) => b.type !== "mcq");
    if (biologicalTranslation && preferences.delivery !== "text-first") {
      const illustration = content.findIndex(
        (b) =>
          b.type === "illustration" &&
          ["translation", "gene-expression-lab"].includes(b.spec.template),
      );
      if (illustration < 0) {
        // A DAG of DNA -> RNA -> protein cannot show codon recognition.
        content = content.filter(
          (b) =>
            !(
              b.type === "diagram" &&
              /translation|protein|ribosom|mRNA/i.test(JSON.stringify(b.spec))
            ),
        );
        content.unshift({
          type: "illustration",
          spec: {
            template: "translation",
            title: "How a ribosome matches a codon to an amino acid",
            caption:
              "A schematic of decoding and peptide-bond formation. The shapes show functional relationships, not atomic coordinates.",
          },
        });
      }
      // Preserve the model's staged definitions and transcription introduction.
      // Only fill missing prerequisites immediately before the translation figure.
      const termKey = (term: string) => {
        const key = term
          .toLowerCase()
          .replace(/\s*\([^)]*\)/g, "")
          .trim();
        return key === "messenger rna"
          ? "mrna"
          : key === "transfer rna"
            ? "trna"
            : key;
      };
      const seen = new Set<string>();
      content = content.flatMap((block): ContentBlock[] => {
        if (block.type !== "terms") return [block];
        const items = block.items.filter((item) => {
          const key = termKey(item.term);
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
        return items.length ? [{ ...block, items }] : [];
      });
      let figureAt = content.findIndex(
        (block) =>
          block.type === "illustration" &&
          ["translation", "gene-expression-lab"].includes(block.spec.template),
      );
      const defined = new Set(
        content
          .slice(0, figureAt)
          .flatMap((block) =>
            block.type === "terms"
              ? block.items.map((item) => termKey(item.term))
              : [],
          ),
      );
      const required = translationTerms.items.filter(
        (item) => !defined.has(termKey(item.term)),
      );
      if (required.length) {
        const keys = new Set(required.map((item) => termKey(item.term)));
        const later = content
          .slice(figureAt)
          .flatMap((block) => (block.type === "terms" ? block.items : []));
        const additions = required.map(
          (item) =>
            later.find((term) => termKey(term.term) === termKey(item.term)) ||
            item,
        );
        content = content.flatMap((block, index): ContentBlock[] => {
          if (index < figureAt || block.type !== "terms") return [block];
          const items = block.items.filter(
            (item) => !keys.has(termKey(item.term)),
          );
          return items.length ? [{ ...block, items }] : [];
        });
        figureAt = content.findIndex(
          (block) =>
            block.type === "illustration" &&
            ["translation", "gene-expression-lab"].includes(
              block.spec.template,
            ),
        );
        content.splice(figureAt, 0, { type: "terms", items: additions });
      }
      if (!content.some((b) => b.type === "concept"))
        content.unshift({
          type: "concept",
          title: content.some(
            (b) =>
              b.type === "illustration" &&
              b.spec.template === "gene-expression-lab",
          )
            ? "Gene expression: follow the sequence from DNA to protein"
            : "Translation: reading RNA to build a protein",
          prerequisites: [
            "RNA is a chain of bases; proteins are chains of amino acids.",
          ],
          objective: content.some(
            (b) =>
              b.type === "illustration" &&
              b.spec.template === "gene-expression-lab",
          )
            ? "Follow RNA synthesis, codon reading and the consequences of sequence changes."
            : "Follow how the ribosome selects and joins one amino acid.",
        });
      if (
        allowCheck &&
        preferences.practice !== "free-response" &&
        !lesson.messages.some((m) =>
          (m.content ?? m.blocks ?? []).some(
            (b) =>
              b.type === "mcq" && b.question === translationCheckpoint.question,
          ),
        ) &&
        !content.some((b) => b.type === "mcq")
      )
        content.push(translationCheckpoint);
    }
    if (preferences.delivery === "visual-first") {
      const visualIndex = content.findIndex((b) =>
        ["illustration", "image", "plot", "molecule", "chemical"].includes(
          b.type,
        ),
      );
      if (visualIndex > 2) {
        const introIndex = content.findIndex((b) => b.type === "text");
        let definitionIndex = -1;
        for (let i = 0; i < visualIndex; i++)
          if (content[i].type === "terms") definitionIndex = i;
        const [visual] = content.splice(visualIndex, 1);
        content.splice(
          Math.max(
            definitionIndex + 1,
            introIndex < 0 ? Math.min(2, content.length) : introIndex + 1,
          ),
          0,
          visual,
        );
      }
    }
  }
  if (!content.length)
    content = [
      {
        type: "text",
        text: "You can continue learning without an assessment. Your lesson position is preserved.",
      },
    ];
  content = content.slice(0, 64);
  return content
    .map((block) => applyTeachingBlockPolicy(block, request, preferences))
    .filter((block): block is ContentBlock => Boolean(block));
}

/** Read-time adapter preserves legacy IDs and never writes a destructive transcript migration. */
export function orderedMessageContent(
  message: Message,
): { block: ContentBlock; index: number; visualId: string }[] {
  if (message.content?.length)
    return message.content.map((block, index) => ({
      block,
      index,
      visualId: message.visualInstanceIds?.[index] || `${message.id}:${index}`,
    }));
  const entries = (message.blocks ?? []).map((block, index) => ({
    block,
    index,
    visualId: message.visualInstanceIds?.[index] || `${message.id}:${index}`,
  }));
  const initial = message.text.trim();
  if (
    initial &&
    !entries.some(
      (e) => e.block.type === "text" && e.block.text.trim() === initial,
    )
  )
    entries.unshift({
      block: { type: "text", text: message.text },
      index: -1,
      visualId: `${message.id}:legacy-text`,
    });
  return entries;
}

export type MCQResponse = {
  version: 1;
  selected: string[];
  submitted: boolean;
  unknown: boolean;
  attempts: number;
  correct?: boolean;
  recovered?: boolean;
};
export function readMCQResponse(
  answer: string | undefined,
  block?: MCQBlock,
): MCQResponse {
  try {
    const value: unknown = JSON.parse(answer || "");
    if (value && typeof value === "object") {
      const o = value as Record<string, unknown>;
      if (
        o.version === 1 &&
        Array.isArray(o.selected) &&
        o.selected.length <= 6 &&
        o.selected.every((x) => typeof x === "string")
      ) {
        const selected = o.selected as string[];
        const stale =
          new Set(selected).size !== selected.length ||
          Boolean(
            block &&
            (selected.some(
              (id) => !block.choices.some((choice) => choice.id === id),
            ) ||
              (!block.multiple && selected.length > 1)),
          );
        return {
          version: 1,
          selected: stale ? [] : selected,
          submitted: !stale && o.submitted === true,
          unknown: !stale && o.unknown === true,
          attempts:
            typeof o.attempts === "number" && Number.isFinite(o.attempts)
              ? Math.max(0, Math.min(100000, Math.trunc(o.attempts)))
              : 0,
          recovered: stale || o.recovered === true,
        };
      }
    }
  } catch {
    /* Old free-response data is preserved by its original renderer. */
  }
  return {
    version: 1,
    selected: [],
    submitted: false,
    unknown: false,
    attempts: 0,
  };
}
export function gradeMCQ(block: MCQBlock, selected: string[], unknown = false) {
  const allowed = new Set(block.choices.map((c) => c.id));
  if (
    new Set(selected).size !== selected.length ||
    selected.some((id) => !allowed.has(id)) ||
    (!block.multiple && selected.length > 1)
  )
    throw new Error("Select valid question choices.");
  const correct =
    !unknown &&
    selected.length === block.correctChoiceIds.length &&
    selected.every((id) => block.correctChoiceIds.includes(id));
  return {
    correct,
    selected: [...selected],
    feedback: unknown
      ? "No problem. Read the explanation, then try again when you are ready."
      : correct
        ? "Correct for this checkpoint. We will use later evidence to assess durable understanding."
        : "There is a gap to revisit. Read the feedback, then try again.",
    mastery: false as const,
  };
}
