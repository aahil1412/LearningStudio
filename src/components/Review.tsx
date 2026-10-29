import { useMemo, useState } from "react";
import {
  BookOpenCheck,
  CalendarDays,
  Check,
  ChevronRight,
  Clock3,
  Layers,
  Plus,
  RotateCcw,
  Search,
  Trash2,
  X,
} from "lucide-react";
import type {
  GradingSpec,
  KnowledgeSuggestion,
  ReviewCard,
  StudioData,
} from "../types";
import {
  confirmKnowledgeSuggestion,
  gradeAnswer,
  gradingSchema,
  scheduleReview,
  type GradeResult,
} from "../lib/learning";
import Markdown from "./Markdown";
import "./Review.css";

type Props = {
  data: StudioData;
  onChange: (data: StudioData) => void;
  onPractice: (text: string) => void;
};
const date = (value: string) =>
  new Date(value).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
export default function Review({ data, onChange, onPractice }: Props) {
  const cards = data.reviewCards || [],
    history = data.reviewHistory || [],
    suggestions = data.knowledgeSuggestions || [];
  const collections = data.library.filter((item) => item.kind === "practice");
  const [tab, setTab] = useState<"due" | "cards" | "history" | "evidence">(
      "due",
    ),
    [collection, setCollection] = useState("all"),
    [search, setSearch] = useState("");
  const [activeId, setActiveId] = useState<string | null>(null),
    [answer, setAnswer] = useState(""),
    [showReference, setShowReference] = useState(false),
    [checks, setChecks] = useState<Record<string, boolean>>({}),
    [result, setResult] = useState<GradeResult | null>(null),
    [quality, setQuality] = useState(4);
  const [editing, setEditing] = useState<string | null>(null),
    [question, setQuestion] = useState(""),
    [reference, setReference] = useState(""),
    [method, setMethod] = useState<GradingSpec["kind"]>("rubric"),
    [expected, setExpected] = useState(""),
    [tolerance, setTolerance] = useState("0.001"),
    [unit, setUnit] = useState(""),
    [variables, setVariables] = useState("x"),
    [criteria, setCriteria] = useState(
      "Explain the main idea accurately\nSupport the explanation with reasoning",
    ),
    [cardCollection, setCardCollection] = useState(""),
    [lessonId, setLessonId] = useState(""),
    [conceptId, setConceptId] = useState(""),
    [error, setError] = useState(""),
    [collectionName, setCollectionName] = useState("");
  const [suggestionEdits, setSuggestionEdits] = useState<
    Record<
      string,
      { evidence: string; status: KnowledgeSuggestion["proposedStatus"] }
    >
  >({});
  const pending = suggestions.filter((s) => s.state === "pending");
  const visible = useMemo(
    () =>
      cards.filter(
        (card) =>
          (collection === "all" || card.collectionId === collection) &&
          `${card.question} ${card.answer}`
            .toLowerCase()
            .includes(search.toLowerCase()),
      ),
    [cards, collection, search],
  );
  const due = visible
    .filter((card) => Date.parse(card.dueAt) <= Date.now())
    .sort((a, b) => a.dueAt.localeCompare(b.dueAt));
  const active = cards.find((card) => card.id === activeId);
  const start = (card: ReviewCard) => {
    setActiveId(card.id);
    setAnswer("");
    setChecks({});
    setShowReference(false);
    setResult(null);
    setError("");
    setQuality(4);
  };
  const newCard = () => {
    setEditing("new");
    setActiveId(null);
    setQuestion("");
    setReference("");
    setMethod("rubric");
    setExpected("");
    setTolerance("0.001");
    setUnit("");
    setVariables("x");
    setCriteria(
      "Explain the main idea accurately\nSupport the explanation with reasoning",
    );
    setCardCollection(collection === "all" ? "" : collection);
    setLessonId("");
    setConceptId("");
    setError("");
  };
  const editCard = (card: ReviewCard) => {
    setEditing(card.id);
    setActiveId(null);
    setQuestion(card.question);
    setReference(card.answer);
    setMethod(card.grading.kind);
    setExpected(
      card.grading.kind === "numeric"
        ? String(card.grading.expected)
        : card.grading.kind === "symbolic"
          ? card.grading.expected
          : card.grading.kind === "exact"
            ? card.grading.accepted.join("\n")
            : "",
    );
    setTolerance(
      card.grading.kind === "numeric"
        ? String(card.grading.tolerance)
        : "0.001",
    );
    setUnit(card.grading.kind === "numeric" ? card.grading.unit || "" : "");
    setVariables(
      card.grading.kind === "symbolic"
        ? card.grading.variables.join(", ")
        : "x",
    );
    setCriteria(
      card.grading.kind === "rubric"
        ? card.grading.criteria
            .map((c) => (c.required ? "" : "? ") + c.description)
            .join("\n")
        : "",
    );
    setCardCollection(card.collectionId || "");
    setLessonId(card.lessonId || "");
    setConceptId(card.conceptId || "");
    setError("");
  };
  const saveCard = () => {
    if (!question.trim() || !reference.trim()) {
      setError("Add both a question and a reference answer.");
      return;
    }
    const grading: GradingSpec =
      method === "numeric"
        ? {
            kind: "numeric",
            expected: Number(expected),
            tolerance: Number(tolerance),
            ...(unit.trim() ? { unit: unit.trim() } : {}),
          }
        : method === "symbolic"
          ? {
              kind: "symbolic",
              expected: expected.trim(),
              variables: variables
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean),
            }
          : method === "exact"
            ? {
                kind: "exact",
                accepted: expected
                  .split("\n")
                  .map((s) => s.trim())
                  .filter(Boolean),
              }
            : {
                kind: "rubric",
                criteria: criteria
                  .split("\n")
                  .filter((s) => s.trim())
                  .map((s, i) => ({
                    id: "criterion-" + i,
                    description: s.trim().replace(/^\?\s*/, ""),
                    required: !s.trim().startsWith("?"),
                  })),
                referenceAnswer: reference.trim(),
              };
    const checked = gradingSchema.safeParse(grading);
    if (!checked.success) {
      setError("Review the grading fields: " + checked.error.issues[0].message);
      return;
    }
    if (method === "numeric" && (!expected.trim() || !tolerance.trim())) {
      setError("Enter a numeric reference value and an explicit tolerance.");
      return;
    }
    const previous = cards.find((c) => c.id === editing);
    const now = new Date().toISOString();
    const card: ReviewCard = {
      ...(previous || {
        id: crypto.randomUUID(),
        dueAt: now,
        intervalDays: 0,
        repetitions: 0,
        easeFactor: 2.5,
        lapses: 0,
        createdAt: now,
      }),
      question: question.trim(),
      answer: reference.trim(),
      grading: checked.data,
      collectionId: cardCollection || undefined,
      lessonId: lessonId || undefined,
      conceptId: conceptId || undefined,
    };
    onChange({
      ...data,
      reviewCards: previous
        ? cards.map((c) => (c.id === card.id ? card : c))
        : [...cards, card],
    });
    setEditing(null);
    setTab("cards");
    setError("");
  };
  const grade = () => {
    if (!active) return;
    const graded = gradeAnswer(active.grading, answer, checks);
    setResult(graded);
    setQuality(graded.suggestedQuality);
  };
  const complete = () => {
    if (!active || !result || !answer.trim()) return;
    const now = new Date();
    const next = scheduleReview(active, quality, now);
    const attempt = {
      id: crypto.randomUUID(),
      cardId: active.id,
      answer,
      grade: quality,
      correct: result.correct,
      feedback: result.feedback,
      method: result.method,
      createdAt: now.toISOString(),
      ...(active.grading.kind === "rubric" ? { rubricChecks: checks } : {}),
    };
    const concept = data.concepts.find((c) => c.id === active.conceptId);
    const proposed: KnowledgeSuggestion | undefined =
      concept && result.correct !== null
        ? {
            id: crypto.randomUUID(),
            lessonId: active.lessonId || concept.lessonId,
            conceptLabel: concept.label,
            proposedStatus: result.correct
              ? active.grading.kind === "rubric"
                ? "partial"
                : "demonstrated"
              : "review",
            evidence: `Question: ${active.question}\nLearner response: ${answer}\n${result.feedback}`,
            reason:
              active.grading.kind === "rubric"
                ? "A learner-checked rubric is a suggestion requiring confirmation."
                : "A deterministic answer check supports this suggestion. Confirm the evidence before changing knowledge.",
            state: "pending",
            createdAt: now.toISOString(),
          }
        : undefined;
    onChange({
      ...data,
      reviewCards: cards.map((c) => (c.id === active.id ? next : c)),
      reviewHistory: [...history, attempt].slice(-5000),
      knowledgeSuggestions: proposed
        ? [...suggestions, proposed].slice(-500)
        : suggestions,
    });
    setActiveId(null);
    setResult(null);
  };
  const skip = () => {
    if (!active) return;
    onChange({
      ...data,
      reviewCards: cards.map((c) =>
        c.id === active.id
          ? { ...c, dueAt: new Date(Date.now() + 86400000).toISOString() }
          : c,
      ),
      reviewHistory: [
        ...history,
        {
          id: crypto.randomUUID(),
          cardId: active.id,
          answer,
          grade: 0,
          correct: null,
          feedback:
            "Skipped explicitly and deferred for one day. Repetitions, ease, and mastery are unchanged.",
          method: active.grading.kind,
          createdAt: new Date().toISOString(),
        },
      ].slice(-5000),
    });
    setActiveId(null);
  };
  const createCollection = () => {
    if (!collectionName.trim()) return;
    const id = crypto.randomUUID();
    onChange({
      ...data,
      library: [
        ...data.library,
        {
          id,
          title: collectionName.trim(),
          kind: "practice",
          subject: "",
          content: "",
          createdAt: new Date().toISOString(),
        },
      ],
    });
    setCollection(id);
    setCollectionName("");
  };
  const decide = (entry: KnowledgeSuggestion, accept: boolean) => {
    try {
      const draft = suggestionEdits[entry.id];
      const adjusted = draft
        ? { ...entry, evidence: draft.evidence, proposedStatus: draft.status }
        : entry;
      onChange({
        ...data,
        concepts: accept
          ? confirmKnowledgeSuggestion(data.concepts, adjusted)
          : data.concepts,
        knowledgeSuggestions: suggestions.map((s) =>
          s.id === entry.id
            ? { ...adjusted, state: accept ? "accepted" : "dismissed" }
            : s,
        ),
      });
      setError("");
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "The suggestion could not be applied.",
      );
    }
  };
  return (
    <section className="review-workspace" aria-label="Practice and review">
      <header className="review-header">
        <div>
          <span className="review-eyebrow">MAKE KNOWLEDGE AVAILABLE</span>
          <h1>
            <BookOpenCheck size={26} />
            Practice & review
          </h1>
          <p>Recall an idea. Check your reasoning. Return when it matters.</p>
        </div>
        <button className="review-primary" onClick={newCard}>
          <Plus size={16} />
          Create practice card
        </button>
      </header>
      <div className="review-stats">
        <span>
          <strong>{due.length}</strong>due now
        </span>
        <span>
          <strong>{cards.length}</strong>practice cards
        </span>
        <span>
          <strong>{history.length}</strong>review attempts
        </span>
        <span>
          <strong>{pending.length}</strong>evidence suggestions
        </span>
      </div>
      <div className="review-controls">
        <nav>
          {(["due", "cards", "history", "evidence"] as const).map((id) => (
            <button
              key={id}
              className={tab === id ? "active" : ""}
              onClick={() => setTab(id)}
            >
              {
                {
                  due: "Due for review",
                  cards: "All cards",
                  history: "Review history",
                  evidence: "Confirm evidence",
                }[id]
              }
              {id === "evidence" && pending.length > 0 && (
                <small>{pending.length}</small>
              )}
            </button>
          ))}
        </nav>
        <label>
          <Search size={14} />
          <input
            aria-label="Search practice cards"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search questions…"
          />
        </label>
      </div>
      <div className="review-layout">
        <aside className="review-collections">
          <h3>
            <Layers size={14} />
            Collections
          </h3>
          <button
            className={collection === "all" ? "active" : ""}
            onClick={() => setCollection("all")}
          >
            All practice<span>{cards.length}</span>
          </button>
          {collections.map((item) => (
            <button
              key={item.id}
              className={collection === item.id ? "active" : ""}
              onClick={() => setCollection(item.id)}
            >
              {item.title}
              <span>
                {cards.filter((c) => c.collectionId === item.id).length}
              </span>
            </button>
          ))}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              createCollection();
            }}
          >
            <input
              aria-label="New practice collection"
              value={collectionName}
              maxLength={200}
              onChange={(e) => setCollectionName(e.target.value)}
              placeholder="New collection…"
            />
            <button
              aria-label="Create practice collection"
              disabled={!collectionName.trim()}
            >
              <Plus size={14} />
            </button>
          </form>
          <p>
            SM-2 spaces reviews using your recall rating. Knowledge changes
            always need confirmation.
          </p>
          <button
            onClick={() =>
              onPractice(
                "Create practice for " +
                  (collections.find((c) => c.id === collection)?.title ||
                    "the current learning objective") +
                  ". Provide optional exercises with explicit reference answers and a numeric, polynomial, exact-answer, or explicit rubric grading specification.",
              )
            }
          >
            Ask the tutor for practice
            <ChevronRight size={13} />
          </button>
        </aside>
        <div className="review-main">
          {error && (
            <p className="review-error" role="alert">
              {error}
            </p>
          )}
          {editing && (
            <section
              className="review-editor"
              aria-label="Practice card editor"
            >
              <header>
                <h2>
                  {editing === "new"
                    ? "New practice card"
                    : "Edit practice card"}
                </h2>
                <button
                  aria-label="Close practice editor"
                  onClick={() => setEditing(null)}
                >
                  <X size={17} />
                </button>
              </header>
              <label>
                Question
                <textarea
                  aria-label="Practice question"
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                  rows={3}
                />
              </label>
              <label>
                Reference answer
                <textarea
                  aria-label="Practice reference answer"
                  value={reference}
                  onChange={(e) => setReference(e.target.value)}
                  rows={3}
                />
              </label>
              <div className="review-two">
                <label>
                  Collection
                  <select
                    aria-label="Practice collection"
                    value={cardCollection}
                    onChange={(e) => setCardCollection(e.target.value)}
                  >
                    <option value="">Unfiled practice</option>
                    {collections.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.title}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Grading method
                  <select
                    aria-label="Grading method"
                    value={method}
                    onChange={(e) =>
                      setMethod(e.target.value as GradingSpec["kind"])
                    }
                  >
                    <option value="rubric">Explicit rubric</option>
                    <option value="numeric">Numeric calculation</option>
                    <option value="symbolic">
                      Exact polynomial equivalence
                    </option>
                    <option value="exact">Accepted answer list</option>
                  </select>
                </label>
              </div>
              {method === "numeric" && (
                <div className="review-two">
                  <label>
                    Expected value
                    <input
                      aria-label="Expected numeric value"
                      type="number"
                      value={expected}
                      onChange={(e) => setExpected(e.target.value)}
                    />
                  </label>
                  <label>
                    Absolute tolerance
                    <input
                      aria-label="Numeric tolerance"
                      type="number"
                      min="0"
                      step="any"
                      value={tolerance}
                      onChange={(e) => setTolerance(e.target.value)}
                    />
                  </label>
                  <label>
                    Unit
                    <input
                      aria-label="Answer unit"
                      value={unit}
                      onChange={(e) => setUnit(e.target.value)}
                      placeholder="Optional, e.g. m/s"
                    />
                  </label>
                </div>
              )}
              {method === "symbolic" && (
                <>
                  <label>
                    Expected expression
                    <input
                      aria-label="Expected symbolic expression"
                      value={expected}
                      onChange={(e) => setExpected(e.target.value)}
                      placeholder="e.g. x^2 + 2*x + 1"
                    />
                  </label>
                  <label>
                    Variables, separated by commas
                    <input
                      aria-label="Symbolic variables"
                      value={variables}
                      onChange={(e) => setVariables(e.target.value)}
                    />
                  </label>
                  <p>
                    Exact rational polynomial comparison supports +, −, ×,
                    constant division, parentheses, and nonnegative integer
                    powers. Other expressions return uncertain and can use a
                    rubric.
                  </p>
                </>
              )}
              {method === "exact" && (
                <label>
                  Accepted answers, one per line
                  <textarea
                    aria-label="Accepted practice answers"
                    value={expected}
                    onChange={(e) => setExpected(e.target.value)}
                    rows={3}
                  />
                </label>
              )}
              {method === "rubric" && (
                <label>
                  Criteria, one per line. Prefix optional criteria with ?
                  <textarea
                    aria-label="Practice rubric criteria"
                    value={criteria}
                    onChange={(e) => setCriteria(e.target.value)}
                    rows={4}
                  />
                </label>
              )}
              <div className="review-two">
                <label>
                  Source lesson
                  <select
                    aria-label="Practice source lesson"
                    value={lessonId}
                    onChange={(e) => setLessonId(e.target.value)}
                  >
                    <option value="">No source lesson</option>
                    {data.lessons.map((l) => (
                      <option value={l.id} key={l.id}>
                        {l.title}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Linked concept
                  <select
                    aria-label="Practice linked concept"
                    value={conceptId}
                    onChange={(e) => setConceptId(e.target.value)}
                  >
                    <option value="">No knowledge suggestion</option>
                    {data.concepts.map((c) => (
                      <option value={c.id} key={c.id}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <button className="review-primary" onClick={saveCard}>
                <Check size={14} />
                Save practice card
              </button>
            </section>
          )}
          {!editing && active && (
            <section className="review-session" aria-label="Active review">
              <header>
                <span className="review-eyebrow">
                  ACTIVE RECALL · {active.grading.kind.toUpperCase()}
                </span>
                <button
                  aria-label="Close active review"
                  onClick={() => setActiveId(null)}
                >
                  <X size={16} />
                </button>
              </header>
              <Markdown text={active.question} />
              <textarea
                aria-label="Review answer"
                value={answer}
                onChange={(e) => {
                  setAnswer(e.target.value);
                  setResult(null);
                }}
                rows={5}
                placeholder="Recall the idea before revealing the reference…"
              />
              <button onClick={() => setShowReference(!showReference)}>
                {showReference
                  ? "Hide reference answer"
                  : "Reveal reference answer"}
              </button>
              {showReference && (
                <div className="review-reference">
                  <Markdown text={active.answer} />
                </div>
              )}
              {active.grading.kind === "rubric" && (
                <div className="review-rubric">
                  <h3>Review your response against each criterion</h3>
                  {active.grading.criteria.map((c) => (
                    <label key={c.id}>
                      {c.description}
                      {c.required ? " · required" : " · optional"}
                      <select
                        aria-label={"Rubric: " + c.description}
                        value={
                          c.id in checks
                            ? checks[c.id]
                              ? "met"
                              : "not-met"
                            : ""
                        }
                        onChange={(e) => {
                          setChecks({
                            ...checks,
                            [c.id]: e.target.value === "met",
                          });
                          setResult(null);
                        }}
                      >
                        <option value="" disabled>
                          Not assessed
                        </option>
                        <option value="met">Met</option>
                        <option value="not-met">Not met</option>
                      </select>
                    </label>
                  ))}
                </div>
              )}
              <div className="review-actions">
                <button
                  className="review-primary"
                  onClick={grade}
                  disabled={!answer.trim()}
                >
                  Check against reference
                </button>
                <button onClick={skip}>Skip and revisit tomorrow</button>
              </div>
              {result && (
                <div
                  className={
                    "review-result " +
                    (result.correct === true
                      ? "is-correct"
                      : result.correct === false
                        ? "is-incorrect"
                        : "is-uncertain")
                  }
                  role="status"
                >
                  <strong>
                    {result.correct === true
                      ? "Reference check passed"
                      : result.correct === false
                        ? "Revisit this answer"
                        : "Assessment uncertain"}
                  </strong>
                  <p>{result.feedback}</p>
                  <label>
                    Your recall rating
                    <select
                      aria-label="Recall quality"
                      value={quality}
                      onChange={(e) => setQuality(Number(e.target.value))}
                    >
                      <option value={0}>0 · No recall</option>
                      <option value={1}>
                        1 · Remembered after seeing the answer
                      </option>
                      <option value={2}>2 · Incomplete recall</option>
                      <option value={3}>
                        3 · Correct with significant effort
                      </option>
                      <option value={4}>4 · Correct with some effort</option>
                      <option value={5}>5 · Immediate, confident recall</option>
                    </select>
                  </label>
                  <p>
                    Next review: {date(scheduleReview(active, quality).dueAt)}.
                    This rating schedules practice; it does not mark mastery.
                  </p>
                  <button className="review-primary" onClick={complete}>
                    Save review & schedule next
                  </button>
                </div>
              )}
            </section>
          )}
          {!editing && !active && (tab === "due" || tab === "cards") && (
            <>
              <div className="review-section-heading">
                <h2>
                  {tab === "due"
                    ? "A small return, a stronger connection"
                    : "Your practice cards"}
                </h2>
                <p>
                  {tab === "due"
                    ? "Try to recall before revealing. Every question is optional."
                    : "Reusable questions with explicit grading and a transparent schedule."}
                </p>
              </div>
              {(tab === "due" ? due : visible).length ? (
                <div className="review-card-list">
                  {(tab === "due" ? due : visible).map((card) => (
                    <article className="review-card" key={card.id}>
                      <div>
                        <Markdown text={card.question} />
                        <small>
                          <CalendarDays size={12} />
                          {Date.parse(card.dueAt) <= Date.now()
                            ? "Due now"
                            : date(card.dueAt)}{" "}
                          · {card.grading.kind} · interval {card.intervalDays}d
                          · ease {card.easeFactor.toFixed(2)}
                        </small>
                      </div>
                      <div className="review-actions">
                        <button
                          className="review-primary"
                          onClick={() => start(card)}
                        >
                          Review
                        </button>
                        <button onClick={() => editCard(card)}>Edit</button>
                        <button
                          aria-label={
                            "Remove practice " + card.question.slice(0, 70)
                          }
                          onClick={() =>
                            onChange({
                              ...data,
                              reviewCards: cards.filter(
                                (c) => c.id !== card.id,
                              ),
                            })
                          }
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              ) : (
                <div className="review-empty">
                  <BookOpenCheck size={39} />
                  <h2>
                    {cards.length
                      ? "You have room to let it settle"
                      : "Build a practice collection"}
                  </h2>
                  <p>
                    {cards.length
                      ? "Nothing is due in this collection. You can review any card early in All cards."
                      : "Create a question with a reference answer and an explicit grading method. Your first review starts when you are ready."}
                  </p>
                  <button onClick={newCard}>
                    <Plus size={15} />
                    Create practice card
                  </button>
                </div>
              )}
            </>
          )}
          {!editing && !active && tab === "history" && (
            <>
              <h2>Evidence from actual attempts</h2>
              <p>
                Uncertain checks and skipped cards are retained transparently.
              </p>
              <div className="review-history">
                {history
                  .slice(-200)
                  .reverse()
                  .map((attempt) => (
                    <article key={attempt.id}>
                      <header>
                        <Clock3 size={13} />
                        <span>
                          {date(attempt.createdAt)} · {attempt.method} · recall{" "}
                          {attempt.grade}/5
                        </span>
                        <strong>
                          {attempt.correct === null
                            ? "Uncertain / skipped"
                            : attempt.correct
                              ? "Reference passed"
                              : "Needs practice"}
                        </strong>
                      </header>
                      <h3>
                        {cards.find((c) => c.id === attempt.cardId)?.question ||
                          "Removed practice card"}
                      </h3>
                      <p className="review-answer-history">
                        {attempt.answer || "(No answer submitted)"}
                      </p>
                      <p>{attempt.feedback}</p>
                    </article>
                  ))}
              </div>
              {!history.length && <p>No review attempts yet.</p>}
            </>
          )}
          {!editing && !active && tab === "evidence" && (
            <>
              <h2>Your understanding, with your confirmation</h2>
              <p>
                Model interpretations and practice results are suggestions.
                Inspect the evidence, change the proposed state if needed, then
                explicitly accept or dismiss.
              </p>
              {pending.map((entry) => {
                const draft = suggestionEdits[entry.id] || {
                  evidence: entry.evidence,
                  status: entry.proposedStatus,
                };
                return (
                  <article className="review-suggestion" key={entry.id}>
                    <span className="review-eyebrow">
                      UNCONFIRMED SUGGESTION
                    </span>
                    <h3>{entry.conceptLabel}</h3>
                    <p>{entry.reason}</p>
                    <label>
                      Proposed knowledge state
                      <select
                        aria-label={"Proposed state for " + entry.conceptLabel}
                        value={draft.status}
                        onChange={(e) =>
                          setSuggestionEdits({
                            ...suggestionEdits,
                            [entry.id]: {
                              ...draft,
                              status: e.target
                                .value as KnowledgeSuggestion["proposedStatus"],
                            },
                          })
                        }
                      >
                        {[
                          "encountered",
                          "unassessed",
                          "partial",
                          "demonstrated",
                          "misconception",
                          "review",
                          "unresolved",
                        ].map((s) => (
                          <option value={s} key={s}>
                            {s}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Evidence to retain
                      <textarea
                        aria-label={"Evidence for " + entry.conceptLabel}
                        value={draft.evidence}
                        onChange={(e) =>
                          setSuggestionEdits({
                            ...suggestionEdits,
                            [entry.id]: { ...draft, evidence: e.target.value },
                          })
                        }
                        rows={4}
                      />
                    </label>
                    <div className="review-actions">
                      <button
                        className="review-primary"
                        onClick={() => decide(entry, true)}
                      >
                        <Check size={14} />
                        Confirm knowledge change
                      </button>
                      <button onClick={() => decide(entry, false)}>
                        Dismiss suggestion
                      </button>
                    </div>
                  </article>
                );
              })}
              {!pending.length && (
                <div className="review-empty">
                  <Check size={34} />
                  <h2>No unconfirmed suggestions</h2>
                  <p>
                    Lessons and review attempts can propose evidence. They never
                    silently change your knowledge records.
                  </p>
                </div>
              )}
            </>
          )}
        </div>
      </div>
      <footer className="review-footer">
        <RotateCcw size={12} />
        SM-2 scheduling · local history · explicit evidence · no automatic
        mastery
      </footer>
    </section>
  );
}
