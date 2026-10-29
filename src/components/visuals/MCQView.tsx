import { useEffect, useId, useState } from "react";
import type { MCQBlock } from "../../types";
import {
  gradeMCQ,
  readMCQResponse,
  type MCQResponse,
} from "../../lib/teachingController";
import StudioMarkdown from "../Markdown";
import "./mcq.css";

export type CheckpointSubmission = {
  selectedIds: string[];
  skipped: boolean;
  unknown: boolean;
};
export type CheckpointResult = {
  correct: boolean;
  feedback?: string;
  attempts?: number;
};
export type MCQSubmit = (
  submission: CheckpointSubmission,
) => Promise<CheckpointResult>;

export default function MCQView({
  block,
  state,
  onChange,
  onSubmit,
}: {
  block: MCQBlock;
  state?: { answer: string; skipped: boolean };
  onChange?: (value: { answer: string; skipped: boolean }) => void;
  onSubmit?: MCQSubmit;
}) {
  const [savedResponse, setResponse] = useState<MCQResponse>(() =>
    readMCQResponse(state?.answer, block),
  );
  // A chapter edit can change choice IDs before effects run. Normalize at read
  // time too, so stale selections cannot throw during that first render.
  const response = readMCQResponse(JSON.stringify(savedResponse), block);
  const choiceSignature = JSON.stringify([
    Boolean(block.multiple),
    block.choices.map((choice) => choice.id),
  ]);
  const [skipped, setSkipped] = useState(state?.skipped ?? false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [serverFeedback, setServerFeedback] = useState("");
  const id = useId();
  useEffect(() => {
    setResponse(readMCQResponse(state?.answer, block));
    setSkipped(state?.skipped ?? false);
  }, [state?.answer, state?.skipped, choiceSignature]);
  const update = (value: MCQResponse, skip = skipped) => {
    setResponse(value);
    setSkipped(skip);
    onChange?.({ answer: JSON.stringify(value), skipped: skip });
  };
  const grade = response.submitted
    ? gradeMCQ(block, response.selected, response.unknown)
    : null;
  const select = (choice: string) => {
    if (response.submitted || skipped) return;
    setError("");
    const selected = block.multiple
      ? response.selected.includes(choice)
        ? response.selected.filter((c) => c !== choice)
        : [...response.selected, choice]
      : [choice];
    update({ ...response, selected, unknown: false, recovered: false });
  };
  async function submit(unknown = false) {
    if (busy || (!unknown && !response.selected.length)) return;
    setBusy(true);
    setError("");
    try {
      const canonical: CheckpointResult = onSubmit
        ? await onSubmit({
            selectedIds: unknown ? [] : response.selected,
            skipped: false,
            unknown,
          })
        : gradeMCQ(block, unknown ? [] : response.selected, unknown);
      const next = {
        ...response,
        selected: unknown ? [] : response.selected,
        submitted: true,
        unknown,
        attempts: canonical.attempts ?? response.attempts + 1,
        recovered: false,
      };
      setServerFeedback(canonical.feedback || "");
      update(next, false);
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "The checkpoint could not be saved. Your lesson is still available. Try again.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function skip() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      if (onSubmit)
        await onSubmit({
          selectedIds: response.selected,
          skipped: true,
          unknown: false,
        });
      update({ ...response, submitted: false }, true);
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "The skip could not be saved. You can still continue the lesson.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section
      className="mcq-checkpoint"
      aria-label="Optional multiple-choice checkpoint"
    >
      <header>
        <span className="visual-tag">Optional checkpoint</span>
        <span>
          {block.multiple ? "Choose all that apply" : "Choose one answer"}
          {skipped ? " · skipped" : ""}
        </span>
      </header>
      <div className="mcq-question">
        <StudioMarkdown text={block.question} />
      </div>
      {response.recovered && (
        <p role="status" className="mcq-saved-selection-recovery">
          A saved selection no longer matches this question. You can answer it
          again. Earlier review history is preserved.
        </p>
      )}
      <fieldset disabled={response.submitted || skipped || busy}>
        <legend className="sr-only">
          {block.multiple ? "Select all correct choices" : "Select one choice"}
        </legend>
        {block.choices.map((choice, i) => {
          const correct =
            response.submitted && block.correctChoiceIds.includes(choice.id);
          const incorrect =
            response.submitted &&
            response.selected.includes(choice.id) &&
            !correct;
          return (
            <label
              key={choice.id}
              className={`mcq-choice ${correct ? "mcq-correct" : ""} ${incorrect ? "mcq-incorrect" : ""}`}
            >
              <input
                type={block.multiple ? "checkbox" : "radio"}
                name={`mcq-${id}`}
                checked={response.selected.includes(choice.id)}
                onChange={() => select(choice.id)}
                value={choice.id}
              />
              <span className="mcq-choice-letter">
                {String.fromCharCode(65 + i)}
              </span>
              <span>
                <StudioMarkdown text={choice.text} />
              </span>
              {response.submitted && choice.explanation && (
                <span className="mcq-choice-feedback">
                  <strong>
                    {correct
                      ? "Correct choice. "
                      : incorrect
                        ? "Revisit this choice. "
                        : ""}
                  </strong>
                  {choice.explanation}
                </span>
              )}
            </label>
          );
        })}
      </fieldset>
      {grade && (
        <div
          className={`mcq-feedback ${grade.correct ? "is-correct" : "needs-review"}`}
          role="status"
        >
          <strong>{serverFeedback || grade.feedback}</strong>
          {block.explanation && <StudioMarkdown text={block.explanation} />}
          <p>
            This result records evidence for this checkpoint. It does not mark a
            concept mastered.
          </p>
        </div>
      )}
      {error && (
        <p role="alert" className="mcq-error">
          {error}
        </p>
      )}
      <div className="mcq-actions">
        {!response.submitted && !skipped && (
          <>
            <button
              className="primary"
              disabled={busy || !response.selected.length}
              onClick={() => void submit()}
            >
              {busy ? "Saving…" : "Check answer"}
            </button>
            {block.allowUnknown !== false && (
              <button disabled={busy} onClick={() => void submit(true)}>
                I don't know yet
              </button>
            )}
            <button disabled={busy} onClick={() => void skip()}>
              Skip checkpoint
            </button>
          </>
        )}
        {(response.submitted || skipped) && (
          <button
            disabled={busy}
            onClick={() => {
              setServerFeedback("");
              update(
                { ...response, selected: [], submitted: false, unknown: false },
                false,
              );
            }}
          >
            Try again
          </button>
        )}
        <span>You can continue without answering.</span>
      </div>
    </section>
  );
}
