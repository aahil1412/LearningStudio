import ProviderSettings from "./ProviderSettings";
import "./settings-studio.css";
import { useState } from "react";
import {
  X,
  Palette,
  UserRound,
  SlidersHorizontal,
  Database,
  ExternalLink,
  RefreshCw,
  ShieldCheck,
  Settings2,
  Check,
} from "lucide-react";
import Appearance from "./Appearance";
import Automation from "./Automation";
import AccountProfiles from "./AccountProfiles";
import TeachingPreferences from "./TeachingPreferences";
import { sanitizeAppearance } from "../lib/themes";
import { invoke } from "../lib/bridge";
import type { StudioData, AuthStatus, ModelInfo } from "../types";
import type { RestorePreview } from "../../electron/restorePreview";
type Props = {
  data: StudioData;
  onChange: (data: StudioData) => void;
  onClose: () => void;
  auth: AuthStatus;
  models: ModelInfo[];
  refreshAuth: () => Promise<void>;
  initialTab?: string;
  onRestore: (token: string) => Promise<void>;
  embedded?: boolean;
};
export default function Settings({
  data,
  onChange,
  onClose,
  auth,
  models,
  refreshAuth,
  initialTab = "Appearance",
  onRestore,
  embedded = false,
}: Props) {
  const [tab, setTab] = useState(
      initialTab === "Typography" ? "Appearance" : initialTab,
    ),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [usageWelcome, setUsageWelcome] = useState(false),
    [confirm, setConfirm] = useState<StudioData | null>(null),
    [restoreReview, setRestoreReview] = useState<RestorePreview | null>(null);
  const settings = data.settings;
  const planningModelId =
    settings.planning?.model || settings.models.tutor.model;
  const planningModel =
    models.find((model) => model.id === planningModelId) ||
    (!planningModelId ? models[0] : undefined);
  const planningLevels = planningModel?.reasoningLevels || [];
  const responsiveReasoning = (levels: string[]) =>
    levels.includes("medium")
      ? "medium"
      : levels.includes("low")
        ? "low"
        : levels[0] || "";
  const planningReasoning =
    settings.planning?.reasoning ?? responsiveReasoning(planningLevels);
  const update = (patch: Partial<typeof settings>) =>
    onChange({ ...data, settings: { ...settings, ...patch } });
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setMessage("");
    try {
      await fn();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "This operation failed.");
    } finally {
      setBusy(false);
    }
  };
  const sections = [
    {
      label: "Appearance",
      detail: "Themes, colors and typography",
      Icon: Palette,
    },
    {
      label: "Account & models",
      detail: "Connections and model choices",
      Icon: UserRound,
    },
    {
      label: "Learning",
      detail: "Teaching style and preferences",
      Icon: SlidersHorizontal,
    },
    {
      label: "Data & privacy",
      detail: "Library, backups and privacy",
      Icon: Database,
    },
    {
      label: "Automation & updates",
      detail: "Background tasks and releases",
      Icon: RefreshCw,
    },
  ];
  const section = sections.find((item) => item.label === tab) || sections[0];
  return (
    <div
      className={
        embedded
          ? "settings-workbench-backdrop settings-embedded"
          : "modal-backdrop settings-workbench-backdrop"
      }
      onMouseDown={(e) => {
        if (!embedded && e.target === e.currentTarget) onClose();
      }}
    >
      <section
        className="settings-modal settings-studio"
        role={embedded ? "region" : "dialog"}
        aria-modal={embedded ? undefined : true}
        aria-label="Settings"
      >
        <header className="settings-studio-heading">
          <div className="settings-studio-identity">
            <Settings2 size={22} />
            <strong>Settings</strong>
          </div>
          <span className="settings-save-status">
            <Check size={15} /> Changes save automatically
          </span>
          <button
            className="icon-button close-settings"
            aria-label="Close settings"
            onClick={onClose}
          >
            <X size={20} />
          </button>
        </header>
        <aside className="settings-nav" aria-label="Settings sections">
          <h2>Workspace preferences</h2>
          {sections.map(({ label, detail, Icon }) => (
            <button
              key={label}
              aria-label={`${label}: ${detail}`}
              aria-current={tab === label ? "page" : undefined}
              className={tab === label ? "active" : ""}
              onClick={() => setTab(label)}
            >
              <Icon size={20} />
              <span>
                <strong>{label}</strong>{" "}
                <small aria-hidden="true">{detail}</small>
              </span>
            </button>
          ))}
          <div className="settings-nav-footer">
            <ShieldCheck size={18} />
            <span>
              Your library stays
              <br />
              on this computer.
            </span>
          </div>
        </aside>
        <div className="settings-content">
          <header className="settings-page-header">
            <h2>{tab === "Learning" ? "Learning preferences" : tab}</h2>
            <p>{section.detail}</p>
          </header>
          <div className="settings-page-body">
            {tab === "Appearance" && (
              <Appearance
                initialSection={
                  initialTab === "Typography" ? "Typography" : undefined
                }
                value={sanitizeAppearance(data.appearance)}
                onChange={(appearance) => onChange({ ...data, appearance })}
              />
            )}
            {tab === "Account & models" && (
              <>
                <ProviderSettings onChanged={refreshAuth} />
                <AccountProfiles onSelected={refreshAuth} />
                <div className="settings-card account-card">
                  <div className="account-logo">◎</div>
                  <div>
                    <h3>
                      {auth.connected ? "ChatGPT connected" : "Connect ChatGPT"}
                    </h3>
                    <p>
                      {auth.account ||
                        "Plus or Pro eligibility and available capabilities are determined by OpenAI."}
                    </p>
                  </div>
                  <span
                    className={"badge " + (auth.connected ? "success" : "")}
                  >
                    {auth.connected ? "Using ChatGPT plan" : "Disconnected"}
                  </span>
                </div>
                <p className="settings-note">
                  Requests use your ChatGPT plan allowance. Limits are shared
                  with other apps and can vary by account and model. Learning
                  Studio never switches to paid API billing. No API key is
                  required.
                </p>
                <div className="button-row">
                  <button
                    className="primary"
                    disabled={busy}
                    onClick={() =>
                      run(async () => {
                        const connected =
                          await invoke<AuthStatus>("auth:connect");
                        if (
                          connected.connected &&
                          !settings.planUsageAcknowledged
                        )
                          setUsageWelcome(true);
                        await refreshAuth();
                        setMessage(
                          "Connection updated. Select an available model below.",
                        );
                      })
                    }
                  >
                    {busy
                      ? "Waiting for browser authorization…"
                      : auth.connected
                        ? "Reconnect ChatGPT"
                        : "Continue with ChatGPT"}
                  </button>
                  {auth.connected && (
                    <button
                      onClick={() =>
                        run(async () => {
                          await invoke("auth:disconnect");
                          await refreshAuth();
                        })
                      }
                    >
                      Disconnect
                    </button>
                  )}
                  <button onClick={() => run(refreshAuth)} disabled={busy}>
                    <RefreshCw size={15} />
                    Refresh models
                  </button>
                </div>
                {auth.error && <p className="notice warning">{auth.error}</p>}
                <button
                  className="text-button"
                  onClick={() =>
                    void invoke(
                      "external:open",
                      "https://chatgpt.com/settings/usage",
                    )
                  }
                >
                  <ExternalLink size={15} />
                  Manage ChatGPT usage
                </button>
                <h3 className="spaced">Models by task</h3>
                <p className="muted">
                  Only models returned by the explicitly selected provider are
                  offered. Reasoning choices appear when the catalog provides
                  supported values.
                </p>
                {(["tutor", "visual", "review"] as const).map((task) => {
                  const selected = models.find(
                    (m) => m.id === settings.models[task].model,
                  );
                  return (
                    <div className="model-row" key={task}>
                      <label>
                        {task === "tutor"
                          ? "Teaching & discussion"
                          : task === "visual"
                            ? "Visual explanations"
                            : "Practice & review"}
                        <select
                          aria-label={task + " model"}
                          value={settings.models[task].model}
                          onChange={(e) =>
                            update({
                              models: {
                                ...settings.models,
                                [task]: {
                                  model: e.target.value,
                                  reasoning: "",
                                },
                              },
                            })
                          }
                        >
                          <option value="">
                            {models.length
                              ? "Choose a model"
                              : "Configure a provider to discover models"}
                          </option>
                          {models.map((m) => (
                            <option key={m.id} value={m.id}>
                              {m.name}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        Reasoning
                        <select
                          aria-label={task + " reasoning"}
                          value={settings.models[task].reasoning}
                          onChange={(e) =>
                            update({
                              models: {
                                ...settings.models,
                                [task]: {
                                  ...settings.models[task],
                                  reasoning: e.target.value,
                                },
                              },
                            })
                          }
                        >
                          <option value="">Provider default</option>
                          {selected?.reasoningLevels.map((r) => (
                            <option key={r} value={r}>
                              {r}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                  );
                })}
                <h3 className="spaced">Curriculum planning</h3>
                <p className="muted">
                  Planning has its own model choice. Medium reasoning is the
                  responsive default; higher reasoning can take several minutes
                  per module. Teaching choices above stay independent.
                </p>
                <div className="model-row">
                  <label>
                    Planning model
                    <select
                      aria-label="planning model"
                      value={settings.planning?.model || ""}
                      onChange={(e) => {
                        const selected =
                          models.find(
                            (model) =>
                              model.id ===
                              (e.target.value || settings.models.tutor.model),
                          ) ||
                          (!e.target.value && !settings.models.tutor.model
                            ? models[0]
                            : undefined);
                        update({
                          planning: {
                            model: e.target.value,
                            reasoning: responsiveReasoning(
                              selected?.reasoningLevels || [],
                            ),
                          },
                        });
                      }}
                    >
                      <option value="">Use teaching model</option>
                      {models.map((model) => (
                        <option key={model.id} value={model.id}>
                          {model.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Planning reasoning
                    <select
                      aria-label="planning reasoning"
                      value={planningReasoning}
                      onChange={(e) =>
                        update({
                          planning: {
                            model: settings.planning?.model || "",
                            reasoning: e.target.value,
                          },
                        })
                      }
                    >
                      <option value="">Provider default</option>
                      {planningReasoning &&
                        !planningLevels.includes(planningReasoning) && (
                          <option value={planningReasoning} disabled>
                            {planningReasoning} (unavailable)
                          </option>
                        )}
                      {planningLevels.map((level) => (
                        <option key={level} value={level}>
                          {level === "medium" ? "Medium (recommended)" : level}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <label className="check-row">
                  <input
                    type="checkbox"
                    checked={settings.backgroundConsent}
                    onChange={(e) =>
                      update({ backgroundConsent: e.target.checked })
                    }
                  />
                  <span>
                    <strong>Allow background model usage</strong>
                    <small>
                      Allow scheduled tasks to use your ChatGPT plan. Manage
                      tasks and Windows tray behavior under Automation &
                      updates. Turning this off pauses scheduled inference.
                    </small>
                  </span>
                </label>
              </>
            )}
            {tab === "Learning" && (
              <>
                <div className="settings-card">
                  <h3>Teaching defaults</h3>
                  <p>
                    These defaults apply before a subject has its own learning
                    setup. Edit a subject's setup to choose a different style
                    for that subject.
                  </p>
                  <TeachingPreferences
                    value={settings.teaching}
                    onChange={(teaching) => update({ teaching })}
                  />
                  <p className="settings-note">
                    Lesson figures stay inline beside their explanations. Use a
                    figure's Fullscreen control for a larger view; returning
                    keeps its parameters and selections.
                  </p>
                  <label className="check-row">
                    <input
                      type="checkbox"
                      checked={settings.assessments}
                      onChange={(e) =>
                        update({ assessments: e.target.checked })
                      }
                    />
                    <span>
                      <strong>Offer optional diagnostic questions</strong>
                      <small>
                        Questions can always be skipped. Your lesson never
                        depends on a quiz.
                      </small>
                    </span>
                  </label>
                  <label className="check-row">
                    <input
                      type="checkbox"
                      checked={settings.personalization}
                      onChange={(e) =>
                        update({ personalization: e.target.checked })
                      }
                    />
                    <span>
                      <strong>Use my learning preferences</strong>
                      <small>
                        Only the preferences below and explicit knowledge
                        records are used. No biography is assumed.
                      </small>
                    </span>
                  </label>
                  <label>
                    Optional preferences
                    <textarea
                      aria-label="Learning preferences"
                      placeholder="For example: use concrete examples first, then derive the result."
                      value={settings.profile}
                      maxLength={20000}
                      onChange={(e) => update({ profile: e.target.value })}
                    />
                  </label>
                </div>
                <h3>Five modes, one continuous session</h3>
                <p>
                  Learn follows an explanation, Explore follows your questions,
                  Deep Dive adds rigor, Practice offers exercises, and Review
                  revisits ideas. Switch modes at any time.
                </p>
              </>
            )}
            {tab === "Automation & updates" && (
              <Automation data={data} onChange={onChange} />
            )}
            {tab === "Data & privacy" && (
              <>
                <p>
                  Your sessions, notes, themes, and knowledge records are saved
                  in a local SQLite library.
                </p>
                <div className="settings-card">
                  <h3>Portable library</h3>
                  <p>
                    Exports include your learning content and appearance
                    settings. Credentials are always excluded.
                  </p>
                  <div className="button-row">
                    <button
                      onClick={() =>
                        run(async () => {
                          const ok = await invoke("data:export");
                          if (ok) setMessage("Library exported.");
                        })
                      }
                    >
                      Export library
                    </button>
                    <button
                      onClick={() =>
                        run(async () => {
                          const incoming = await invoke<StudioData | null>(
                            "data:import",
                          );
                          if (incoming) setConfirm(incoming);
                        })
                      }
                    >
                      Import library
                    </button>
                  </div>
                </div>
                <div className="settings-card">
                  <h3>Backup & restore</h3>
                  <p>
                    Make a consistent SQLite backup. A restore is reviewed
                    before replacing the current library.
                  </p>
                  <div className="button-row">
                    <button
                      onClick={() =>
                        run(async () => {
                          const ok = await invoke("data:backup");
                          if (ok) setMessage("SQLite backup saved.");
                        })
                      }
                    >
                      Create backup
                    </button>
                    <button
                      onClick={() =>
                        run(async () => {
                          const incoming = await invoke<RestorePreview | null>(
                            "data:restore",
                          );
                          if (incoming) setRestoreReview(incoming);
                        })
                      }
                    >
                      Restore backup
                    </button>
                  </div>
                </div>
                {restoreReview && (
                  <div
                    className="notice warning"
                    role="region"
                    aria-label="Review SQLite backup restoration"
                  >
                    <strong>Review backup before restoring</strong>
                    <p>
                      {restoreReview.filename}: {restoreReview.counts.subjects}{" "}
                      subjects, {restoreReview.counts.lessons} sessions,{" "}
                      {restoreReview.counts.concepts} subject concepts,{" "}
                      {restoreReview.counts.curriculumItems} curriculum items,{" "}
                      {restoreReview.counts.chapters} textbook chapters and{" "}
                      {restoreReview.counts.highlights} highlights.
                    </p>
                    <p>
                      The current library has not changed. Confirming will
                      replace its learning records and settings; a recovery
                      backup is created first. Active tutor replies must finish
                      or be canceled.
                    </p>
                    <div className="button-row">
                      <button
                        disabled={busy}
                        onClick={() =>
                          run(async () => {
                            await onRestore(restoreReview.token);
                            setRestoreReview(null);
                            setMessage(
                              "Backup restored. Its saved library is now open.",
                            );
                          })
                        }
                      >
                        Restore reviewed backup
                      </button>
                      <button
                        disabled={busy}
                        onClick={() =>
                          run(async () => {
                            await invoke("data:restore-cancel", {
                              token: restoreReview.token,
                            });
                            setRestoreReview(null);
                            setMessage(
                              "Restore canceled. Your current library is unchanged.",
                            );
                          })
                        }
                      >
                        Cancel restore
                      </button>
                    </div>
                  </div>
                )}
                {confirm && (
                  <div className="notice warning">
                    <strong>Review library replacement</strong>
                    <p>
                      Incoming: {confirm.lessons.length} sessions,{" "}
                      {confirm.concepts.length} concepts,{" "}
                      {confirm.library.length} library items. Current:{" "}
                      {data.lessons.length} sessions. Export a backup first if
                      needed.
                    </p>
                    <div className="button-row">
                      <button
                        onClick={() => {
                          onChange(confirm);
                          setConfirm(null);
                          setMessage("Library restored.");
                        }}
                      >
                        Replace current library
                      </button>
                      <button onClick={() => setConfirm(null)}>Cancel</button>
                    </div>
                  </div>
                )}
                <div className="settings-card">
                  <h3>What leaves this device</h3>
                  <p>
                    When you send a message, the active lesson conversation and
                    relevant knowledge records are sent to the explicitly
                    selected model provider. Enabled personalization adds your
                    optional preferences. Image searches send the search query
                    to Wikimedia Commons; structure requests send only public
                    accessions to RCSB or PubChem.
                  </p>
                  <p>
                    On Windows, account tokens are encrypted by Electron
                    safeStorage using Windows DPAPI. Model text, imported
                    documents, and visual specifications never execute as code.
                  </p>
                </div>
                <button
                  className="text-button"
                  onClick={() =>
                    run(async () =>
                      setMessage(
                        JSON.stringify(
                          await invoke("app:diagnostics"),
                          null,
                          2,
                        ),
                      ),
                    )
                  }
                >
                  Show technical diagnostics
                </button>
              </>
            )}
            {message && (
              <pre className="notice" role="status">
                {message}
              </pre>
            )}
          </div>
        </div>
      </section>
      {usageWelcome && (
        <div className="modal-backdrop" style={{ zIndex: 300 }}>
          <section
            className="new-session-modal"
            role="dialog"
            aria-modal="true"
            aria-label="ChatGPT plan usage"
          >
            <ShieldCheck size={30} />
            <h2>You’re using your ChatGPT plan</h2>
            <p>
              Eligible AI requests in Learning Studio use your ChatGPT plan
              allowance. Manage your plan and app limits in ChatGPT settings.
              Learning Studio never switches to paid API billing.
            </p>
            <div className="button-row">
              <button
                onClick={() =>
                  void invoke(
                    "external:open",
                    "https://chatgpt.com/settings/usage",
                  )
                }
              >
                Manage usage
                <ExternalLink size={14} />
              </button>
              <button
                className="primary"
                onClick={() => {
                  update({ planUsageAcknowledged: true });
                  setUsageWelcome(false);
                }}
              >
                Got it
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
