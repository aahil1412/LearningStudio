import { useCallback, useEffect, useRef, useState } from "react";
import {
  LoaderCircle,
  CheckCircle2,
  AlertCircle,
  BookOpen,
} from "lucide-react";
import type {
  PathwayJob,
  PathwayOutlineModule,
  SubjectIntake,
} from "../../v21types";
import { invoke, isDesktop } from "../../lib/bridge";
import type { SubjectRevision } from "../../v2types";
import { curriculumPreviewDescription } from "../../lib/pathwayPlanning";
import "./planning.css";

const stageLabels: Record<PathwayJob["stage"], string> = {
  "preparing-outline": "Preparing the outline",
  "constructing-module": "Constructing a module",
  "waiting-for-model": "Waiting for the planning model slot",
  "validating-prerequisites": "Validating prerequisites",
  "saving-proposal": "Saving the reviewable proposal",
  "awaiting-review": "Your pathway is ready to review",
  complete: "Pathway applied",
  failed: "Planning needs attention",
  canceled: "Planning canceled",
  interrupted: "Planning is paused after an interruption",
};
export function usePlanningJobs(subjectId?: string) {
  const [jobs, setJobs] = useState<PathwayJob[]>([]),
    [intake, setIntake] = useState<SubjectIntake | null>(null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true),
    [loadedOwner, setLoadedOwner] = useState<string | undefined>(),
    generation = useRef(0);
  const owner = useRef(subjectId);
  owner.current = subjectId;
  const refresh = useCallback(async () => {
    if (!isDesktop) {
      setLoadedOwner(subjectId);
      setLoading(false);
      return;
    }
    const ticket = ++generation.current;
    try {
      const [next, setup] = await Promise.all([
        invoke<PathwayJob[]>("planning:list", {
          subjectId,
          includeChunks: !!subjectId,
        }),
        subjectId
          ? invoke<SubjectIntake | null>("learning:intake-get", { subjectId })
          : Promise.resolve(null),
      ]);
      if (ticket !== generation.current || owner.current !== subjectId) return;
      setJobs(next);
      setIntake(setup);
      setError("");
      setLoadedOwner(subjectId);
      setLoading(false);
    } catch (error) {
      if (owner.current === subjectId) {
        setError(error instanceof Error ? error.message : String(error));
        setLoadedOwner(subjectId);
        setLoading(false);
      }
    }
  }, [subjectId]);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setJobs([]);
    setIntake(null);
    const load = () => {
      if (active) void refresh();
    };
    load();
    const dispose = window.studio?.onDataChanged?.(load),
      timer = setInterval(load, 3000);
    return () => {
      active = false;
      generation.current++;
      clearInterval(timer);
      dispose?.();
    };
  }, [refresh]);
  return {
    jobs,
    intake,
    error,
    loading: loading || loadedOwner !== subjectId,
    refresh,
  };
}
export function PlanningIndicator({
  onOpenSubject,
}: {
  onOpenSubject: (subjectId: string) => void;
}) {
  const { jobs } = usePlanningJobs(),
    latest = new Map<string, PathwayJob>();
  for (const job of jobs)
    if (!latest.has(job.subjectId)) latest.set(job.subjectId, job);
  const active = [...latest.values()].filter((job) =>
    ["running", "awaiting-review", "failed", "interrupted"].includes(
      job.status,
    ),
  );
  if (!active.length) return null;
  const running = active.filter((job) => job.status === "running");
  return (
    <div
      className="global-planning-indicator"
      aria-label="Background pathway tasks"
    >
      <details>
        <summary>
          {running.length ? (
            <LoaderCircle size={15} className="planning-spin" />
          ) : (
            <BookOpen size={15} />
          )}{" "}
          {running.length
            ? `${running.length} pathway ${running.length === 1 ? "job" : "jobs"} running`
            : `${active.length} pathway ${active.length === 1 ? "update" : "updates"}`}
        </summary>
        <div className="global-planning-list">
          {active.map((job) => (
            <button key={job.id} onClick={() => onOpenSubject(job.subjectId)}>
              <span>{stageLabels[job.stage]}</span>
              <small>
                {job.totalModules
                  ? `${job.completedModules} of ${job.totalModules} modules saved`
                  : "Outline in progress"}
              </small>
              {job.currentModuleId && (
                <small>
                  {
                    job.outline.find(
                      (module) => module.id === job.currentModuleId,
                    )?.title
                  }
                </small>
              )}
              <small>
                {job.model} · {job.reasoning || "Provider default"}
              </small>
            </button>
          ))}
        </div>
      </details>
    </div>
  );
}
export default function PathwayProgress({
  job,
  onRefresh,
  onReview,
  onApply,
  onBegin,
  retryPreference,
  onApplySaved,
}: {
  job: PathwayJob;
  onRefresh: () => Promise<void>;
  onReview: () => void;
  onApply: () => Promise<void>;
  onBegin?: () => Promise<void>;
  retryPreference?: { model: string; reasoning: string };
  onApplySaved?: (proposalId: string) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [editing, setEditing] = useState<PathwayOutlineModule | null>(null),
    [checkpointReview, setCheckpointReview] = useState<SubjectRevision | null>(
      null,
    ),
    [checkpointApplied, setCheckpointApplied] = useState(false),
    [clock, setClock] = useState(Date.now());
  useEffect(() => {
    if (job.status !== "running") return;
    const timer = setInterval(() => setClock(Date.now()), 15000);
    return () => clearInterval(timer);
  }, [job.status]);
  useEffect(() => {
    setCheckpointReview(null);
    setCheckpointApplied(false);
  }, [job.id]);
  const reviewSaved = async () => {
    setBusy(true);
    setError("");
    try {
      setCheckpointReview(
        await invoke<SubjectRevision>("planning:review-saved", {
          jobId: job.id,
        }),
      );
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };
  const action = async (
    channel: string,
    payload: Record<string, unknown> = {},
  ) => {
    setBusy(true);
    setError("");
    try {
      await invoke(channel, { jobId: job.id, ...payload });
      await onRefresh();
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };
  const pending = job.status === "running",
    completed = new Set(job.chunks.map((chunk) => chunk.moduleId)),
    currentModule = job.outline.find(
      (module) => module.id === job.currentModuleId,
    );
  return (
    <section
      className={"v2-card pathway-progress status-" + job.status}
      aria-label="Persistent pathway progress"
      data-job-id={job.id}
    >
      <div className="planning-heading">
        <h2>
          {pending ? (
            <LoaderCircle className="planning-spin" size={20} />
          ) : job.status === "awaiting-review" || job.status === "complete" ? (
            <CheckCircle2 size={20} />
          ) : (
            <AlertCircle size={20} />
          )}{" "}
          {stageLabels[job.stage]}
        </h2>
        <span className="eyebrow">SAVED IN YOUR LIBRARY</span>
      </div>
      <p>
        {job.totalModules
          ? `${job.completedModules} of ${job.totalModules} modules completed and checkpointed.`
          : "The model is preparing a compact curriculum outline."}{" "}
        {pending
          ? "You can browse, read, or switch chats while this continues."
          : ""}
      </p>
      <p className="planning-model-details">
        Planning: <strong>{job.model}</strong> ·{" "}
        {job.reasoning || "Provider default"} reasoning.
        {retryPreference &&
          (retryPreference.model !== job.model ||
            retryPreference.reasoning !== (job.reasoning || "")) && (
            <>
              {" "}
              Next explicit retry uses {retryPreference.model} ·{" "}
              {retryPreference.reasoning || "Provider default"}.
            </>
          )}
      </p>
      {pending && currentModule && (
        <p>
          <strong>Current module:</strong> {currentModule.title}
        </p>
      )}
      {job.totalModules > 0 && (
        <progress
          aria-label="Completed pathway modules"
          max={job.totalModules}
          value={job.completedModules}
        />
      )}
      {pending && (
        <div className="planning-remote-state" role="status">
          <span className="planning-pulse" />
          {job.stage === "waiting-for-model"
            ? "Another planning request is finishing. This checkpoint is safely queued."
            : job.requestState === "possibly-admitted"
              ? "Building the next curriculum section. Validated modules appear here as they are saved."
              : "Preparing, validating, or saving the current checkpoint."}
        </div>
      )}
      {pending && job.requestState === "possibly-admitted" && (
        <p className="muted planning-liveness">
          {job.heartbeatAt && clock - Date.parse(job.heartbeatAt) < 45000
            ? "The local planning job is responding. This does not indicate remote completion progress."
            : "No recent local check-in is available. You can cancel and retry saved work if the request does not recover."}
        </p>
      )}
      {job.outline.length > 0 && (
        <ol className="pathway-outline">
          {job.outline.map((module) => (
            <li
              key={module.id}
              className={completed.has(module.id) ? "checkpoint-complete" : ""}
            >
              <div>
                <span
                  aria-label={
                    completed.has(module.id) ? "Module saved" : "Module pending"
                  }
                >
                  {completed.has(module.id) ? "✓" : "○"}
                </span>
                <strong>{module.title}</strong>
                {!pending && job.status !== "complete" && (
                  <button onClick={() => setEditing(module)} disabled={busy}>
                    Edit priorities
                  </button>
                )}
              </div>
              <p>
                {curriculumPreviewDescription(module.description, module.title)}
              </p>
              {module.priorities.length > 0 && (
                <p className="muted">Focus: {module.priorities.join(" · ")}</p>
              )}
              {completed.has(module.id) && (
                <details>
                  <summary>
                    Preview{" "}
                    {job.chunks.find((chunk) => chunk.moduleId === module.id)
                      ?.nodes.length || 0}{" "}
                    planned items
                  </summary>
                  <ul>
                    {job.chunks
                      .find((chunk) => chunk.moduleId === module.id)
                      ?.nodes.filter((node) => node.kind !== "module")
                      .map((node) => (
                        <li key={node.id}>
                          <strong>{node.title}</strong>
                          {node.description && (
                            <p>
                              {curriculumPreviewDescription(
                                node.description,
                                node.title,
                              )}
                            </p>
                          )}
                        </li>
                      ))}
                  </ul>
                </details>
              )}
            </li>
          ))}
        </ol>
      )}
      {editing && (
        <form
          className="v2-card"
          onSubmit={(event) => {
            event.preventDefault();
            void action("planning:edit-module", {
              moduleId: editing.id,
              title: editing.title,
              description: editing.description,
              priorities: editing.priorities,
            }).then(() => setEditing(null));
          }}
        >
          <h3>Edit this section before studying</h3>
          <label>
            Module title
            <input
              value={editing.title}
              maxLength={500}
              onChange={(event) =>
                setEditing({ ...editing, title: event.target.value })
              }
            />
          </label>
          <label>
            Description
            <textarea
              value={editing.description}
              maxLength={4000}
              onChange={(event) =>
                setEditing({ ...editing, description: event.target.value })
              }
            />
          </label>
          <label>
            Priorities, one per line
            <textarea
              value={editing.priorities.join("\n")}
              onChange={(event) =>
                setEditing({
                  ...editing,
                  priorities: event.target.value.split("\n").slice(0, 12),
                })
              }
            />
          </label>
          <div className="button-row">
            <button
              className="primary"
              disabled={busy || !editing.title.trim()}
            >
              Save section edits
            </button>
            <button type="button" onClick={() => setEditing(null)}>
              Cancel
            </button>
          </div>
          <p className="muted">
            After saving, choose Resume to reconstruct this module. Other
            completed modules stay saved.
          </p>
        </form>
      )}
      {(job.error || error) && (
        <p className="notice error" role="alert">
          {error || job.error}
        </p>
      )}
      {checkpointReview && (
        <section
          className="v2-card checkpoint-review"
          aria-label="Review saved pathway modules"
        >
          <h3>Review saved modules before studying</h3>
          <p>
            These validated items have their prerequisites available. Applying
            them adds to your pathway and preserves your edits. Planning can
            continue with the remaining modules.
          </p>
          <ul>
            {checkpointReview.operations
              .filter(
                (operation) =>
                  operation.entity === "curriculum" && operation.op === "put",
              )
              .map((operation) => (
                <li key={operation.id}>
                  <strong>
                    {String(operation.value?.title || "Curriculum item")}
                  </strong>
                  <span className="muted">
                    {" "}
                    · {String(operation.value?.kind || "item")}
                  </span>
                  {operation.value?.description ? (
                    <p>
                      {curriculumPreviewDescription(
                        String(operation.value.description),
                        String(operation.value.title),
                      )}
                    </p>
                  ) : null}
                </li>
              ))}
          </ul>
          <div className="button-row">
            <button
              className="primary"
              disabled={busy || !onApplySaved}
              onClick={() => {
                if (!onApplySaved) return;
                setBusy(true);
                setError("");
                void onApplySaved(checkpointReview.id)
                  .then(async () => {
                    setCheckpointReview(null);
                    setCheckpointApplied(true);
                    await onRefresh();
                  })
                  .catch((error) => setError(String(error)))
                  .finally(() => setBusy(false));
              }}
            >
              Apply saved modules
            </button>
            <button disabled={busy} onClick={() => setCheckpointReview(null)}>
              Close review
            </button>
          </div>
        </section>
      )}
      <div className="button-row">
        {job.chunks.length > 0 &&
          !["awaiting-review", "complete"].includes(job.status) &&
          onApplySaved && (
            <button disabled={busy} onClick={() => void reviewSaved()}>
              Review saved modules now
            </button>
          )}
        {checkpointApplied && onBegin && job.status !== "complete" && (
          <button
            className="primary"
            disabled={busy}
            onClick={() => void onBegin()}
          >
            Study saved pathway
          </button>
        )}
        {pending && (
          <button
            disabled={busy}
            onClick={() => void action("planning:cancel")}
          >
            Cancel planning
          </button>
        )}
        {["failed", "interrupted", "canceled"].includes(job.status) && (
          <button
            className="primary"
            disabled={busy}
            onClick={() =>
              void action(
                job.status === "failed" ? "planning:retry" : "planning:resume",
                retryPreference?.model ? retryPreference : {},
              )
            }
          >
            {job.status === "failed"
              ? "Retry unfinished work"
              : "Resume saved work"}
          </button>
        )}
        {job.status === "awaiting-review" && (
          <>
            <button onClick={onReview}>Review curriculum changes</button>
            <button
              className="primary"
              disabled={busy}
              onClick={() => {
                setBusy(true);
                setError("");
                void onApply()
                  .catch((error) => setError(String(error)))
                  .finally(() => setBusy(false));
              }}
            >
              Apply reviewed pathway
            </button>
          </>
        )}
        {job.status === "complete" && onBegin && (
          <button className="primary" onClick={() => void onBegin()}>
            Enter the first lesson
          </button>
        )}
      </div>
      <small className="muted">
        Updated {new Date(job.updatedAt).toLocaleString()}.{" "}
        {job.retryCount
          ? `${job.retryCount} explicit ${job.retryCount === 1 ? "retry" : "retries"}. `
          : ""}
        {job.status !== "running" && job.status !== "complete"
          ? "Resuming may use additional subscription allowance. Requests are never replayed automatically."
          : ""}
      </small>
    </section>
  );
}
