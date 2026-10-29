import { useState, useRef, useEffect, type CSSProperties } from "react";
import Markdown from "./Markdown";
import {
  Download,
  Upload,
  RotateCcw,
  Copy,
  Save,
  Sun,
  Moon,
  Monitor,
  Check,
  BookOpen,
  X,
} from "lucide-react";
import {
  colorGroups,
  presets,
  defaultAppearance,
  contrast,
  sanitizeAppearance,
  type Appearance as AppearanceData,
  type Typography,
} from "../lib/themes";
type Props = {
  value: AppearanceData;
  onChange: (value: AppearanceData) => void;
  initialSection?: string;
};
function HexInput({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return (
    <input
      id={id}
      aria-label={label + " hex"}
      aria-invalid={!/^#[\da-f]{6}$/i.test(draft)}
      value={draft}
      maxLength={7}
      onChange={(e) => {
        setDraft(e.target.value);
        if (/^#[\da-f]{6}$/i.test(e.target.value)) onChange(e.target.value);
      }}
      onBlur={() => {
        if (!/^#[\da-f]{6}$/i.test(draft)) setDraft(value);
      }}
      onFocus={(e) => e.target.select()}
    />
  );
}
export default function Appearance({
  value,
  onChange,
  initialSection = "Presets",
}: Props) {
  const [tab, setTab] = useState(initialSection);
  const [name, setName] = useState("My custom theme");
  const [error, setError] = useState("");
  const [previewOpen, setPreviewOpen] = useState(false);
  const importRef = useRef<HTMLInputElement>(null);
  const scheme = value.editing,
    config = value[scheme],
    all = [...presets, ...value.saved];
  const update = (patch: Partial<typeof config>) =>
    onChange({ ...value, [scheme]: { ...config, ...patch } });
  const choose = (id: string) => {
    const p = all.find((p) => p.id === id);
    if (p)
      onChange({
        ...value,
        editing: p.scheme,
        mode: value.mode === "system" ? "system" : p.scheme,
        [p.scheme]: {
          presetId: p.id,
          colors: { ...p.colors },
          typography: { ...(p.typography || config.typography) },
        },
      });
  };
  const save = (duplicate = false) => {
    const existing = value.saved.find((p) => p.id === config.presetId);
    const id = existing && !duplicate ? existing.id : crypto.randomUUID();
    const p = {
      id,
      name: name.trim() || "Untitled theme",
      scheme,
      colors: { ...config.colors },
      typography: { ...config.typography },
      custom: true,
    };
    onChange({
      ...value,
      saved: [...value.saved.filter((p) => p.id !== id), p],
      [scheme]: { ...config, presetId: id },
    });
  };
  const warnings = Object.entries({
    text: "Body text",
    bold: "Bold text",
    italic: "Italic text",
    heading: "Headings",
    math: "Mathematics",
    muted: "Muted text",
  }).filter(
    ([key]) => contrast(config.colors[key], config.colors.reading) < 4.5,
  );
  const t = config.typography;
  const previewStyle = {
    ...Object.fromEntries(
      Object.entries(config.colors).map(([key, color]) => ["--" + key, color]),
    ),
    "--reading-font": t.readingFont,
    "--math-font": t.mathFont,
    "--reading-size": `${t.size}px`,
    "--heading-scale": String(t.headingScale),
    "--heading-weight": String(t.headingWeight),
    "--bold-weight": String(t.boldWeight),
    "--line-height": String(t.lineHeight),
    "--letter-spacing": `${t.letterSpacing}px`,
    "--paragraph-spacing": `${t.paragraphSpacing}em`,
  } as CSSProperties;
  return (
    <section className="appearance-panel appearance-workspace">
      <div className="appearance-controls">
        <div className="section-heading">
          <div>
            <h3>Your reading environment</h3>
            <p>Choose a starting palette, then make every detail yours.</p>
          </div>
          <div className="button-row">
            <button
              className="appearance-preview-toggle"
              aria-pressed={previewOpen}
              onClick={() => setPreviewOpen(!previewOpen)}
            >
              <BookOpen size={16} />
              Preview
            </button>
            <button
              onClick={() => {
                const blob = new Blob([JSON.stringify(value, null, 2)], {
                  type: "application/json",
                });
                const a = document.createElement("a");
                a.href = URL.createObjectURL(blob);
                a.download = "learning-studio-themes.json";
                a.click();
                URL.revokeObjectURL(a.href);
              }}
            >
              <Download size={16} />
              Export
            </button>
            <button onClick={() => importRef.current?.click()}>
              <Upload size={16} />
              Import
            </button>
            <input
              ref={importRef}
              hidden
              type="file"
              accept=".json"
              onChange={async (e) => {
                try {
                  const file = e.target.files?.[0];
                  if (file) {
                    if (file.size > 1_000_000)
                      throw new Error("Theme file is too large.");
                    onChange(sanitizeAppearance(JSON.parse(await file.text())));
                    setError("");
                  }
                } catch {
                  setError(
                    "This theme file could not be read. Choose a valid theme JSON file.",
                  );
                }
                e.target.value = "";
              }}
            />
          </div>
        </div>
        <div className="appearance-modes">
          {(
            [
              { id: "light", label: "Light", Icon: Sun },
              { id: "dark", label: "Dark", Icon: Moon },
              { id: "system", label: "System", Icon: Monitor },
            ] as const
          ).map(({ id, label, Icon }) => (
            <button
              key={id}
              aria-pressed={value.mode === id}
              className={value.mode === id ? "active" : ""}
              onClick={() =>
                onChange({
                  ...value,
                  mode: id,
                  editing: id === "system" ? value.editing : id,
                })
              }
            >
              <Icon size={19} />
              {label}
            </button>
          ))}
        </div>
        <div className="settings-note">
          Light and dark keep independent colors and typography. System follows
          Windows appearance automatically.
        </div>
        <div className="button-row edit-scheme">
          <span>Editing palette</span>
          <button
            aria-pressed={scheme === "light"}
            className={scheme === "light" ? "active" : ""}
            onClick={() =>
              onChange({
                ...value,
                editing: "light",
                mode: value.mode === "system" ? "system" : "light",
              })
            }
          >
            Light
          </button>
          <button
            aria-pressed={scheme === "dark"}
            className={scheme === "dark" ? "active" : ""}
            onClick={() =>
              onChange({
                ...value,
                editing: "dark",
                mode: value.mode === "system" ? "system" : "dark",
              })
            }
          >
            Dark
          </button>
        </div>
        <nav className="tabs">
          {["Presets", "Colors", "Typography"].map((t) => (
            <button
              key={t}
              aria-pressed={tab === t}
              className={tab === t ? "active" : ""}
              onClick={() => setTab(t)}
            >
              {t}
            </button>
          ))}
        </nav>
        {tab === "Presets" && (
          <>
            <div className="preset-grid">
              {all
                .filter((p) => p.scheme === scheme)
                .map((p) => (
                  <button
                    key={p.id}
                    className={
                      "preset " + (config.presetId === p.id ? "active" : "")
                    }
                    aria-pressed={config.presetId === p.id}
                    onClick={() => {
                      choose(p.id);
                      setName(p.name);
                    }}
                  >
                    <span
                      className="preset-swatch"
                      style={{ background: p.colors.bg, color: p.colors.text }}
                    >
                      <span style={{ color: p.colors.accent }}>Aa</span>
                      <i
                        style={{
                          background: p.colors.surface,
                          borderColor: p.colors.border,
                        }}
                      />
                      <i style={{ background: p.colors.accent }} />
                    </span>
                    <span className="preset-title">
                      <strong>{p.name}</strong>
                      {config.presetId === p.id && (
                        <Check size={15} aria-hidden="true" />
                      )}
                    </span>
                    <small>
                      {p.custom
                        ? "Custom palette"
                        : p.scheme === "light"
                          ? "Soft light"
                          : "Comfortable dark"}
                    </small>
                  </button>
                ))}
            </div>
            <div className="settings-card">
              <h3>Save your palette</h3>
              <p>
                Keep a new preset, or rename and update the selected custom one.
              </p>
              <div className="button-row">
                <input
                  aria-label="Preset name"
                  value={name}
                  maxLength={80}
                  onChange={(e) => setName(e.target.value)}
                />
                <button onClick={() => save()}>
                  <Save size={16} />
                  Save preset
                </button>
                <button onClick={() => save(true)}>
                  <Copy size={16} />
                  Duplicate
                </button>
              </div>
            </div>
          </>
        )}
        {tab === "Colors" && (
          <div>
            {Object.entries(colorGroups).map(([group, entries]) => (
              <div className="settings-card" key={group}>
                <h3>{group}</h3>
                <div className="color-grid">
                  {Object.entries(entries).map(([key, label]) => (
                    <div className="color-field" key={key}>
                      <label htmlFor={"color-" + key}>{label}</label>
                      <div>
                        <input
                          aria-label={label + " color picker"}
                          type="color"
                          value={config.colors[key]}
                          onChange={(e) =>
                            update({
                              colors: {
                                ...config.colors,
                                [key]: e.target.value,
                              },
                            })
                          }
                        />
                        <HexInput
                          id={"color-" + key}
                          label={label}
                          value={config.colors[key]}
                          onChange={(value) =>
                            update({
                              colors: { ...config.colors, [key]: value },
                            })
                          }
                        />
                        <button
                          className="icon-button"
                          aria-label={"Reset " + label}
                          onClick={() =>
                            update({
                              colors: {
                                ...config.colors,
                                [key]: (
                                  all.find((p) => p.id === config.presetId) ||
                                  presets.find((p) => p.scheme === scheme)!
                                ).colors[key],
                              },
                            })
                          }
                        >
                          <RotateCcw size={13} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
        {tab === "Typography" && (
          <div className="settings-card">
            <h3>Type & rhythm</h3>
            <div className="typography-grid">
              {(
                [
                  {
                    key: "readingFont",
                    label: "Reading font",
                    options: [
                      [
                        'Inter, "Segoe UI", Arial, sans-serif',
                        "Studio · Inter (bundled)",
                      ],
                      ['"Segoe UI", Arial, sans-serif', "Clear · Segoe UI"],
                      ["Georgia, serif", "Literary · Georgia"],
                      ['"Segoe UI", sans-serif', "Humanist · Segoe UI"],
                      ["Cambria, serif", "Classic · Cambria"],
                      ["Consolas, monospace", "Monospace · Consolas"],
                    ],
                  },
                  {
                    key: "uiFont",
                    label: "Interface font",
                    options: [
                      ['Inter, "Segoe UI", sans-serif', "Inter (bundled)"],
                      ['"Segoe UI", sans-serif', "Segoe UI"],
                      ["Arial, sans-serif", "Arial"],
                      ["Verdana, sans-serif", "Verdana"],
                    ],
                  },
                  {
                    key: "mathFont",
                    label: "Mathematical text font",
                    options: [
                      ["KaTeX_Main", "KaTeX default"],
                      ["KaTeX_SansSerif", "KaTeX sans serif"],
                    ],
                  },
                ] as const
              ).map((f) => (
                <label key={f.key}>
                  {f.label}
                  <select
                    value={config.typography[f.key]}
                    onChange={(e) =>
                      update({
                        typography: {
                          ...config.typography,
                          [f.key]: e.target.value,
                        },
                      })
                    }
                  >
                    {f.options.map(([v, l]) => (
                      <option key={v} value={v}>
                        {l}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
              {(
                [
                  {
                    key: "size",
                    label: "Reading size",
                    min: 13,
                    max: 28,
                    step: 1,
                    unit: "px",
                  },
                  {
                    key: "headingScale",
                    label: "Heading scale",
                    min: 1.1,
                    max: 2.4,
                    step: 0.1,
                    unit: "×",
                  },
                  {
                    key: "headingWeight",
                    label: "Heading weight",
                    min: 300,
                    max: 900,
                    step: 100,
                    unit: "",
                  },
                  {
                    key: "boldWeight",
                    label: "Bold weight",
                    min: 400,
                    max: 900,
                    step: 100,
                    unit: "",
                  },
                  {
                    key: "lineHeight",
                    label: "Line height",
                    min: 1.25,
                    max: 2.4,
                    step: 0.05,
                    unit: "×",
                  },
                  {
                    key: "letterSpacing",
                    label: "Letter spacing",
                    min: -0.5,
                    max: 2,
                    step: 0.1,
                    unit: "px",
                  },
                  {
                    key: "paragraphSpacing",
                    label: "Paragraph spacing",
                    min: 0.5,
                    max: 2.5,
                    step: 0.1,
                    unit: "em",
                  },
                  {
                    key: "readingWidth",
                    label: "Reading column",
                    min: 480,
                    max: 1100,
                    step: 20,
                    unit: "px",
                  },
                ] as const
              ).map((f) => (
                <label key={f.key}>
                  {f.label}
                  <span className="range-value">
                    {Number(config.typography[f.key]).toFixed(
                      f.step < 1 ? 2 : 0,
                    )}
                    {f.unit}
                  </span>
                  <input
                    aria-label={f.label}
                    type="range"
                    min={f.min}
                    max={f.max}
                    step={f.step}
                    value={config.typography[f.key]}
                    onChange={(e) =>
                      update({
                        typography: {
                          ...config.typography,
                          [f.key as keyof Typography]: Number(e.target.value),
                        },
                      })
                    }
                  />
                </label>
              ))}
            </div>
            <p className="muted">
              KaTeX symbol and layout fonts remain bundled for reliable
              notation.
            </p>
          </div>
        )}
        {warnings.length > 0 && (
          <p className="notice warning" role="status">
            Contrast below 4.5:1 for{" "}
            {warnings.map(([, label]) => label).join(", ")} against the reading
            background.
          </p>
        )}
        {error && (
          <p role="alert" className="notice error">
            {error}
          </p>
        )}
        <button
          className="text-button"
          onClick={() =>
            onChange({ ...value, [scheme]: defaultAppearance()[scheme] })
          }
        >
          <RotateCcw size={15} />
          Restore {scheme} defaults
        </button>
      </div>
      <aside
        className={`appearance-preview-panel ${previewOpen ? "preview-open" : ""}`}
        aria-label="Live appearance preview"
      >
        <div className="appearance-preview-heading">
          <BookOpen size={17} />
          <strong>Reading preview</strong>
          <span>{scheme === "light" ? "Light" : "Dark"} palette</span>
          <button
            className="appearance-preview-close"
            aria-label="Close appearance preview"
            onClick={() => setPreviewOpen(false)}
          >
            <X size={17} />
          </button>
        </div>
        <div className="theme-preview reading" style={previewStyle}>
          <div className="preview-document-line" />
          <h2>A lesson in focus.</h2>
          <p>
            A useful explanation connects <strong>precise ideas</strong> with{" "}
            <em>intuitive examples</em>.
          </p>
          <p>
            Follow a connection, ask a question, and explore at your own pace.
          </p>
          <Markdown text={"$$\\int_0^1 x\\,dx = \\frac{1}{2}$$"} />
          <a href="#" onClick={(event) => event.preventDefault()}>
            Explore a related idea
          </a>
          <pre>
            <code>{"const square = x => x * x;"}</code>
          </pre>
          <p className="preview-caption">
            Your colors and reading typography update here immediately.
          </p>
        </div>
        <p className="appearance-preview-note">
          Changes apply immediately. Your light and dark configurations stay
          independent.
        </p>
      </aside>
    </section>
  );
}
