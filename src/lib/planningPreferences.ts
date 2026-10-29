import type { ModelInfo, StudioSettings, TaskSettings } from "../types";

/** Planning has its own latency/cost preference and never changes the tutor. */
export function resolvePlanningPreference(
  settings: StudioSettings,
  models: ModelInfo[],
): TaskSettings {
  const configured = settings.planning;
  const modelId = configured?.model || settings.models.tutor.model;
  const model = modelId
    ? models.find((item) => item.id === modelId)
    : models[0];
  if (!model)
    throw new Error(
      "The selected planning model is unavailable. Refresh models in Settings and choose an available planning model.",
    );
  const reasoning = configured?.reasoning;
  if (reasoning && !model.reasoningLevels.includes(reasoning))
    throw new Error(
      "The selected planning model does not support this reasoning level. Update Planning in Settings before retrying.",
    );
  return {
    model: model.id,
    reasoning: configured
      ? configured.reasoning
      : ["medium", "low"].find((level) =>
          model.reasoningLevels.includes(level),
        ) ||
        model.reasoningLevels[0] ||
        "",
  };
}
