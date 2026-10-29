export const colorGroups = {
  Backgrounds: {
    bg: "Application",
    sidebar: "Sidebar",
    reading: "Lesson reading",
    surface: "Cards & surfaces",
    input: "Input fields",
    popover: "Popovers & dialogs",
    codeBg: "Code blocks",
    figure: "Visualizations",
  },
  Text: {
    text: "Body text",
    secondary: "Secondary text",
    muted: "Muted text",
    bold: "Bold text",
    italic: "Italic text",
    heading: "Headings",
    link: "Links",
    math: "Mathematical text",
    code: "Code text",
    caption: "Captions",
    selectionText: "Selected text",
    highlightText: "Highlighted text",
  },
  Interface: {
    accent: "Primary accent",
    accent2: "Secondary accent",
    border: "Borders",
    divider: "Dividers",
    button: "Buttons",
    hover: "Hover states",
    selected: "Selected items",
    focus: "Focus indicators",
    success: "Success",
    warning: "Warning",
    danger: "Error",
    selection: "Selection background",
    highlight: "Highlight background",
  },
};
export type Colors = Record<string, string>;
export type Typography = {
  readingFont: string;
  uiFont: string;
  mathFont: string;
  size: number;
  headingScale: number;
  headingWeight: number;
  boldWeight: number;
  lineHeight: number;
  letterSpacing: number;
  paragraphSpacing: number;
  readingWidth: number;
};
export type ThemeConfig = {
  presetId: string;
  colors: Colors;
  typography: Typography;
};
export type Preset = {
  id: string;
  name: string;
  scheme: "light" | "dark";
  colors: Colors;
  typography?: Typography;
  custom?: boolean;
};
export type Appearance = {
  typographyVersion?: 2;
  /** Marks the one-time default visual identity upgrade, without changing SQL. */
  studioVersion?: 3 | 4;
  mode: "light" | "dark" | "system";
  editing: "light" | "dark";
  light: ThemeConfig;
  dark: ThemeConfig;
  saved: Preset[];
};
const typography: Typography = {
  readingFont: 'Inter, "Segoe UI", Arial, sans-serif',
  uiFont: 'Inter, "Segoe UI", sans-serif',
  mathFont: "KaTeX_Main",
  size: 18,
  headingScale: 1.6,
  headingWeight: 600,
  boldWeight: 700,
  lineHeight: 1.7,
  letterSpacing: 0,
  paragraphSpacing: 1.2,
  readingWidth: 760,
};
function palette(
  bg: string,
  surface: string,
  text: string,
  accent: string,
  dark: boolean,
  bold?: string,
  italic?: string,
): Colors {
  return {
    bg,
    sidebar: surface,
    reading: bg,
    surface,
    input: surface,
    popover: surface,
    codeBg: dark ? "#242927" : "#e0e3dc",
    figure: surface,
    text,
    secondary: dark ? "#c0c6bc" : "#62695e",
    muted: dark ? "#a6afa2" : "#5c6355",
    bold: bold || text,
    italic: italic || (dark ? "#c6b8a6" : "#746354"),
    heading: text,
    link: accent,
    math: text,
    code: dark ? "#c4d9bd" : "#354f3e",
    caption: dark ? "#b6bdae" : "#656c5d",
    selectionText: dark ? "#18201a" : "#f7f5ee",
    highlightText: text,
    accent,
    accent2: dark ? "#c8ae88" : "#9b7148",
    border: dark ? "#4a5045" : "#d6d7ca",
    divider: dark ? "#41473d" : "#dedfd3",
    button: dark ? "#a8c49b" : "#425e46",
    hover: dark ? "#3e473b" : "#e4e8da",
    selected: dark ? "#414f3c" : "#dce5d2",
    focus: accent,
    success: dark ? "#b4d5a0" : "#426c3d",
    warning: dark ? "#ebc27b" : "#866015",
    danger: dark ? "#f0aba0" : "#9d4036",
    selection: dark ? "#b4d0a3" : "#52684d",
    highlight: dark ? "#5d5334" : "#eee0ad",
  };
}
/** Independent, original defaults for the redesigned workspace. Existing
 * palettes remain available; these do not borrow legacy sage/brown UI colors. */
const previousStudioLightPreset: Preset = {
  id: "studio-light",
  name: "Studio Light",
  scheme: "light",
  colors: {
    bg: "#f2f4f8",
    sidebar: "#e8edf5",
    reading: "#fbfcff",
    surface: "#f7f9fc",
    input: "#fbfcff",
    popover: "#fbfcff",
    codeBg: "#e9edf6",
    figure: "#f7f9ff",
    text: "#172235",
    secondary: "#48566c",
    muted: "#58677c",
    bold: "#102144",
    italic: "#394969",
    heading: "#12213b",
    link: "#3659c5",
    math: "#1c2d4a",
    code: "#27437c",
    caption: "#52617a",
    selectionText: "#ffffff",
    highlightText: "#34270b",
    accent: "#4566dd",
    accent2: "#23766f",
    border: "#c9d2e2",
    divider: "#dde3ed",
    button: "#3656c5",
    hover: "#e9eefc",
    selected: "#e3eafd",
    focus: "#3656c5",
    success: "#246b4e",
    warning: "#805208",
    danger: "#b33747",
    selection: "#3656c5",
    highlight: "#f1dfae",
  },
};
const previousStudioDarkPreset: Preset = {
  id: "studio-dark",
  name: "Studio Dark",
  scheme: "dark",
  colors: {
    bg: "#101722",
    sidebar: "#121c29",
    reading: "#151f2e",
    surface: "#192537",
    input: "#101b2b",
    popover: "#1c293c",
    codeBg: "#101927",
    figure: "#121e2d",
    text: "#e5ecf8",
    secondary: "#b5c2d7",
    muted: "#a5b4cd",
    bold: "#f0f5ff",
    italic: "#bdcce5",
    heading: "#f0f5ff",
    link: "#9ab6ff",
    math: "#e6eefc",
    code: "#abc5ff",
    caption: "#a9bad5",
    selectionText: "#101722",
    highlightText: "#f2df9f",
    accent: "#9ab6ff",
    accent2: "#7bc5bd",
    border: "#34435a",
    divider: "#29384d",
    button: "#9ab6ff",
    hover: "#22334b",
    selected: "#253d63",
    focus: "#bad0ff",
    success: "#90d6b0",
    warning: "#edc585",
    danger: "#ffa9b8",
    selection: "#9ab6ff",
    highlight: "#53441e",
  },
};
export const studioLightPreset: Preset = {
  ...previousStudioLightPreset,
  colors: {
    bg: "#EEF2EC",
    sidebar: "#E9F0E8",
    reading: "#FDFEF9",
    surface: "#F5F8F1",
    input: "#FDFEF9",
    popover: "#FDFEF9",
    codeBg: "#E8F0E7",
    figure: "#F6FAF3",
    text: "#1C3028",
    secondary: "#4C6356",
    muted: "#506454",
    bold: "#142D23",
    italic: "#4C6557",
    heading: "#15362A",
    link: "#176858",
    math: "#20382D",
    code: "#225A43",
    caption: "#506454",
    selectionText: "#FFFFFF",
    highlightText: "#362810",
    accent: "#1B6D56",
    accent2: "#BA5839",
    border: "#C8D5C7",
    divider: "#DCE5D8",
    button: "#1B5C48",
    hover: "#E3EFE2",
    selected: "#D8EAD6",
    focus: "#176858",
    success: "#286A41",
    warning: "#805B16",
    danger: "#AC3938",
    selection: "#1B5C48",
    highlight: "#F0E2AA",
  },
};
export const studioDarkPreset: Preset = {
  ...previousStudioDarkPreset,
  colors: {
    bg: "#102019",
    sidebar: "#13291F",
    reading: "#182E23",
    surface: "#1C3428",
    input: "#11271C",
    popover: "#223D2D",
    codeBg: "#102318",
    figure: "#1C3325",
    text: "#E6F0E1",
    secondary: "#BED0B9",
    muted: "#AABC9E",
    bold: "#EFF6E9",
    italic: "#B8CFAD",
    heading: "#F0F6E9",
    link: "#A2D8B2",
    math: "#E7F0DF",
    code: "#B6DEC0",
    caption: "#B1C8A6",
    selectionText: "#14271B",
    highlightText: "#F0E1AD",
    accent: "#A9DCB9",
    accent2: "#EEAA82",
    border: "#415D45",
    divider: "#304B35",
    button: "#ADDDBA",
    hover: "#294A32",
    selected: "#28472F",
    focus: "#BBE7C4",
    success: "#A0D8A9",
    warning: "#E5C47D",
    danger: "#F2AAA0",
    selection: "#ADDDBA",
    highlight: "#5B522D",
  },
};
export const presets: Preset[] = [
  studioLightPreset,
  studioDarkPreset,
  {
    id: "gentle-sage",
    name: "Gentle Sage",
    scheme: "light",
    colors: palette("#f0f1e8", "#f7f7ef", "#303b2e", "#536e45", false),
  },
  {
    id: "warm-beige",
    name: "Warm Beige",
    scheme: "light",
    colors: palette(
      "#e8e0d5",
      "#f1eae1",
      "#352f2b",
      "#72553e",
      false,
      "#684637",
      "#746354",
    ),
  },
  {
    id: "muted-peach",
    name: "Muted Peach",
    scheme: "light",
    colors: palette("#f2e5dc", "#f9eee7", "#443730", "#9a6350", false),
  },
  {
    id: "soft-ivory",
    name: "Soft Ivory",
    scheme: "light",
    colors: palette("#f5f2e8", "#fcf8ef", "#35382e", "#67764b", false),
  },
  {
    id: "sandstone",
    name: "Sandstone",
    scheme: "light",
    colors: palette("#e9e3d5", "#f5efdf", "#403b30", "#80633f", false),
  },
  {
    id: "warm-mocha",
    name: "Warm Mocha",
    scheme: "dark",
    colors: palette(
      "#302923",
      "#39312a",
      "#e9dfd4",
      "#d4b391",
      true,
      "#e8c4a6",
      "#c7b0a2",
    ),
  },
  {
    id: "soft-graphite",
    name: "Soft Graphite",
    scheme: "dark",
    colors: palette("#272c2c", "#303636", "#e2e8e5", "#adc4b8", true),
  },
  {
    id: "slate-blue",
    name: "Slate Blue",
    scheme: "dark",
    colors: palette("#252e3b", "#303a49", "#e1e7f0", "#acbfdf", true),
  },
  {
    id: "dark-sage",
    name: "Dark Sage",
    scheme: "dark",
    colors: palette("#293128", "#333d31", "#e1e8d9", "#b3c99e", true),
  },
  {
    id: "dusty-plum",
    name: "Dusty Plum",
    scheme: "dark",
    colors: palette("#332c36", "#403543", "#eee2ec", "#d3b6d4", true),
  },
];
export function defaultAppearance(): Appearance {
  return {
    typographyVersion: 2,
    studioVersion: 4,
    mode: "light",
    editing: "light",
    light: {
      presetId: studioLightPreset.id,
      colors: { ...studioLightPreset.colors },
      typography: { ...typography },
    },
    dark: {
      presetId: studioDarkPreset.id,
      colors: { ...studioDarkPreset.colors },
      typography: { ...typography },
    },
    saved: [],
  };
}
const hex = /^#[0-9a-f]{6}$/i;
export function sanitizeAppearance(value: unknown): Appearance {
  const defaults = defaultAppearance();
  if (!value || typeof value !== "object") return defaults;
  const v = value as Appearance;
  const read = (
    input: ThemeConfig | undefined,
    base: ThemeConfig,
    migrateFactory = false,
  ): ThemeConfig => {
    if (!input) return base;
    const colors = { ...base.colors };
    for (const key of Object.keys(colors))
      if (hex.test(input.colors?.[key])) colors[key] = input.colors[key];
    const t = { ...base.typography };
    for (const key of ["readingFont", "uiFont", "mathFont"] as const)
      if (
        typeof input.typography?.[key] === "string" &&
        input.typography[key].length < 150 &&
        /^[\w\s,"-]+$/.test(input.typography[key])
      )
        t[key] = input.typography[key];
    const limits: Record<string, [number, number]> = {
      size: [13, 28],
      headingScale: [1.1, 2.4],
      headingWeight: [300, 900],
      boldWeight: [400, 900],
      lineHeight: [1.25, 2.4],
      letterSpacing: [-0.5, 2],
      paragraphSpacing: [0.5, 2.5],
      readingWidth: [480, 1100],
    };
    for (const [key, [min, max]] of Object.entries(limits)) {
      const x = input.typography?.[key as keyof Typography];
      if (typeof x === "number" && Number.isFinite(x))
        (t as any)[key] = Math.max(min, Math.min(max, x));
    }
    // Modernize only the complete, untouched 2.0 factory typography. Named
    // custom presets and any independently edited typography keep their values.
    const legacyFactory = {
      readingFont: "Georgia, serif",
      uiFont: '"Segoe UI", sans-serif',
      mathFont: "KaTeX_Main",
      size: 17,
      headingScale: 1.6,
      headingWeight: 600,
      boldWeight: 700,
      lineHeight: 1.8,
      letterSpacing: 0,
      paragraphSpacing: 1.2,
      readingWidth: 760,
    };
    if (
      migrateFactory &&
      v.typographyVersion !== 2 &&
      presets.some((preset) => preset.id === input.presetId) &&
      !(
        Array.isArray(v.saved) &&
        v.saved.some((preset) => preset?.id === input.presetId)
      ) &&
      Object.entries(legacyFactory).every(
        ([key, value]) => input.typography?.[key as keyof Typography] === value,
      )
    ) {
      t.readingFont = typography.readingFont;
      t.size = typography.size;
      t.lineHeight = typography.lineHeight;
    }
    const legacyDefault = presets.find(
      (preset) =>
        preset.id ===
        (base.presetId === studioLightPreset.id ? "gentle-sage" : "dark-sage"),
    );
    // Only the exact former factory palette is replaced. One edited color, a
    // named custom preset, or an explicit choice of another legacy palette wins.
    // Typography stays independent, including user-customized font and spacing.
    const upgradeLegacyPalette =
      migrateFactory &&
      v.studioVersion !== 3 &&
      v.studioVersion !== 4 &&
      legacyDefault?.id === input.presetId &&
      !(
        Array.isArray(v.saved) &&
        v.saved.some((preset) => preset?.id === input.presetId)
      ) &&
      Object.keys(input.colors || {}).length ===
        Object.keys(legacyDefault.colors).length &&
      Object.entries(legacyDefault.colors).every(
        ([key, value]) =>
          typeof input.colors?.[key] === "string" &&
          input.colors[key].toLowerCase() === value.toLowerCase(),
      );
    const priorStudio =
      base.presetId === studioLightPreset.id
        ? previousStudioLightPreset
        : previousStudioDarkPreset;
    const upgradeStockStudio =
      migrateFactory &&
      v.studioVersion !== 4 &&
      input.presetId === priorStudio.id &&
      !(
        Array.isArray(v.saved) &&
        v.saved.some((preset) => preset?.id === input.presetId)
      ) &&
      Object.keys(input.colors || {}).length ===
        Object.keys(priorStudio.colors).length &&
      Object.entries(priorStudio.colors).every(
        ([key, value]) =>
          typeof input.colors?.[key] === "string" &&
          input.colors[key].toLowerCase() === value.toLowerCase(),
      );
    const upgradePalette = upgradeLegacyPalette || upgradeStockStudio;
    if (upgradePalette) {
      if (input.typography?.readingFont === '"Segoe UI", Arial, sans-serif')
        t.readingFont = typography.readingFont;
      if (input.typography?.uiFont === '"Segoe UI", sans-serif')
        t.uiFont = typography.uiFont;
    }
    return {
      presetId: upgradePalette
        ? base.presetId
        : typeof input.presetId === "string"
          ? input.presetId.slice(0, 100)
          : base.presetId,
      colors: upgradePalette ? { ...base.colors } : colors,
      typography: t,
    };
  };
  return {
    ...defaults,
    mode: ["light", "dark", "system"].includes(v.mode) ? v.mode : "light",
    editing: v.editing === "dark" ? "dark" : "light",
    light: read(v.light, defaults.light, true),
    dark: read(v.dark, defaults.dark, true),
    saved: Array.isArray(v.saved)
      ? v.saved
          .slice(0, 40)
          .filter(
            (p) =>
              p &&
              typeof p.id === "string" &&
              typeof p.name === "string" &&
              ["light", "dark"].includes(p.scheme),
          )
          .map((p) => {
            const safe = read(
              {
                colors: p.colors,
                typography: p.typography || typography,
                presetId: p.id,
              },
              defaults[p.scheme],
            );
            return {
              id: p.id.slice(0, 100),
              name: p.name.slice(0, 80),
              scheme: p.scheme,
              colors: safe.colors,
              typography: safe.typography,
              custom: true,
            };
          })
      : [],
  };
}
export function applyTheme(config: ThemeConfig, scheme: string) {
  const root = document.documentElement;
  if (root.dataset.theme !== scheme) root.dataset.theme = scheme;
  if (root.style.colorScheme !== scheme) root.style.colorScheme = scheme;
  for (const [key, value] of Object.entries(config.colors)) {
    if (root.style.getPropertyValue("--" + key) !== value)
      root.style.setProperty("--" + key, value);
  }
  const t = config.typography;
  for (const [key, value] of Object.entries({
    "reading-font": t.readingFont,
    "ui-font": t.uiFont,
    "math-font": t.mathFont,
    "reading-size": `${t.size}px`,
    "heading-scale": String(t.headingScale),
    "heading-weight": String(t.headingWeight),
    "bold-weight": String(t.boldWeight),
    "line-height": String(t.lineHeight),
    "letter-spacing": `${t.letterSpacing}px`,
    "paragraph-spacing": `${t.paragraphSpacing}em`,
    "reading-width": `${t.readingWidth}px`,
  }))
    if (root.style.getPropertyValue("--" + key) !== value)
      root.style.setProperty("--" + key, value);
}
export function contrast(a: string, b: string) {
  const luminance = (hex: string) => {
    const c = hex
      .slice(1)
      .match(/../g)!
      .map((v) => parseInt(v, 16) / 255)
      .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  };
  const x = luminance(a),
    y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
