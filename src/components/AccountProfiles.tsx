import { useEffect, useState } from "react";
import { invoke } from "../lib/bridge";
export default function AccountProfiles({
  onSelected,
}: {
  onSelected: () => Promise<void>;
}) {
  const [profiles, setProfiles] = useState<{
      active: string;
      profiles: { id: string; label: string }[];
    }>({ active: "", profiles: [] }),
    [label, setLabel] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const refresh = async () => setProfiles(await invoke("auth:profiles"));
  useEffect(() => {
    void refresh().catch(() => {});
  }, []);
  const run = async (action: string, payload: unknown) => {
    setBusy(true);
    setError("");
    try {
      await invoke(action, payload);
      await refresh();
      await onSelected();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "The profile could not be updated.",
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="settings-card">
      <h3>Account profiles</h3>
      <p>
        Keep separate protected ChatGPT registrations. Switching profiles
        cancels active model requests; learning data stays in this library.
      </p>
      <label>
        Active account
        <select
          aria-label="Account profile"
          value={profiles.active}
          disabled={busy}
          onChange={(e) =>
            void run("auth:select-profile", { id: e.target.value })
          }
        >
          {profiles.profiles.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
      </label>
      <div className="button-row" style={{ marginTop: 12 }}>
        <input
          aria-label="Account profile label"
          value={label}
          maxLength={100}
          placeholder="Profile name"
          onChange={(e) => setLabel(e.target.value)}
        />
        <button
          disabled={busy || !label.trim()}
          onClick={() => void run("auth:create-profile", { label })}
        >
          Add account
        </button>
        <button
          disabled={busy || !label.trim()}
          onClick={() =>
            void run("auth:rename-profile", { id: profiles.active, label })
          }
        >
          Rename
        </button>
      </div>
      <p className="muted">
        After adding an account, choose Continue with ChatGPT to authorize it.
        Existing browser or other application credentials are never imported.
      </p>
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
