import { useEffect, useRef, useState } from "react";
import { BookOpen, Check, Copy, Highlighter, Sparkles, X } from "lucide-react";
import Markdown from "../Markdown";
import VisualBlock from "../visuals/VisualBlock";
import { VisualInstanceView } from "./VisualWorkspace";
import { validateContentBlock } from "../../lib/visualSpecs";
import type { ContentBlock } from "../../types";
import type { HighlightColor, HighlightDraft } from "../../annotationTypes";
import { getSelectedHighlightDraft, highlightColors } from "../v21/Annotations";
import { LessonTermsProvider } from "../visuals/LessonTerms";
import "./v2-reading.css";
export type ContextPayload = {
  text: string;
  lessonId: string;
  kind: "selection" | "equation";
  messageId?: string;
};
export type ContextToolsProps = {
  lessonId: string;
  subjectId?: string;
  onAction: (
    action: string,
    payload: ContextPayload,
  ) => Promise<
    | string
    | { text: string; blocks?: ContentBlock[]; content?: ContentBlock[] }
    | void
  >;
  onSaveNote?: (text: string) => void;
  onSavePractice?: (text: string) => void;
  onSaveFlashcard?: (question: string, answer: string) => Promise<void> | void;
};
const actions = [
  ["explain", "Ask tutor"],
  ["simpler", "Simpler"],
  ["derive", "Derive"],
  ["example", "Example"],
  ["visualize", "Visualize"],
  ["verify", "Verify"],
  ["note", "Save to subject"],
  ["practice", "Practice"],
] as const;
export default function ContextTools({
  lessonId,
  subjectId,
  onAction,
  onSaveNote,
  onSavePractice,
  onSaveFlashcard,
}: ContextToolsProps) {
  const sequence = useRef(0);
  const highlightDraft = useRef<HighlightDraft | null>(null);
  const [highlightNote, setHighlightNote] = useState("");
  const [addingHighlightNote, setAddingHighlightNote] = useState(false);
  const [makingFlashcard, setMakingFlashcard] = useState(false),
    [flashcardQuestion, setFlashcardQuestion] = useState("");
  const [selection, setSelection] = useState<ContextPayload | null>(null),
    [result, setResult] = useState<{
      id: string;
      text: string;
      blocks: ContentBlock[];
    } | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [open, setOpen] = useState(false),
    [copied, setCopied] = useState(false);
  useEffect(() => {
    const mouseup = (event: MouseEvent) => {
      // Native text selection can remain active while a learner uses its
      // toolbar. Those clicks edit the captured draft; they are not a new
      // selection and must not reset its chosen color or annotation.
      if (
        event.target instanceof Element &&
        event.target.closest(
          ".v2-selection-tools,.annotation-note-entry,.annotation-flashcard-entry,.v2-context-panel,.term-popover,.science-popover,input,textarea,select,button:not(.lesson-term)",
        )
      )
        return;
      const selected = window.getSelection();
      if (!selected || selected.isCollapsed) return;
      const element = selected.anchorNode?.parentElement;
      if (
        !element?.closest(
          ".lesson-reader,.v2-chapter-preview,.document-page-text",
        ) ||
        element.closest(".v2-context-panel")
      )
        return;
      const text = selected.toString().trim();
      if (text.length > 1 && text.length <= 20000) {
        const nextDraft = subjectId
          ? getSelectedHighlightDraft(subjectId, "yellow")
          : null;
        const priorDraft = highlightDraft.current;
        if (
          priorDraft &&
          nextDraft &&
          priorDraft.sourceKind === nextDraft.sourceKind &&
          priorDraft.sourceId === nextDraft.sourceId &&
          priorDraft.page === nextDraft.page &&
          priorDraft.quote === nextDraft.quote &&
          priorDraft.start === nextDraft.start &&
          priorDraft.end === nextDraft.end &&
          priorDraft.prefix === nextDraft.prefix &&
          priorDraft.suffix === nextDraft.suffix
        )
          return;
        highlightDraft.current = nextDraft;
        setAddingHighlightNote(false);
        setMakingFlashcard(false);
        setCopied(false);
        setSelection({
          text,
          lessonId,
          kind: "selection",
          messageId:
            element.closest<HTMLElement>("[data-message-id]")?.dataset
              .messageId,
        });
        setResult(null);
        setError("");
      }
    };
    const click = (event: MouseEvent) => {
      const target = event.target as Element;
      const math = target.closest(
        ".lesson-reader .katex,.v2-chapter-preview .katex",
      );
      if (!math) return;
      const latex = math.querySelector("annotation")?.textContent;
      if (!latex) return;
      setSelection({
        text: latex,
        lessonId,
        kind: "equation",
        messageId:
          math.closest<HTMLElement>("[data-message-id]")?.dataset.messageId,
      });
      setResult(null);
      setError("");
      setOpen(true);
    };
    document.addEventListener("mouseup", mouseup);
    document.addEventListener("click", click);
    return () => {
      document.removeEventListener("mouseup", mouseup);
      document.removeEventListener("click", click);
    };
  }, [lessonId, subjectId]);
  useEffect(() => {
    sequence.current++;
    setSelection(null);
    setResult(null);
    setOpen(false);
    setBusy(false);
    setAddingHighlightNote(false);
    setMakingFlashcard(false);
    highlightDraft.current = null;
  }, [lessonId]);
  useEffect(() => {
    sequence.current++;
    setBusy(false);
    setCopied(false);
  }, [selection]);
  const run = async (action: string) => {
    if (!selection) return;
    if (action === "note" && onSaveNote) {
      onSaveNote(
        selection.kind === "equation"
          ? "Equation: " + selection.text
          : selection.text,
      );
      setCopied(true);
      return;
    }
    if (action === "practice" && onSavePractice) {
      onSavePractice(selection.text);
      setOpen(true);
      return;
    }
    setOpen(true);
    setBusy(true);
    setError("");
    const request = ++sequence.current;
    try {
      const value = await onAction(action, selection);
      if (value && request === sequence.current) {
        const response =
          typeof value === "string"
            ? { text: value, blocks: [], content: undefined }
            : value;
        setResult({
          id: crypto.randomUUID(),
          text: response.content?.length ? "" : response.text,
          blocks: (response.content || response.blocks || [])
            .map(validateContentBlock)
            .filter((block): block is ContentBlock => block !== null),
        });
      }
    } catch (e) {
      if (request === sequence.current)
        setError(
          e instanceof Error
            ? e.message
            : "The contextual request failed. Your lesson position is unchanged.",
        );
    } finally {
      if (request === sequence.current) setBusy(false);
    }
  };
  if (!selection) return null;
  const saveHighlight = (color: HighlightColor, note = "") => {
    if (!highlightDraft.current) return;
    document.dispatchEvent(
      new CustomEvent("studio:highlight-create", {
        detail: { ...highlightDraft.current, color, note },
      }),
    );
    highlightDraft.current = { ...highlightDraft.current, color };
    setAddingHighlightNote(false);
    setCopied(true);
  };
  return (
    <>
      <div
        className="v2-selection-tools"
        role="toolbar"
        aria-label="Selected text learning actions"
      >
        <span>
          {selection.kind === "equation" ? "Equation" : "Selected passage"}
        </span>
        {highlightDraft.current && (
          <>
            <Highlighter size={15} aria-label="Highlight selected passage" />
            {highlightColors.map((color) => (
              <button
                key={color}
                className={"annotation-swatch color-" + color}
                aria-label={"Highlight " + color}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => saveHighlight(color)}
              />
            ))}
            <button
              onClick={() => {
                setHighlightNote("");
                setAddingHighlightNote(true);
                setMakingFlashcard(false);
              }}
            >
              Add annotation
            </button>
          </>
        )}
        {actions.map(([id, label]) => (
          <button disabled={busy} key={id} onClick={() => void run(id)}>
            {label}
          </button>
        ))}
        {onSaveFlashcard && (
          <button
            disabled={busy}
            onClick={() => {
              setMakingFlashcard(true);
              setAddingHighlightNote(false);
              setFlashcardQuestion(
                "Explain the meaning of this passage in your own words.",
              );
            }}
          >
            Make flashcard
          </button>
        )}
        <button
          aria-label="Close selection tools"
          onClick={() => {
            setSelection(null);
            setOpen(false);
          }}
        >
          <X size={14} />
        </button>
      </div>
      {addingHighlightNote && (
        <section
          className="annotation-note-entry"
          aria-label="Annotate selected passage"
        >
          <strong>Add a note to this highlight</strong>
          <textarea
            aria-label="New highlight note"
            rows={4}
            value={highlightNote}
            onChange={(e) => setHighlightNote(e.target.value)}
            placeholder="Your interpretation, question, or reminder"
          />
          <div>
            <button
              onClick={() =>
                saveHighlight(
                  highlightDraft.current?.color || "yellow",
                  highlightNote,
                )
              }
            >
              Save highlight & note
            </button>
            <button onClick={() => setAddingHighlightNote(false)}>
              Cancel
            </button>
          </div>
        </section>
      )}
      {makingFlashcard && (
        <section
          className="annotation-note-entry"
          aria-label="Make a review flashcard"
        >
          <strong>Create a source-grounded review card</strong>
          <label>
            Flashcard question
            <input
              aria-label="Flashcard question"
              value={flashcardQuestion}
              onChange={(e) => setFlashcardQuestion(e.target.value)}
            />
          </label>
          <label>
            Source passage answer
            <textarea
              aria-label="Source passage answer"
              rows={4}
              value={selection.text}
              readOnly
            />
          </label>
          <p>
            You review this card against the source passage. Saving it does not
            demonstrate understanding.
          </p>
          {error && <p role="alert">{error}</p>}
          <div>
            <button
              disabled={busy || !flashcardQuestion.trim()}
              onClick={async () => {
                setBusy(true);
                try {
                  await onSaveFlashcard?.(
                    flashcardQuestion.trim(),
                    selection.text,
                  );
                  setMakingFlashcard(false);
                  setCopied(true);
                } catch (e) {
                  setError(
                    e instanceof Error
                      ? e.message
                      : "This review card could not be saved.",
                  );
                } finally {
                  setBusy(false);
                }
              }}
            >
              Save review flashcard
            </button>
            <button onClick={() => setMakingFlashcard(false)}>Cancel</button>
          </div>
        </section>
      )}
      {open && (
        <aside
          className="v2-context-panel"
          aria-label={
            selection.kind === "equation"
              ? "Equation explorer"
              : "Contextual explanation"
          }
        >
          <header>
            <div>
              <span className="v2-eyebrow">
                A TANGENT, WITH YOUR PLACE KEPT
              </span>
              <h2>
                {selection.kind === "equation"
                  ? "Equation explorer"
                  : "Explore this passage"}
              </h2>
            </div>
            <button
              aria-label="Close contextual explanation"
              onClick={() => setOpen(false)}
            >
              <X size={18} />
            </button>
          </header>
          <section className="v2-context-source">
            {selection.kind === "equation" ? (
              <Markdown text={"$$" + selection.text + "$$"} />
            ) : (
              <blockquote>{selection.text}</blockquote>
            )}
            <button
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(selection.text);
                  setCopied(true);
                } catch {
                  setError(
                    "Clipboard access failed. The source passage remains selected and can be copied manually.",
                  );
                }
              }}
            >
              <Copy size={13} />
              {copied ? "Copied / saved" : "Copy source"}
            </button>
          </section>
          {selection.kind === "equation" && (
            <>
              <p className="v2-context-uncertainty">
                Symbols and units depend on the surrounding subject. The
                explorer asks for definitions, assumptions, valid domains, and
                uncertainty; it does not infer units from a symbol alone.
              </p>
              <div className="v2-equation-actions">
                {[
                  ["equation-definitions", "Variables & definitions"],
                  ["equation-units", "Units & dimensions"],
                  ["equation-assumptions", "Assumptions & domain"],
                  ["equation-derive", "Step-by-step derivation"],
                  ["equation-limits", "Limiting cases"],
                  ["equation-relations", "Related equations"],
                ].map(([id, label]) => (
                  <button key={id} disabled={busy} onClick={() => void run(id)}>
                    {label}
                  </button>
                ))}
              </div>
            </>
          )}
          {busy && (
            <p role="status">
              <Sparkles size={14} />
              Preparing a contextual explanation…
            </p>
          )}
          {error && (
            <p role="alert" className="notice error">
              {error}
            </p>
          )}
          {result ? (
            <section className="reading">
              <LessonTermsProvider content={result.blocks}>
                <Markdown text={result.text} />
                {result.blocks.map((block, index) =>
                  [
                    "text",
                    "equation",
                    "exercise",
                    "mcq",
                    "terms",
                    "concept",
                  ].includes(block.type) ? (
                    <VisualBlock key={result.id + ":" + index} block={block} />
                  ) : (
                    <VisualInstanceView
                      key={result.id + ":" + index}
                      id={"context:" + lessonId + ":" + result.id + ":" + index}
                      block={block}
                      originMessageId={selection.messageId}
                    />
                  ),
                )}
                {onSaveNote && (
                  <button
                    onClick={() =>
                      onSaveNote(selection.text + "\n\n" + result.text)
                    }
                  >
                    <Check size={14} />
                    Save this explanation to notes
                  </button>
                )}
              </LessonTermsProvider>
            </section>
          ) : (
            !busy && (
              <div className="v2-context-empty">
                <BookOpen size={26} />
                <p>
                  Choose an action. This temporary explanation does not advance
                  the lesson or silently change understanding.
                </p>
              </div>
            )
          )}
        </aside>
      )}
    </>
  );
}
