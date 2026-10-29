import { useState, useEffect } from "react";
import { Clock, Play, Square, RefreshCw, Download } from "lucide-react";
import type { StudioData, BackgroundTask } from "../types";
import { invoke } from "../lib/bridge";
import Markdown from "./Markdown";
type Props = { data: StudioData; onChange: (data: StudioData) => void };
export default function Automation({ data, onChange }: Props) {
  const [prompt, setPrompt] = useState(""),
    [kind, setKind] = useState<BackgroundTask["kind"]>("review"),
    [minutes, setMinutes] = useState(0),
    [delay, setDelay] = useState(0),
    [lessonId, setLessonId] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [update, setUpdate] = useState<{
      status: string;
      version?: string;
      error?: string;
      progress?: number;
    }>({ status: "idle" });
  const settings = data.settings,
    tasks = data.backgroundTasks || [];
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "The operation failed.");
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    const timer = setInterval(() => {
      void invoke<typeof update>("updates:status")
        .then(setUpdate)
        .catch(() => {});
    }, 1500);
    return () => clearInterval(timer);
  }, []);
  const add = () => {
    const now = new Date().toISOString();
    const task: BackgroundTask = {
      id: crypto.randomUUID(),
      kind,
      prompt: prompt.trim(),
      lessonId: lessonId || undefined,
      model: settings.models[kind === "review" ? "review" : "tutor"].model,
      reasoning:
        settings.models[kind === "review" ? "review" : "tutor"].reasoning ||
        undefined,
      nextRunAt: new Date(Date.now() + delay * 60000).toISOString(),
      intervalMinutes: minutes >= 5 ? minutes : undefined,
      enabled: true,
      status: "scheduled",
      createdAt: now,
      updatedAt: now,
    };
    onChange({ ...data, backgroundTasks: [task, ...tasks] });
    setPrompt("");
  };
  return (
    <section>
      <span className="eyebrow">WORK WITH INTENTION</span>
      <h2>Automation & updates</h2>
      <p>
        Scheduled work uses the active account and the task’s selected model.
        Completed results stay here for you to review.
      </p>
      <label className="check-row">
        <input
          type="checkbox"
          checked={settings.backgroundConsent}
          onChange={(e) =>
            onChange({
              ...data,
              settings: { ...settings, backgroundConsent: e.target.checked },
            })
          }
        />
        <span>
          <strong>Allow scheduled model requests to use my ChatGPT plan</strong>
          <small>
            Explicit consent is required. Disable this to pause all scheduled
            inference.
          </small>
        </span>
      </label>
      <label className="check-row">
        <input
          type="checkbox"
          disabled={!settings.backgroundConsent}
          checked={!!settings.backgroundOnClose}
          onChange={(e) =>
            onChange({
              ...data,
              settings: { ...settings, backgroundOnClose: e.target.checked },
            })
          }
        />
        <span>
          <strong>Continue scheduled work in the Windows tray</strong>
          <small>
            Closing the window keeps Learning Studio running. Quit from its tray
            menu to stop it. Missed work is coalesced on the next launch.
          </small>
        </span>
      </label>
      <form
        className="settings-card"
        onSubmit={(e) => {
          e.preventDefault();
          if (prompt.trim() && settings.backgroundConsent) add();
        }}
      >
        <h3>
          <Clock size={15} />
          Schedule a task
        </h3>
        <div className="model-row">
          <label>
            Task
            <select
              aria-label="Scheduled task type"
              value={kind}
              onChange={(e) => setKind(e.target.value as typeof kind)}
            >
              <option value="review">Review preparation</option>
              <option value="lesson">Lesson preparation</option>
              <option value="summary">Session summary</option>
              <option value="research">Research questions</option>
            </select>
          </label>
          <label>
            Context
            <select
              aria-label="Scheduled task lesson"
              value={lessonId}
              onChange={(e) => setLessonId(e.target.value)}
            >
              <option value="">No linked lesson</option>
              {data.lessons.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.title}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label>
          Instructions
          <textarea
            aria-label="Scheduled task instructions"
            value={prompt}
            maxLength={30000}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Prepare a review of the key ideas, leaving the questions optional."
          />
        </label>
        <div className="model-row">
          <label>
            Start after (minutes)
            <input
              aria-label="Task delay"
              type="number"
              min={0}
              max={525600}
              value={delay}
              onChange={(e) => setDelay(Math.max(0, Number(e.target.value)))}
            />
          </label>
          <label>
            Repeat every (minutes; 0 = once)
            <input
              aria-label="Task interval"
              type="number"
              min={0}
              max={525600}
              value={minutes}
              onChange={(e) => setMinutes(Math.max(0, Number(e.target.value)))}
            />
          </label>
        </div>
        <button
          className="primary"
          disabled={
            !prompt.trim() ||
            !settings.backgroundConsent ||
            (minutes > 0 && minutes < 5)
          }
        >
          Schedule task
        </button>
      </form>
      <div className="button-row">
        <button
          disabled={busy || !settings.backgroundConsent}
          onClick={() =>
            void run(async () => {
              await invoke("data:save", data);
              await invoke("background:run");
            })
          }
        >
          <Play size={14} />
          Run due tasks
        </button>
      </div>
      {tasks.map((task) => (
        <div className="settings-card" key={task.id}>
          <div className="button-row">
            <strong>
              {task.kind} · {task.status}
            </strong>
            <span className="muted">
              {new Date(task.nextRunAt).toLocaleString()}
            </span>
            <button
              disabled={task.status === "cancelled"}
              onClick={() =>
                void run(() => invoke("background:cancel", { id: task.id }))
              }
            >
              <Square size={12} />
              Cancel
            </button>
            {["failed", "cancelled", "complete"].includes(task.status) && (
              <button
                onClick={() =>
                  onChange({
                    ...data,
                    backgroundTasks: tasks.map((t) =>
                      t.id === task.id
                        ? {
                            ...t,
                            status: "scheduled",
                            enabled: true,
                            error: undefined,
                            nextRunAt: new Date().toISOString(),
                            updatedAt: new Date().toISOString(),
                          }
                        : t,
                    ),
                  })
                }
              >
                Resume now
              </button>
            )}
          </div>
          <p>{task.prompt}</p>
          {task.error && <p className="notice error">{task.error}</p>}
          {task.result && (
            <details>
              <summary>Read completed result</summary>
              <Markdown text={task.result} />
            </details>
          )}
        </div>
      ))}
      <div className="settings-card">
        <h3>Application updates</h3>
        <p>
          Use your publisher’s trusted HTTPS release feed. Updates download only
          when requested, and installation requires the signed distribution’s
          embedded publisher identity.
        </p>
        <label>
          Release feed
          <input
            aria-label="Update feed URL"
            type="url"
            value={settings.updates?.feedUrl || ""}
            placeholder="https://your-publisher.example/releases/"
            onChange={(e) =>
              onChange({
                ...data,
                settings: {
                  ...settings,
                  updates: {
                    autoCheck: settings.updates?.autoCheck || false,
                    feedUrl: e.target.value,
                  },
                },
              })
            }
          />
        </label>
        <label className="check-row">
          <input
            type="checkbox"
            checked={!!settings.updates?.autoCheck}
            onChange={(e) =>
              onChange({
                ...data,
                settings: {
                  ...settings,
                  updates: {
                    feedUrl: settings.updates?.feedUrl || "",
                    autoCheck: e.target.checked,
                  },
                },
              })
            }
          />
          <span>Check for updates when Learning Studio starts</span>
        </label>
        <div className="button-row">
          <button
            disabled={busy || !settings.updates?.feedUrl}
            onClick={() =>
              void run(async () =>
                setUpdate(
                  await invoke("updates:check", {
                    feedUrl: settings.updates?.feedUrl,
                  }),
                ),
              )
            }
          >
            <RefreshCw size={14} />
            Check for updates
          </button>
          <button
            disabled={busy || update.status !== "available"}
            onClick={() =>
              void run(async () => setUpdate(await invoke("updates:download")))
            }
          >
            <Download size={14} />
            Download update
          </button>
          <button
            disabled={update.status !== "ready"}
            onClick={() => void run(() => invoke("updates:install"))}
          >
            Install & restart
          </button>
        </div>
        <p role="status">
          {update.status}
          {update.version ? " · " + update.version : ""}
          {update.progress ? " · " + Math.round(update.progress) + "%" : ""}
        </p>
        {update.error && <p className="notice error">{update.error}</p>}
      </div>
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
