import {
  defaultTeachingPreferences,
  type TeachingPreferences as Preferences,
} from "../v21types";
export default function TeachingPreferences({
  value,
  onChange,
}: {
  value?: Preferences;
  onChange: (value: Preferences) => void;
}) {
  const settings = { ...defaultTeachingPreferences, ...value };
  return (
    <div className="typography-grid teaching-preferences">
      <label>
        Explanations
        <select
          aria-label="Default visual preference"
          value={settings.delivery}
          onChange={(e) =>
            onChange({
              ...settings,
              delivery: e.target.value as Preferences["delivery"],
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
          aria-label="Default question style"
          value={settings.practice}
          onChange={(e) =>
            onChange({
              ...settings,
              practice: e.target.value as Preferences["practice"],
            })
          }
        >
          <option value="mcq">Multiple choice</option>
          <option value="free-response">Free response</option>
          <option value="mixed">A mixture</option>
        </select>
      </label>
      <label>
        Optional checks
        <select
          aria-label="Default check frequency"
          value={settings.checkFrequency}
          onChange={(e) =>
            onChange({
              ...settings,
              checkFrequency: e.target.value as Preferences["checkFrequency"],
            })
          }
        >
          <option value="topic-end">At the end of a topic</option>
          <option value="occasionally">Occasionally</option>
          <option value="requested">Only when requested</option>
        </select>
      </label>
      <label>
        Sentence style
        <select
          aria-label="Default sentence style"
          value={settings.sentenceStyle}
          onChange={(e) =>
            onChange({
              ...settings,
              sentenceStyle: e.target.value as Preferences["sentenceStyle"],
            })
          }
        >
          <option value="clean">Clean and direct</option>
          <option value="conversational">Conversational</option>
          <option value="academic">Academic</option>
        </select>
      </label>
      <label className="check-row">
        <input
          type="checkbox"
          checked={settings.avoidEmDashes}
          onChange={(e) =>
            onChange({ ...settings, avoidEmDashes: e.target.checked })
          }
        />
        Avoid em dashes in explanations
      </label>
    </div>
  );
}
