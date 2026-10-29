import { useState } from "react";
import { ArrowRight, Check, SkipForward } from "lucide-react";
import type { Subject } from "../../v2types";
import type { SubjectIntake, TeachingPreferences } from "../../v21types";
import { defaultTeachingPreferences } from "../../v21types";
import LearningPreferences from "./LearningPreferences";
import "./planning.css";

export type IntakeDraft = Omit<
  SubjectIntake,
  "createdAt" | "updatedAt" | "revision"
> & { revision?: number };
export default function LearningSetup({
  subject,
  initial,
  globalPreferences,
  demonstrated = [],
  onSave,
  onPlan,
  onClose,
}: {
  subject: Subject;
  initial?: SubjectIntake | null;
  globalPreferences?: TeachingPreferences;
  demonstrated?: string[];
  onSave: (draft: IntakeDraft) => Promise<SubjectIntake>;
  onPlan: () => Promise<void>;
  onClose: () => void;
}) {
  const [step, setStep] = useState(initial?.status === "ready" ? 4 : 0),
    [draft, setDraft] = useState<IntakeDraft>(
      initial || {
        subjectId: subject.id,
        status: "in-progress",
        goal: subject.objective,
        motivation: "",
        familiarity: "",
        strengths: "",
        gaps: "",
        depth: subject.depth,
        preferences: { ...defaultTeachingPreferences, ...globalPreferences },
        assessment: "skipped",
        assessmentNotes: "",
      },
    ),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const update = (patch: Partial<IntakeDraft>) =>
    setDraft((value) => ({ ...value, ...patch }));
  const save = async (status: SubjectIntake["status"]) => {
    const saved = await onSave({ ...draft, status });
    setDraft(saved);
    return saved;
  };
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };
  const titles = [
    "What would you like to understand?",
    "Where should we meet you?",
    "How would you like to explore it?",
    "What kind of practice helps you?",
    "Your learning setup",
  ];
  return (
    <section
      className="v2-card learning-setup"
      aria-label="Conversational learning setup"
    >
      <div className="planning-heading">
        <div>
          <span className="eyebrow">A SHORT CONVERSATION BEFORE WE PLAN</span>
          <h2>{titles[step]}</h2>
        </div>
        <button aria-label="Close learning setup" onClick={onClose}>
          Close
        </button>
      </div>
      <p className="muted">
        {step < 4
          ? `Step ${step + 1} of 4. Everything here is editable later.`
          : "Review your preferences. A pathway is a proposal you can edit before applying."}
      </p>
      <div className="setup-step-indicator" aria-hidden="true">
        {[0, 1, 2, 3, 4].map((index) => (
          <span key={index} className={index <= step ? "active" : ""} />
        ))}
      </div>
      {step === 0 && (
        <>
          <p>
            Broad goals are welcome. A whole discipline is a useful starting
            point.
          </p>
          <label>
            Your learning goal
            <textarea
              aria-label="Learning setup goal"
              value={draft.goal}
              maxLength={20000}
              onChange={(event) => update({ goal: event.target.value })}
            />
          </label>
          <label>
            What draws you to it? <span className="muted">Optional</span>
            <textarea
              aria-label="Learning motivation"
              rows={2}
              value={draft.motivation}
              maxLength={6000}
              onChange={(event) => update({ motivation: event.target.value })}
              placeholder="Curiosity, an application, or simply wanting a clear understanding"
            />
          </label>
        </>
      )}
      {step === 1 && (
        <>
          <p>
            Tell us what already feels familiar and what you would like
            explained from the beginning. We will not infer a background from
            the subject title.
          </p>
          {demonstrated.length > 0 && (
            <p className="notice">
              Your saved evidence already shows understanding of{" "}
              {demonstrated.slice(0, 6).join(", ")}. We will use that rather
              than testing it again.
            </p>
          )}
          <label>
            Current familiarity
            <textarea
              aria-label="Prior familiarity"
              value={draft.familiarity}
              maxLength={6000}
              onChange={(event) => update({ familiarity: event.target.value })}
              placeholder="New to this, some experience, or your own description"
            />
          </label>
          <div className="v2-form-grid">
            <label>
              Comfortable areas <span className="muted">Optional</span>
              <textarea
                aria-label="Comfortable areas"
                value={draft.strengths}
                maxLength={6000}
                onChange={(event) => update({ strengths: event.target.value })}
              />
            </label>
            <label>
              Areas that feel unclear <span className="muted">Optional</span>
              <textarea
                aria-label="Areas needing support"
                value={draft.gaps}
                maxLength={6000}
                onChange={(event) => update({ gaps: event.target.value })}
              />
            </label>
          </div>
        </>
      )}
      {step === 2 && (
        <>
          <p>
            Choose a useful starting depth and how the explanations should
            arrive. You can change these while learning.
          </p>
          <label>
            Depth
            <select
              aria-label="Learning setup depth"
              value={draft.depth}
              onChange={(event) =>
                update({ depth: event.target.value as Subject["depth"] })
              }
            >
              <option value="overview">Orientation and overview</option>
              <option value="comprehensive">Comprehensive understanding</option>
              <option value="advanced">Rigorous and advanced</option>
            </select>
          </label>
          <fieldset className="setup-choice-list">
            <legend>Show ideas in a way that works for you</legend>
            {(
              [
                [
                  "visual-first",
                  "Visual first",
                  "A useful figure early, with explanations of what you are seeing.",
                ],
                [
                  "balanced",
                  "Balanced",
                  "A mixture of concise explanations, figures, and worked examples.",
                ],
                [
                  "text-first",
                  "Text first",
                  "Begin with words and equations, with visuals when they add clarity.",
                ],
              ] as const
            ).map(([value, label, description]) => (
              <label key={value}>
                <input
                  type="radio"
                  name="setup-delivery"
                  checked={draft.preferences.delivery === value}
                  onChange={() =>
                    update({
                      preferences: { ...draft.preferences, delivery: value },
                    })
                  }
                />
                <span>
                  <strong>{label}</strong>
                  <small>{description}</small>
                </span>
              </label>
            ))}
          </fieldset>
        </>
      )}
      {step === 3 && (
        <>
          <p>
            Checks help us adapt, but you stay in control. Every question can be
            skipped.
          </p>
          <LearningPreferences
            value={draft.preferences}
            onChange={(preferences) => update({ preferences })}
          />
          <fieldset className="setup-choice-list">
            <legend>Would you like a short adaptive baseline?</legend>
            <label>
              <input
                type="radio"
                name="baseline"
                checked={draft.assessment === "skipped"}
                onChange={() => update({ assessment: "skipped" })}
              />
              <span>
                <strong>Skip the baseline</strong>
                <small>Begin learning with no preliminary assessment.</small>
              </span>
            </label>
            <label>
              <input
                type="radio"
                name="baseline"
                checked={draft.assessment === "requested"}
                onChange={() => update({ assessment: "requested" })}
              />
              <span>
                <strong>Offer a brief baseline in the first lesson</strong>
                <small>
                  Ask about useful prerequisites, excluding what saved evidence
                  already demonstrates. This never blocks planning.
                </small>
              </span>
            </label>
          </fieldset>
        </>
      )}
      {step === 4 && (
        <div className="setup-summary">
          <h3>{draft.goal}</h3>
          <p>{draft.motivation || "Learning for understanding."}</p>
          <dl>
            <dt>Starting point</dt>
            <dd>
              {draft.familiarity ||
                "We will start gently and adapt from your answers."}
            </dd>
            <dt>Depth</dt>
            <dd>{draft.depth}</dd>
            <dt>Delivery</dt>
            <dd>{draft.preferences.delivery.replaceAll("-", " ")}</dd>
            <dt>Practice</dt>
            <dd>
              {draft.preferences.practice === "mcq"
                ? "Multiple choice"
                : draft.preferences.practice}
            </dd>
            <dt>Checks</dt>
            <dd>{draft.preferences.checkFrequency.replaceAll("-", " ")}</dd>
            <dt>Baseline</dt>
            <dd>
              {draft.assessment === "requested"
                ? "Offer in the first lesson, always skippable"
                : "Skipped"}
            </dd>
          </dl>
          {draft.gaps && (
            <p>
              <strong>Give attention to:</strong> {draft.gaps}
            </p>
          )}
          <p className="notice">
            Planning uses your answers and shared subject evidence. You will see
            a live outline and review the completed modules before any
            curriculum changes are applied.
          </p>
        </div>
      )}
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
      <div className="button-row setup-actions">
        {step > 0 && (
          <button disabled={busy} onClick={() => setStep(step - 1)}>
            Back
          </button>
        )}
        {step < 4 ? (
          <button
            className="primary"
            disabled={busy || !draft.goal.trim()}
            onClick={() =>
              void run(async () => {
                await save("in-progress");
                setStep(step + 1);
              })
            }
          >
            Continue <ArrowRight size={15} />
          </button>
        ) : (
          <>
            <button
              className="primary"
              disabled={busy || !draft.goal.trim()}
              onClick={() =>
                void run(async () => {
                  await save("ready");
                  await onPlan();
                  onClose();
                })
              }
            >
              <Check size={15} /> Save setup and construct pathway
            </button>
            <button
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await save("ready");
                  onClose();
                })
              }
            >
              Save preferences only
            </button>
          </>
        )}
        {step < 4 && (
          <button
            disabled={busy}
            onClick={() =>
              void run(async () => {
                await save("skipped");
                onClose();
              })
            }
          >
            <SkipForward size={15} /> Skip setup and use defaults
          </button>
        )}
      </div>
    </section>
  );
}
