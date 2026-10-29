import { useEffect, useRef, type ReactNode } from "react";
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  CheckSquare2,
  History,
  MessageCircle,
  ScanLine,
} from "lucide-react";
import type {
  LearningStage,
  LearningStageId,
  LearningUnit,
} from "../../lib/learningSequence";
import "./learning-player.css";

const stageIcons: Record<LearningStageId, typeof BookOpen> = {
  understand: BookOpen,
  explore: ScanLine,
  check: CheckSquare2,
};
export type LearningPlayerProps = {
  units: LearningUnit[];
  selectedId?: string;
  onSelect: (id: string) => void;
  onPrevious: () => void;
  onNext: () => void;
  onAsk: () => void;
  onHistory: () => void;
  isHistory?: boolean;
  busy?: boolean;
  questionOpen?: boolean;
  questionControlsId?: string;
  onStage?: (stage: LearningStage, unit: LearningUnit) => void;
  nextLabel?: string;
  children?: ReactNode;
};

/** Navigation around original mounted content, never a second copy of a figure. */
export default function LearningPlayer({
  units,
  selectedId,
  onSelect,
  onPrevious,
  onNext,
  onAsk,
  onHistory,
  isHistory = false,
  busy = false,
  questionOpen = false,
  questionControlsId,
  onStage,
  nextLabel,
  children,
}: LearningPlayerProps) {
  const selected = Math.max(
    0,
    units.findIndex((unit) => unit.id === selectedId),
  );
  const current = units[selected];
  const next = units[selected + 1];
  const trail = useRef<HTMLElement>(null);
  useEffect(() => {
    const nav = trail.current;
    const active = nav?.querySelector<HTMLButtonElement>(
      '[aria-current="step"]',
    );
    if (nav && active)
      nav.scrollTo({
        left: Math.max(
          0,
          active.offsetLeft -
            nav.offsetLeft -
            nav.clientWidth / 2 +
            active.clientWidth / 2,
        ),
        behavior: "instant",
      });
  }, [current?.id, units.length]);
  const status =
    current?.status === "failed"
      ? "Needs attention"
      : current?.status === "partial"
        ? "Partial section saved"
        : current?.status === "pending"
          ? "Preparing this section"
          : "";
  const forwardLabel =
    nextLabel ||
    (next
      ? "Next section"
      : busy
        ? "Preparing section"
        : units.length
          ? "Continue learning"
          : "Begin learning");
  return (
    <section
      className={`learning-player${isHistory ? " is-history" : ""}`}
      data-testid="learning-player"
      data-active-unit={current?.id || ""}
    >
      <header className="learning-player-header">
        <div className="learning-player-topline">
          {!isHistory && (
            <span className="learning-player-position">
              <BookOpen size={17} aria-hidden="true" />
              {units.length
                ? `Section ${selected + 1} of ${units.length}`
                : "Your lesson"}
            </span>
          )}
          <div className="learning-player-summary-controls">
            {!isHistory && current && current.stages.length > 0 && onStage && (
              <nav className="learning-player-stages" aria-label="On this page">
                {current.stages.map((stage) => {
                  const Icon = stageIcons[stage.id];
                  return (
                    <button
                      type="button"
                      key={stage.id}
                      data-learning-stage={stage.id}
                      onClick={() => onStage(stage, current)}
                    >
                      <Icon size={15} aria-hidden="true" />
                      {stage.label}
                    </button>
                  );
                })}
              </nav>
            )}
            {!isHistory && current?.question && (
              <details className="learning-player-question">
                <summary aria-label="Guiding question for this section">
                  Guiding question
                </summary>
                <p>{current.question}</p>
              </details>
            )}
            {!isHistory && status && (
              <span
                className={`learning-player-status is-${current.status}`}
                role="status"
              >
                {status}
              </span>
            )}
            <button
              type="button"
              className="learning-player-history"
              data-testid="learning-player-history"
              aria-label={
                isHistory
                  ? "Return to lesson"
                  : "History: open conversation record"
              }
              aria-pressed={isHistory}
              onClick={onHistory}
            >
              {isHistory ? <BookOpen size={16} /> : <History size={16} />}
              {isHistory ? "Return to lesson" : "History"}
            </button>
          </div>
        </div>
        {(isHistory || !current) && (
          <div className="learning-player-heading">
            <div>
              <h2>
                {isHistory ? "Conversation record" : "Choose a starting point"}
              </h2>
              {isHistory && (
                <p className="learning-player-history-note">
                  Your original questions, explanations and branches stay here.
                  Return to the lesson to study one section at a time.
                </p>
              )}
            </div>
          </div>
        )}
        {!isHistory && units.length > 1 && (
          <div className="learning-player-section-controls">
            <nav
              className="learning-player-trail"
              aria-label="Lesson sections"
              ref={trail}
            >
              {units.map((unit, index) => (
                <button
                  key={unit.id}
                  type="button"
                  aria-label={`Open section ${index + 1} ${unit.title}`}
                  aria-current={unit.id === current?.id ? "step" : undefined}
                  title={unit.title}
                  onClick={() => onSelect(unit.id)}
                >
                  <span className="learning-player-section-number">
                    {index + 1}
                  </span>{" "}
                  <span>{unit.title}</span>
                </button>
              ))}
            </nav>
            <label className="learning-player-section-picker">
              <span>All sections</span>
              <select
                aria-label="Choose a lesson section"
                value={current?.id || ""}
                onChange={(event) => onSelect(event.target.value)}
              >
                {units.map((unit, index) => (
                  <option key={unit.id} value={unit.id}>
                    {index + 1}. {unit.title}
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}
      </header>
      {children}
      {!isHistory && (
        <footer className="learning-player-footer">
          <button
            type="button"
            className="learning-player-back"
            aria-label="Back: previous lesson section"
            disabled={!units.length || selected === 0}
            onClick={onPrevious}
          >
            <ArrowLeft size={17} />
            Back
          </button>
          <button
            type="button"
            className="learning-player-ask"
            data-testid="learning-player-ask"
            aria-label="Ask about this page"
            aria-expanded={questionOpen}
            aria-controls={questionControlsId}
            onClick={onAsk}
          >
            <MessageCircle size={18} />
            Ask about this page
          </button>
          <button
            type="button"
            className="learning-player-forward"
            data-testid="learning-player-next"
            aria-label={
              next
                ? "Next section in lesson"
                : units.length
                  ? "Continue learning"
                  : "Begin learning"
            }
            disabled={!next && busy}
            onClick={onNext}
          >
            {forwardLabel}
            <ArrowRight size={18} />
          </button>
        </footer>
      )}
    </section>
  );
}
