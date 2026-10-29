import type { TeachingPreferences } from "../../v21types";
export default function LearningPreferences({
  value,
  onChange,
  compact = false,
}: {
  value: TeachingPreferences;
  onChange: (value: TeachingPreferences) => void;
  compact?: boolean;
}) {
  return (
    <div className="learning-preferences">
      <div className="v2-form-grid">
        <label>
          Explanation style
          <select
            aria-label="Explanation delivery"
            value={value.delivery}
            onChange={(event) =>
              onChange({
                ...value,
                delivery: event.target.value as TeachingPreferences["delivery"],
              })
            }
          >
            <option value="visual-first">Visual first</option>
            <option value="balanced">Balanced</option>
            <option value="text-first">Text first</option>
          </select>
        </label>
        <label>
          Practice format
          <select
            aria-label="Practice format"
            value={value.practice}
            onChange={(event) =>
              onChange({
                ...value,
                practice: event.target.value as TeachingPreferences["practice"],
              })
            }
          >
            <option value="mcq">Multiple choice</option>
            <option value="free-response">Free response and derivations</option>
            <option value="mixed">A mix of formats</option>
          </select>
        </label>
        <label>
          Understanding checks
          <select
            aria-label="Understanding check frequency"
            value={value.checkFrequency}
            onChange={(event) =>
              onChange({
                ...value,
                checkFrequency: event.target
                  .value as TeachingPreferences["checkFrequency"],
              })
            }
          >
            <option value="topic-end">At the end of a topic</option>
            <option value="occasionally">Occasionally</option>
            <option value="requested">Only when I ask</option>
          </select>
        </label>
        {!compact && (
          <label>
            Sentence style
            <select
              aria-label="Sentence style"
              value={value.sentenceStyle}
              onChange={(event) =>
                onChange({
                  ...value,
                  sentenceStyle: event.target
                    .value as TeachingPreferences["sentenceStyle"],
                })
              }
            >
              <option value="clean">Clean and direct</option>
              <option value="conversational">Conversational</option>
              <option value="academic">Academic</option>
            </select>
          </label>
        )}
      </div>
      {!compact && (
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={value.avoidEmDashes}
            onChange={(event) =>
              onChange({ ...value, avoidEmDashes: event.target.checked })
            }
          />{" "}
          Use clean sentences without em dashes
        </label>
      )}
    </div>
  );
}
