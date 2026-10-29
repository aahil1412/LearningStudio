import { useEffect, useState } from "react";
import { Plus, Server, Cloud, Check, Pencil, Trash2 } from "lucide-react";
import { invoke } from "../lib/bridge";
import type {
  ModelProviderProfile,
  ProviderListing,
  ProviderSave,
} from "../providerTypes";
import UsageStatus from "./UsageStatus";
import "./provider-settings.css";

export default function ProviderSettings({
  onChanged,
}: {
  onChanged?: () => void | Promise<void>;
}) {
  const [listing, setListing] = useState<ProviderListing | null>(null),
    [draft, setDraft] = useState<ProviderSave | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  const refresh = async () =>
    setListing(await invoke<ProviderListing>("providers:list"));
  useEffect(() => {
    void refresh().catch(() =>
      setError("Provider settings are available in the desktop application."),
    );
  }, []);
  async function run(work: () => Promise<void>) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await work();
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }
  const local = draft
    ? (() => {
        try {
          const url = new URL(draft.baseUrl);
          return (
            url.hostname === "localhost" ||
            url.hostname === "[::1]" ||
            url.hostname.startsWith("127.")
          );
        } catch {
          return false;
        }
      })()
    : false;
  const edit = (profile: ModelProviderProfile) =>
    setDraft({
      id: profile.id,
      label: profile.label,
      kind: profile.kind as ProviderSave["kind"],
      baseUrl: profile.baseUrl || "",
      apiKey: "",
      externalConsent: profile.externalConsent,
    });
  return (
    <section
      className="provider-settings"
      aria-label="Model provider connections"
    >
      <header>
        <div>
          <span className="eyebrow">MODEL CONNECTIONS</span>
          <h3>Your AI providers</h3>
          <p>
            Keep using ChatGPT. Add a local or compatible server only when you
            choose.
          </p>
        </div>
        <button
          disabled={busy}
          onClick={() =>
            setDraft({
              label: "Local Ollama",
              kind: "ollama",
              baseUrl: "http://127.0.0.1:11434",
              apiKey: "",
              externalConsent: false,
            })
          }
        >
          <Plus size={15} /> Add provider
        </button>
      </header>
      {error && (
        <p className="notice warning" role="alert">
          {error}
        </p>
      )}
      {message && (
        <p role="status" className="notice">
          {message}
        </p>
      )}
      <div className="provider-profile-list">
        {listing?.profiles.map((profile) => (
          <article
            key={profile.id}
            className={listing.activeId === profile.id ? "is-active" : ""}
          >
            <div className="provider-profile-icon">
              {profile.kind === "ollama" ? (
                <Server size={19} />
              ) : (
                <Cloud size={19} />
              )}
            </div>
            <div className="provider-profile-info">
              <strong>{profile.label}</strong>
              <span>
                {profile.kind === "chatgpt"
                  ? "Eligible ChatGPT subscription"
                  : profile.baseUrl}
              </span>
              <small>
                {profile.kind === "chatgpt"
                  ? "No API key or alternative billing required"
                  : profile.kind === "ollama"
                    ? "Your installed local server; no model is downloaded by Learning Studio"
                    : profile.hasKey
                      ? "Provider key is stored using protected Windows storage"
                      : "Configure this server's own key if required"}
              </small>
            </div>
            <div className="provider-profile-actions">
              <button
                disabled={busy || listing.activeId === profile.id}
                aria-label={`Use ${profile.label}`}
                onClick={() =>
                  void run(async () => {
                    setListing(
                      await invoke<ProviderListing>("providers:select", {
                        id: profile.id,
                      }),
                    );
                    await onChanged?.();
                    setMessage(
                      `Using ${profile.label}. Refresh and choose an available model for each task.`,
                    );
                  })
                }
              >
                {listing.activeId === profile.id ? (
                  <>
                    <Check size={14} /> Active
                  </>
                ) : (
                  "Use provider"
                )}
              </button>
              {profile.kind !== "chatgpt" && (
                <>
                  <button
                    aria-label={`Edit ${profile.label}`}
                    disabled={busy}
                    onClick={() => edit(profile)}
                  >
                    <Pencil size={14} />
                  </button>
                  <button
                    aria-label={`Remove ${profile.label}`}
                    title={
                      listing.activeId === profile.id
                        ? "Choose another provider before removing the active connection"
                        : "Remove connection"
                    }
                    disabled={busy || listing.activeId === profile.id}
                    onClick={() =>
                      void run(async () => {
                        setListing(
                          await invoke<ProviderListing>("providers:delete", {
                            id: profile.id,
                          }),
                        );
                        await onChanged?.();
                        setMessage(
                          "Provider configuration and its stored key were removed. Learning data is unchanged.",
                        );
                      })
                    }
                  >
                    <Trash2 size={14} />
                  </button>
                </>
              )}
            </div>
          </article>
        ))}
      </div>
      {draft && (
        <form
          className="provider-config-form"
          onSubmit={(event) => {
            event.preventDefault();
            void run(async () => {
              setListing(
                await invoke<ProviderListing>("providers:save", draft),
              );
              setDraft(null);
              await onChanged?.();
              setMessage(
                "Provider saved. Select it explicitly to use it; no inference request was sent.",
              );
            });
          }}
        >
          <h4>{draft.id ? "Edit provider" : "Add an optional connection"}</h4>
          <div className="provider-form-grid">
            <label>
              Connection name
              <input
                aria-label="Provider connection name"
                required
                maxLength={80}
                value={draft.label}
                onChange={(event) =>
                  setDraft({ ...draft, label: event.target.value })
                }
              />
            </label>
            <label>
              Protocol
              <select
                aria-label="Provider protocol"
                value={draft.kind}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    kind: event.target.value as ProviderSave["kind"],
                    baseUrl:
                      event.target.value === "ollama"
                        ? "http://127.0.0.1:11434"
                        : "https://api.openai.com/v1",
                    externalConsent: false,
                  })
                }
              >
                <option value="ollama">Local Ollama</option>
                <option value="openai-compatible">
                  OpenAI-compatible server
                </option>
              </select>
            </label>
          </div>
          <label>
            Server base URL
            <input
              aria-label="Provider server URL"
              required
              type="url"
              maxLength={500}
              value={draft.baseUrl}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  baseUrl: event.target.value,
                  externalConsent: false,
                })
              }
            />
          </label>
          <p className="provider-help">
            {draft.kind === "ollama"
              ? "Run your own Ollama server and install a suitable model separately. Learning Studio does not install, launch or download one. Only loopback addresses are accepted."
              : "Use the server's API base, usually ending in /v1. LM Studio and other local compatible servers can use a loopback HTTP URL. Remote servers require HTTPS and separate provider access."}
          </p>
          {draft.kind === "openai-compatible" && (
            <>
              <label>
                Provider API key
                <input
                  aria-label="Provider API key"
                  autoComplete="off"
                  type="password"
                  value={draft.apiKey || ""}
                  placeholder={
                    draft.id
                      ? "Leave empty to keep the stored key"
                      : "Optional for a local server"
                  }
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      apiKey: event.target.value,
                      clearKey: false,
                    })
                  }
                />
              </label>
              {draft.id && (
                <label className="provider-check">
                  <input
                    type="checkbox"
                    checked={draft.clearKey === true}
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        clearKey: event.target.checked,
                        apiKey: "",
                      })
                    }
                  />{" "}
                  Remove the previously stored key
                </label>
              )}
            </>
          )}
          {!local && (
            <label className="provider-check provider-consent">
              <input
                aria-label="Consent to external provider billing and data transfer"
                type="checkbox"
                required
                checked={draft.externalConsent === true}
                onChange={(event) =>
                  setDraft({ ...draft, externalConsent: event.target.checked })
                }
              />
              <span>
                I choose to send learning context to this external provider and
                understand it may bill separately. My ChatGPT subscription and
                credentials will not be used for this connection.
              </span>
            </label>
          )}
          <div className="button-row">
            <button type="submit" className="primary" disabled={busy}>
              {busy ? "Saving connection…" : "Save connection"}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => setDraft(null)}
            >
              Cancel
            </button>
          </div>
        </form>
      )}
      <p className="provider-no-fallback">
        No automatic fallback: an unavailable model leaves the lesson saved and
        asks you to choose another connection explicitly.
      </p>
      <UsageStatus />
    </section>
  );
}
