import type { StudioSettings } from "../types";
/** Keep per-task choices separate when the learner explicitly changes source.
 * This contains model identifiers only; provider secrets never enter SQLite. */
export function selectProviderPreferences(
  settings: StudioSettings,
  providerId: string,
): StudioSettings {
  const previous = settings.modelProfileId || "chatgpt";
  if (previous === providerId) return settings;
  const profiles = {
    ...settings.modelProfiles,
    [previous]: { models: settings.models, planning: settings.planning },
  };
  const selected = profiles[providerId];
  return {
    ...settings,
    modelProfileId: providerId,
    modelProfiles: Object.fromEntries(Object.entries(profiles).slice(-40)),
    models: selected?.models || {
      tutor: { model: "", reasoning: "" },
      visual: { model: "", reasoning: "" },
      review: { model: "", reasoning: "" },
    },
    planning: selected?.planning,
  };
}
