import { z } from "zod";
import type {
  Concept,
  ContentBlock,
  GradingSpec,
  KnowledgeSuggestion,
  LibraryItem,
  ReviewCard,
  StudioData,
} from "../types";

export const gradingSchema = z
  .discriminatedUnion("kind", [
    z.object({
      kind: z.literal("numeric"),
      expected: z.number().finite(),
      tolerance: z.number().finite().min(0).max(1e100),
      unit: z.string().max(80).optional(),
    }),
    z.object({
      kind: z.literal("symbolic"),
      expected: z.string().trim().min(1).max(1200),
      variables: z.array(z.string().regex(/^[A-Za-z_]\w{0,24}$/)).max(8),
    }),
    z.object({
      kind: z.literal("exact"),
      accepted: z.array(z.string().trim().min(1).max(4000)).min(1).max(50),
      caseSensitive: z.boolean().optional(),
    }),
    z.object({
      kind: z.literal("rubric"),
      criteria: z
        .array(
          z.object({
            id: z.string().min(1).max(100),
            description: z.string().trim().min(1).max(2000),
            required: z.boolean(),
          }),
        )
        .min(1)
        .max(30),
      referenceAnswer: z.string().max(10000).optional(),
    }),
  ])
  .superRefine((value, ctx) => {
    if (value.kind === "rubric") {
      if (
        new Set(value.criteria.map((c) => c.id)).size !== value.criteria.length
      )
        ctx.addIssue({
          code: "custom",
          message: "Rubric criterion IDs must be unique.",
        });
      if (!value.criteria.some((c) => c.required))
        ctx.addIssue({
          code: "custom",
          message: "At least one rubric criterion must be required.",
        });
    }
  });

const containers = new Set<LibraryItem["kind"]>([
  "subject",
  "course",
  "topic",
  "practice",
]);
export function libraryPath(items: LibraryItem[], id: string): LibraryItem[] {
  const result: LibraryItem[] = [];
  const seen = new Set<string>();
  let next = items.find((i) => i.id === id);
  while (next && !seen.has(next.id)) {
    seen.add(next.id);
    result.unshift(next);
    next = items.find((i) => i.id === next!.parentId);
  }
  return result;
}
export function libraryHierarchyProblems(
  items: LibraryItem[],
  validLessonIds?: Set<string>,
): string[] {
  const problems: string[] = [];
  const ids = new Set<string>();
  for (const item of items) {
    if (ids.has(item.id)) problems.push(`Duplicate library ID: ${item.id}`);
    ids.add(item.id);
    if (item.parentId) {
      const parent = items.find((i) => i.id === item.parentId);
      if (!parent) problems.push(`Missing parent for ${item.title}`);
      else if (!containers.has(parent.kind))
        problems.push(`${parent.title} cannot contain resources`);
      if (item.kind === "subject")
        problems.push("Subjects must be at the library root");
      if (item.kind === "course" && parent?.kind !== "subject")
        problems.push("A course belongs inside a subject");
      if (item.kind === "topic" && parent?.kind === "practice")
        problems.push("A topic belongs inside a subject, course, or topic");
      const seen = new Set([item.id]);
      let cursor = parent;
      while (cursor) {
        if (seen.has(cursor.id)) {
          problems.push(`Hierarchy cycle at ${item.title}`);
          break;
        }
        seen.add(cursor.id);
        cursor = items.find((i) => i.id === cursor!.parentId);
      }
    }
    if (new Set(item.lessonIds || []).size !== (item.lessonIds || []).length)
      problems.push(`Duplicate linked lessons in ${item.title}`);
    if (
      validLessonIds &&
      (item.lessonIds || []).some((id) => !validLessonIds.has(id))
    )
      problems.push(`Missing linked lesson in ${item.title}`);
  }
  return [...new Set(problems)];
}
export function reparentLibraryItem(
  items: LibraryItem[],
  id: string,
  parentId?: string,
): LibraryItem[] {
  if (!items.some((i) => i.id === id))
    throw new Error("The resource no longer exists.");
  const moved = items.map((item) =>
    item.id === id ? { ...item, parentId: parentId || undefined } : item,
  );
  const problems = libraryHierarchyProblems(moved);
  if (problems.length) throw new Error(problems[0]);
  return moved.map((item) => {
    const subject = libraryPath(moved, item.id).find(
      (ancestor) => ancestor.kind === "subject",
    );
    return subject ? { ...item, subject: subject.title } : item;
  });
}
export function removeLibraryItem(
  items: LibraryItem[],
  id: string,
): LibraryItem[] {
  const removed = items.find((i) => i.id === id);
  if (!removed) return items;
  // Children survive removal, promoted to the closest valid ancestor or root.
  return items
    .filter((i) => i.id !== id)
    .map((item) =>
      item.parentId === id
        ? {
            ...item,
            parentId:
              item.kind === "subject" || item.kind === "course"
                ? undefined
                : removed.parentId,
          }
        : item,
    );
}
export function removeLessonReferences(
  data: StudioData,
  lessonId: string,
): StudioData {
  const clear = <T extends { lessonId?: string }>(item: T): T =>
    item.lessonId === lessonId ? { ...item, lessonId: undefined } : item;
  return {
    ...data,
    lessons: data.lessons.filter((lesson) => lesson.id !== lessonId),
    activeLessonId:
      data.activeLessonId === lessonId ? undefined : data.activeLessonId,
    concepts: data.concepts.map(clear),
    library: data.library.map((item) => ({
      ...item,
      lessonIds: item.lessonIds?.filter((id) => id !== lessonId),
    })),
    reviewCards: data.reviewCards?.map(clear),
    knowledgeSuggestions: data.knowledgeSuggestions?.map(clear),
    graphHistory: data.graphHistory
      ? {
          past: data.graphHistory.past.map((snapshot) => ({
            ...snapshot,
            concepts: snapshot.concepts.map(clear),
          })),
          future: data.graphHistory.future.map((snapshot) => ({
            ...snapshot,
            concepts: snapshot.concepts.map(clear),
          })),
        }
      : undefined,
    backgroundTasks: data.backgroundTasks?.map((task) =>
      task.lessonId === lessonId
        ? {
            ...task,
            enabled: false,
            status: "cancelled",
            lessonId: undefined,
            error: "The source lesson was removed.",
            updatedAt: new Date().toISOString(),
          }
        : task,
    ),
  };
}
export function scheduleReview(
  card: ReviewCard,
  quality: number,
  now = new Date(),
): ReviewCard {
  if (!Number.isInteger(quality) || quality < 0 || quality > 5)
    throw new Error("Review quality must be an integer from 0 to 5.");
  const ease = Math.min(
    10,
    Math.max(
      1.3,
      card.easeFactor + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02)),
    ),
  );
  const repetitions = quality < 3 ? 0 : card.repetitions + 1;
  const intervalDays =
    quality < 3
      ? 1
      : repetitions === 1
        ? 1
        : repetitions === 2
          ? 6
          : Math.max(1, Math.ceil(card.intervalDays * card.easeFactor));
  return {
    ...card,
    easeFactor: Math.round(ease * 1000) / 1000,
    repetitions,
    intervalDays: Math.min(36500, intervalDays),
    lapses: card.lapses + (quality < 3 ? 1 : 0),
    dueAt: new Date(
      now.getTime() + Math.min(36500, intervalDays) * 86400000,
    ).toISOString(),
  };
}
export function reviewCardFromExercise(
  block: Extract<ContentBlock, { type: "exercise" }>,
  lessonId?: string,
  collectionId?: string,
  now = new Date(),
): ReviewCard {
  if (!block.question.trim() || !block.answer?.trim())
    throw new Error(
      "A reusable practice card needs a question and a reference answer.",
    );
  const grading: GradingSpec = block.grading || {
    kind: "rubric",
    criteria: [
      {
        id: "reasoning",
        description:
          "Compare the response with the reference and check the reasoning step by step.",
        required: true,
      },
    ],
    referenceAnswer: block.answer,
  };
  const parsed = gradingSchema.safeParse(grading);
  if (!parsed.success)
    throw new Error("The exercise grading specification is malformed.");
  return {
    id: crypto.randomUUID(),
    question: block.question,
    answer: block.answer,
    grading: parsed.data,
    lessonId,
    collectionId,
    dueAt: now.toISOString(),
    intervalDays: 0,
    repetitions: 0,
    easeFactor: 2.5,
    lapses: 0,
    createdAt: now.toISOString(),
  };
}

type Ast =
  | { kind: "number"; value: string }
  | { kind: "symbol"; name: string }
  | { kind: "unary"; op: string; value: Ast }
  | { kind: "binary"; op: string; left: Ast; right: Ast }
  | { kind: "call"; name: string; value: Ast };
class Parser {
  tokens: string[];
  index = 0;
  depth = 0;
  constructor(text: string) {
    if (text.length > 1200) throw new Error("Expression is too long.");
    this.tokens =
      text.match(
        /(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?|[A-Za-z_][A-Za-z_0-9]*|[()+\-*/^]|\S/g,
      ) || [];
    if (this.tokens.length > 240) throw new Error("Expression is too complex.");
  }
  parse(): Ast {
    const value = this.sum();
    if (this.index !== this.tokens.length)
      throw new Error("Use only supported mathematical notation.");
    return value;
  }
  sum(): Ast {
    let value = this.product();
    while (["+", "-"].includes(this.tokens[this.index])) {
      const op = this.tokens[this.index++];
      value = { kind: "binary", op, left: value, right: this.product() };
    }
    return value;
  }
  product(): Ast {
    let value = this.unary();
    while (true) {
      const token = this.tokens[this.index];
      if (token === "*" || token === "/") {
        this.index++;
        value = { kind: "binary", op: token, left: value, right: this.unary() };
      } else if (token && (token === "(" || /^[A-Za-z_\d.]/.test(token)))
        value = { kind: "binary", op: "*", left: value, right: this.unary() };
      else break;
    }
    return value;
  }
  unary(): Ast {
    if (["+", "-"].includes(this.tokens[this.index]))
      return {
        kind: "unary",
        op: this.tokens[this.index++],
        value: this.unary(),
      };
    return this.power();
  }
  power(): Ast {
    const left = this.atom();
    if (this.tokens[this.index] === "^") {
      this.index++;
      return { kind: "binary", op: "^", left, right: this.unary() };
    }
    return left;
  }
  atom(): Ast {
    if (++this.depth > 40) throw new Error("Expression nesting is too deep.");
    const token = this.tokens[this.index++];
    let value: Ast;
    if (token === "(") {
      value = this.sum();
      if (this.tokens[this.index++] !== ")")
        throw new Error("Unbalanced parentheses.");
    } else if (token && /^(?:\d|\.\d)/.test(token))
      value = { kind: "number", value: token };
    else if (token && /^[A-Za-z_]\w*$/.test(token)) {
      if (
        ["sin", "cos", "tan", "sqrt", "abs", "exp", "log", "ln"].includes(
          token,
        ) &&
        this.tokens[this.index] === "("
      ) {
        this.index++;
        const argument = this.sum();
        if (this.tokens[this.index++] !== ")")
          throw new Error("Unbalanced function parentheses.");
        value = { kind: "call", name: token, value: argument };
      } else value = { kind: "symbol", name: token };
    } else throw new Error("Enter a mathematical expression.");
    this.depth--;
    return value;
  }
}
function numerical(ast: Ast): number {
  if (ast.kind === "number") return Number(ast.value);
  if (ast.kind === "symbol") {
    if (ast.name === "pi") return Math.PI;
    if (ast.name === "e") return Math.E;
    throw new Error("Only pi and e are supported as numeric constants.");
  }
  if (ast.kind === "unary")
    return (ast.op === "-" ? -1 : 1) * numerical(ast.value);
  if (ast.kind === "call") {
    const functions: Record<string, (value: number) => number> = {
      sin: Math.sin,
      cos: Math.cos,
      tan: Math.tan,
      sqrt: Math.sqrt,
      abs: Math.abs,
      exp: Math.exp,
      log: Math.log,
      ln: Math.log,
    };
    return functions[ast.name](numerical(ast.value));
  }
  const a = numerical(ast.left),
    b = numerical(ast.right);
  if (ast.op === "+") return a + b;
  if (ast.op === "-") return a - b;
  if (ast.op === "*") return a * b;
  if (ast.op === "/") return a / b;
  if (Math.abs(b) > 1000)
    throw new Error("Exponent exceeds the numeric limit.");
  return a ** b;
}
type Fraction = { n: bigint; d: bigint };
const abs = (n: bigint) => (n < 0n ? -n : n);
function fraction(n: bigint, d = 1n): Fraction {
  if (d === 0n) throw new Error("Division by zero.");
  let a = abs(n),
    b = abs(d);
  while (b) {
    const next = a % b;
    a = b;
    b = next;
  }
  const divisor = a || 1n;
  return { n: (d < 0n ? -n : n) / divisor, d: abs(d) / divisor };
}
function rational(text: string): Fraction {
  const [mantissa, exp = "0"] = text.toLowerCase().split("e");
  const [whole, decimal = ""] = mantissa.split(".");
  const exponent = Number(exp) - decimal.length;
  if (Math.abs(exponent) > 18 || `${whole}${decimal}`.length > 24)
    throw new Error("Symbolic constants exceed exact arithmetic limits.");
  const n = BigInt((whole || "0") + decimal);
  return exponent >= 0
    ? fraction(n * 10n ** BigInt(exponent))
    : fraction(n, 10n ** BigInt(-exponent));
}
type Polynomial = Map<string, Fraction>;
function add(a: Polynomial, b: Polynomial, sign = 1n): Polynomial {
  const out = new Map(a);
  for (const [key, value] of b) {
    const previous = out.get(key) || fraction(0n);
    const next = fraction(
      previous.n * value.d + sign * value.n * previous.d,
      previous.d * value.d,
    );
    if (next.n) out.set(key, next);
    else out.delete(key);
  }
  return out;
}
function multiply(a: Polynomial, b: Polynomial): Polynomial {
  const out: Polynomial = new Map();
  for (const [ak, av] of a)
    for (const [bk, bv] of b) {
      const powers: Record<string, number> = {};
      for (const segment of [ak, bk]
        .filter(Boolean)
        .join("|")
        .split("|")
        .filter(Boolean)) {
        const [name, power] = segment.split(":");
        powers[name] = (powers[name] || 0) + Number(power);
        if (powers[name] > 24)
          throw new Error("Polynomial degree exceeds the limit.");
      }
      const key = Object.keys(powers)
        .sort()
        .map((name) => `${name}:${powers[name]}`)
        .join("|");
      const prev = out.get(key) || fraction(0n);
      const next = fraction(
        prev.n * av.d * bv.d + av.n * bv.n * prev.d,
        prev.d * av.d * bv.d,
      );
      if (next.n) out.set(key, next);
      else out.delete(key);
      if (out.size > 500) throw new Error("Polynomial expansion is too large.");
    }
  return out;
}
function polynomial(ast: Ast, variables: Set<string>): Polynomial {
  if (ast.kind === "number") {
    const value = rational(ast.value);
    return value.n ? new Map([["", value]]) : new Map();
  }
  if (ast.kind === "symbol") {
    if (!variables.has(ast.name))
      throw new Error(`Unknown symbolic variable ${ast.name}.`);
    return new Map([[`${ast.name}:1`, fraction(1n)]]);
  }
  if (ast.kind === "call")
    throw new Error(
      "Use the explicit rubric for non-polynomial symbolic answers.",
    );
  if (ast.kind === "unary")
    return ast.op === "-"
      ? multiply(
          new Map([["", fraction(-1n)]]),
          polynomial(ast.value, variables),
        )
      : polynomial(ast.value, variables);
  const a = polynomial(ast.left, variables);
  if (ast.op === "^") {
    const exponent = numerical(ast.right);
    if (!Number.isInteger(exponent) || exponent < 0 || exponent > 12)
      throw new Error("Polynomial exponents must be integers from 0 to 12.");
    let result: Polynomial = new Map([["", fraction(1n)]]);
    for (let i = 0; i < exponent; i++) result = multiply(result, a);
    return result;
  }
  const b = polynomial(ast.right, variables);
  if (ast.op === "+") return add(a, b);
  if (ast.op === "-") return add(a, b, -1n);
  if (ast.op === "*") return multiply(a, b);
  if (b.size !== 1 || !b.has("") || b.get("")!.n === 0n)
    throw new Error(
      "Symbolic division requires a nonzero constant denominator.",
    );
  const denominator = b.get("")!;
  return multiply(a, new Map([["", fraction(denominator.d, denominator.n)]]));
}
export type GradeResult = {
  correct: boolean | null;
  feedback: string;
  method: GradingSpec["kind"];
  suggestedQuality: number;
};
export function gradeAnswer(
  spec: GradingSpec,
  answer: string,
  rubricChecks: Record<string, boolean> = {},
): GradeResult {
  const result = (correct: boolean | null, feedback: string): GradeResult => ({
    correct,
    feedback,
    method: spec.kind,
    suggestedQuality: correct === null ? 3 : correct ? 4 : 2,
  });
  if (!gradingSchema.safeParse(spec).success)
    return result(
      null,
      "The grading specification is malformed. No correctness or mastery was inferred.",
    );
  if (!answer.trim())
    return result(
      null,
      "Write an answer before grading. Skipping never changes understanding.",
    );
  try {
    if (spec.kind === "exact") {
      const normalize = (text: string) =>
        spec.caseSensitive ? text.trim() : text.trim().toLocaleLowerCase();
      const correct = spec.accepted.some(
        (expected) => normalize(expected) === normalize(answer),
      );
      return result(
        correct,
        correct
          ? "Matches an explicitly accepted answer."
          : "Does not match an explicitly accepted answer. Review spelling, or use a rubric when equivalent wording is appropriate.",
      );
    }
    if (spec.kind === "numeric") {
      const expression =
        spec.unit && answer.trim().endsWith(spec.unit)
          ? answer.trim().slice(0, -spec.unit.length).trim()
          : answer.trim();
      const actual = numerical(new Parser(expression).parse());
      if (!Number.isFinite(actual) || !Number.isFinite(spec.expected))
        return result(
          null,
          "The expression is not a finite real number. Review the domain or use a rubric.",
        );
      const tolerance = Math.max(0, spec.tolerance),
        roundoff =
          Number.EPSILON *
          Math.max(1, Math.abs(actual), Math.abs(spec.expected)) *
          8;
      const correct =
        Math.abs(actual - spec.expected) <= Math.max(tolerance, roundoff);
      return result(
        correct,
        `${correct ? "Within" : "Outside"} absolute tolerance ${tolerance}${tolerance < roundoff ? " with a floating-point roundoff floor of " + roundoff : ""}. Calculated ${actual}${spec.unit ? " " + spec.unit : ""}; reference ${spec.expected}${spec.unit ? " " + spec.unit : ""}.`,
      );
    }
    if (spec.kind === "symbolic") {
      const variables = new Set(spec.variables);
      if (
        variables.size > 8 ||
        [...variables].some((v) => !/^\w{1,25}$/.test(v))
      )
        return result(null, "The symbolic variable list is invalid.");
      const difference = add(
        polynomial(new Parser(answer).parse(), variables),
        polynomial(new Parser(spec.expected).parse(), variables),
        -1n,
      );
      const correct = difference.size === 0;
      return result(
        correct,
        correct
          ? "Exactly equivalent as polynomials using rational arithmetic."
          : "These polynomials have different exact coefficients. No random sampling was used.",
      );
    }
    if (spec.criteria.some((c) => !(c.id in rubricChecks)))
      return result(
        null,
        "Check each rubric criterion explicitly after comparing your response with the reference. AI or missing assessments remain suggestions.",
      );
    const missing = spec.criteria.filter(
      (c) => c.required && !rubricChecks[c.id],
    );
    return result(
      !missing.length,
      `${missing.length ? "Required criteria to revisit: " + missing.map((c) => c.description).join("; ") : "All required criteria were checked."} This is your explicit rubric assessment, not an independent model verdict.`,
    );
  } catch (error) {
    return result(
      null,
      `${error instanceof Error ? error.message : "This answer could not be graded."} No correctness or mastery was inferred.`,
    );
  }
}
const suggestion = z.object({
  conceptLabel: z.string().trim().min(1).max(200),
  proposedStatus: z.enum([
    "encountered",
    "unassessed",
    "partial",
    "demonstrated",
    "misconception",
    "review",
    "unresolved",
  ]),
  evidence: z.string().trim().min(1).max(4000),
  reason: z.string().trim().min(1).max(2000),
});
export function parseLearningSuggestions(
  raw: string,
  lessonId: string,
): KnowledgeSuggestion[] {
  try {
    const clean = raw
      .trim()
      .replace(/^```(?:json)?\s*/, "")
      .replace(/\s*```$/, "");
    const candidate = JSON.parse(clean) as { knowledgeSuggestions?: unknown[] };
    if (!Array.isArray(candidate.knowledgeSuggestions)) return [];
    return candidate.knowledgeSuggestions.slice(0, 20).flatMap((item) => {
      const parsed = suggestion.safeParse(item);
      return parsed.success
        ? [
            {
              ...parsed.data,
              id: crypto.randomUUID(),
              lessonId,
              state: "pending" as const,
              createdAt: new Date().toISOString(),
            },
          ]
        : [];
    });
  } catch {
    return [];
  }
}
export function suggestionEvidenceMatches(
  entry: Pick<KnowledgeSuggestion, "evidence">,
  learnerResponses: string[],
): boolean {
  const normalize = (text: string) => text.trim().replace(/\s+/g, " ");
  const quote = normalize(entry.evidence).replace(/^["“]|["”]$/g, "");
  return (
    quote.length >= 8 &&
    learnerResponses.some((response) => normalize(response).includes(quote))
  );
}
export function confirmKnowledgeSuggestion(
  concepts: Concept[],
  entry: KnowledgeSuggestion,
): Concept[] {
  if (entry.state !== "pending")
    throw new Error("This suggestion has already been reviewed.");
  if (!entry.evidence.trim())
    throw new Error("Knowledge changes need explicit evidence.");
  const existing = concepts.find(
    (c) =>
      c.label.trim().toLowerCase() === entry.conceptLabel.trim().toLowerCase(),
  );
  const retainedEvidence =
    existing?.evidence.trim() && !existing.evidence.includes(entry.evidence)
      ? existing.evidence + "\n\nConfirmed evidence:\n" + entry.evidence
      : entry.evidence;
  const record: Concept = {
    ...(existing || { id: crypto.randomUUID() }),
    label: entry.conceptLabel,
    status: entry.proposedStatus,
    evidence: retainedEvidence,
    lessonId: entry.lessonId || existing?.lessonId,
  };
  return existing
    ? concepts.map((c) => (c.id === record.id ? record : c))
    : [...concepts, record];
}
