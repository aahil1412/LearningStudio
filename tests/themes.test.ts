import { describe, it, expect } from "vitest";
import {
  defaultAppearance,
  sanitizeAppearance,
  presets,
  contrast,
  colorGroups,
  studioLightPreset,
  studioDarkPreset,
} from "../src/lib/themes";
import { teachingInstructions } from "../src/lib/teaching";
import { defaultData } from "../src/lib/defaults";
import type { Lesson } from "../src/types";
import oldStudioColors from "./fixtures/studio-23-factory-colors.json";
describe("independent and bounded appearance settings", () => {
  it("retains all ten legacy presets beside readable Studio Light and Studio Dark", () => {
    expect(presets).toHaveLength(12);
    expect(presets.map((preset) => preset.id)).toEqual(
      expect.arrayContaining([
        "gentle-sage",
        "warm-beige",
        "muted-peach",
        "soft-ivory",
        "sandstone",
        "warm-mocha",
        "soft-graphite",
        "slate-blue",
        "dark-sage",
        "dusty-plum",
      ]),
    );
    for (const preset of presets)
      expect(
        contrast(preset.colors.text, preset.colors.reading),
        preset.name,
      ).toBeGreaterThanOrEqual(4.5);
  });
  it("uses complete learning defaults with readable controls, captions, code and selection", () => {
    const appearance = defaultAppearance();
    expect(appearance).toMatchObject({
      studioVersion: 4,
      light: { presetId: "studio-light" },
      dark: { presetId: "studio-dark" },
    });
    expect(appearance.light.colors.bg).toBe("#EEF2EC");
    expect(appearance.dark.colors.bg).toBe("#102019");
    const tokens = Object.values(colorGroups)
      .flatMap((group) => Object.keys(group))
      .sort();
    for (const preset of [studioLightPreset, studioDarkPreset]) {
      expect(Object.keys(preset.colors).sort()).toEqual(tokens);
      expect(preset.colors.reading).not.toBe("#ffffff");
      expect(preset.colors.bg).not.toBe("#000000");
      const c = preset.colors;
      for (const key of [
        "text",
        "secondary",
        "muted",
        "caption",
        "link",
        "bold",
        "italic",
        "heading",
        "math",
      ]) {
        for (const background of [
          "bg",
          "reading",
          "surface",
          "popover",
          "input",
          "figure",
          "selected",
          "hover",
        ]) {
          expect(
            contrast(c[key], c[background]),
            `${preset.name} ${key} on ${background}`,
          ).toBeGreaterThanOrEqual(4.5);
        }
      }
      expect(contrast(c.code, c.codeBg)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(c.selectionText, c.button)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(c.selectionText, c.selection)).toBeGreaterThanOrEqual(
        4.5,
      );
      expect(contrast(c.highlightText, c.highlight)).toBeGreaterThanOrEqual(
        4.5,
      );
    }
  });
  it("upgrades exact old default palettes once while preserving independently chosen typography", () => {
    const previous = defaultAppearance();
    delete previous.studioVersion;
    previous.mode = "system";
    for (const [scheme, id] of [
      ["light", "gentle-sage"],
      ["dark", "dark-sage"],
    ] as const) {
      previous[scheme] = {
        ...previous[scheme],
        presetId: id,
        colors: { ...presets.find((preset) => preset.id === id)!.colors },
      };
    }
    previous.light.typography = {
      ...previous.light.typography,
      readingFont: "Arial, sans-serif",
      size: 22,
      lineHeight: 1.9,
      readingWidth: 900,
    };
    const upgraded = sanitizeAppearance(previous);
    expect(upgraded.light.colors).toEqual(studioLightPreset.colors);
    expect(upgraded.dark.colors).toEqual(studioDarkPreset.colors);
    expect(upgraded.light.typography).toEqual(previous.light.typography);
    expect(upgraded.mode).toBe("system");
    expect(upgraded.studioVersion).toBe(4);
    // A subsequent deliberate selection of the former default stays selected.
    upgraded.light = {
      ...upgraded.light,
      presetId: "gentle-sage",
      colors: {
        ...presets.find((preset) => preset.id === "gentle-sage")!.colors,
      },
    };
    expect(
      sanitizeAppearance(JSON.parse(JSON.stringify(upgraded))).light,
    ).toEqual(upgraded.light);
  });
  it("upgrades only untouched 2.3 stock palettes and keeps edited or named custom settings", () => {
    const previous = defaultAppearance();
    previous.studioVersion = 3;
    previous.light.colors = { ...oldStudioColors.light };
    previous.dark.colors = { ...oldStudioColors.dark };
    previous.light.typography.size = 23;
    const upgraded = sanitizeAppearance(previous);
    expect(upgraded.light.colors).toEqual(studioLightPreset.colors);
    expect(upgraded.dark.colors).toEqual(studioDarkPreset.colors);
    expect(upgraded.light.typography.size).toBe(23);
    previous.light.colors.bold = "#284375";
    expect(sanitizeAppearance(previous).light).toEqual(previous.light);
    expect(sanitizeAppearance(previous).dark.colors).toEqual(
      studioDarkPreset.colors,
    );
    previous.light.colors = { ...oldStudioColors.light };
    previous.saved = [
      {
        ...studioLightPreset,
        custom: true,
        colors: { ...oldStudioColors.light },
        typography: { ...previous.light.typography },
      },
    ];
    expect(sanitizeAppearance(previous).light).toEqual(previous.light);
    expect(sanitizeAppearance(previous).saved).toEqual(previous.saved);
  });
  it("preserves edited palettes, explicitly selected older palettes, and saved presets during upgrade", () => {
    const previous = defaultAppearance();
    delete previous.studioVersion;
    const sage = presets.find((preset) => preset.id === "gentle-sage")!;
    const beige = presets.find((preset) => preset.id === "warm-beige")!;
    previous.light = {
      ...previous.light,
      presetId: sage.id,
      colors: { ...sage.colors, bold: "#334c77" },
    };
    previous.dark = {
      ...previous.dark,
      presetId: "warm-mocha",
      colors: {
        ...presets.find((preset) => preset.id === "warm-mocha")!.colors,
      },
    };
    previous.saved = [
      {
        ...beige,
        id: "personal-palette",
        name: "Personal palette",
        colors: { ...beige.colors },
        typography: { ...previous.light.typography, size: 20 },
        custom: true,
      },
    ];
    const upgraded = sanitizeAppearance(previous);
    expect(upgraded.light).toEqual(previous.light);
    expect(upgraded.dark).toEqual(previous.dark);
    expect(upgraded.saved).toEqual(previous.saved);
    // A custom preset is still custom even if it reuses a built-in ID/colors.
    previous.light.colors = { ...sage.colors };
    previous.saved = [
      { ...sage, typography: { ...previous.light.typography }, custom: true },
    ];
    expect(sanitizeAppearance(previous).light).toEqual(previous.light);
  });
  it("changes only eligible factory Segoe font strings to bundled Inter and retains reading adjustments", () => {
    const previous = defaultAppearance();
    delete previous.studioVersion;
    previous.light = {
      ...previous.light,
      presetId: "gentle-sage",
      colors: {
        ...presets.find((preset) => preset.id === "gentle-sage")!.colors,
      },
      typography: {
        ...previous.light.typography,
        readingFont: '"Segoe UI", Arial, sans-serif',
        uiFont: '"Segoe UI", sans-serif',
        size: 24,
        lineHeight: 2,
      },
    };
    previous.dark = {
      ...previous.dark,
      presetId: "dark-sage",
      colors: {
        ...presets.find((preset) => preset.id === "dark-sage")!.colors,
      },
      typography: {
        ...previous.dark.typography,
        readingFont: "Tahoma, sans-serif",
        uiFont: "Arial, sans-serif",
      },
    };
    const upgraded = sanitizeAppearance(previous);
    expect(upgraded.light.typography).toMatchObject({
      readingFont: 'Inter, "Segoe UI", Arial, sans-serif',
      uiFont: 'Inter, "Segoe UI", sans-serif',
      size: 24,
      lineHeight: 2,
    });
    expect(upgraded.dark.typography).toEqual(previous.dark.typography);
  });
  it("sanitizes malformed old factory colors and saved metadata without throwing during the upgrade", () => {
    const previous = defaultAppearance();
    delete previous.studioVersion;
    previous.light = {
      ...previous.light,
      presetId: "gentle-sage",
      colors: {
        ...presets.find((preset) => preset.id === "gentle-sage")!.colors,
      },
    };
    (previous.light.colors as unknown as Record<string, unknown>).bg = 123;
    const malformed = { ...previous, saved: { invalid: true } };
    expect(() => sanitizeAppearance(malformed)).not.toThrow();
    const result = sanitizeAppearance(malformed);
    expect(result.light.presetId).toBe("gentle-sage");
    expect(result.light.colors.bg).toBe(studioLightPreset.colors.bg);
    expect(result.saved).toEqual([]);
  });
  it("keeps light and dark colors independent after JSON restart and clamps imported typography", () => {
    const a = defaultAppearance();
    a.light.colors.bold = "#684637";
    a.dark.colors.bold = "#e8c4a6";
    a.light.typography.size = 1000;
    a.dark.typography.lineHeight = -5;
    const b = sanitizeAppearance(JSON.parse(JSON.stringify(a)));
    expect(b.light.colors.bold).toBe("#684637");
    expect(b.dark.colors.bold).toBe("#e8c4a6");
    expect(b.light.typography.size).toBe(28);
    expect(b.dark.typography.lineHeight).toBe(1.25);
  });
  it("ignores executable CSS values and sanitizes saved presets as well as active palettes", () => {
    const a = defaultAppearance();
    a.light.colors.bg = "url(https://example.org)";
    a.saved = [
      {
        id: "mine",
        name: "Mine",
        scheme: "dark",
        colors: { ...a.dark.colors },
        typography: {
          ...a.dark.typography,
          readingWidth: 9000,
          readingFont: "url(https://example.org)",
        },
      },
    ];
    const b = sanitizeAppearance(a);
    expect(b.light.colors.bg).toBe(defaultAppearance().light.colors.bg);
    expect(b.saved[0].typography?.readingWidth).toBe(1100);
    expect(b.saved[0].typography?.readingFont).toBe(
      defaultAppearance().dark.typography.readingFont,
    );
  });
});
describe("flexible explicit teaching context", () => {
  const lesson: Lesson = {
    id: "session",
    title: "History",
    subject: "Humanities",
    mode: "Explore",
    objective: "Understand world history",
    position: "Trade and cities",
    messages: [],
    notes: "",
    createdAt: "now",
    updatedAt: "now",
  };
  it("preserves broad goals and position across modes without mandatory assessments", () => {
    const settings = defaultData().settings;
    settings.teaching = {
      delivery: "balanced",
      practice: "mcq",
      checkFrequency: "requested",
      sentenceStyle: "clean",
      avoidEmDashes: true,
    };
    const prompt = teachingInstructions(lesson, settings, []);
    const controller = JSON.parse(prompt.match(/CONTROL_STATE: (.+)\n/)![1]);
    expect(controller).toMatchObject({
      mode: "Explore",
      objective: "Understand world history",
      position: "Trade and cities",
      preservePositionDuringTangent: true,
      preferences: { checkFrequency: "requested" },
    });
    expect(controller.checkpoint).toContain("Only when explicitly requested");
    expect(prompt).toContain(
      "Checks are disabled unless the learner explicitly requests one.",
    );
    expect(prompt).toContain(
      "without requiring artificial narrowing or a diagnostic",
    );
  });
  it("only sends optional learner preferences when enabled", () => {
    const settings = defaultData().settings;
    settings.profile = "Prefer physical examples";
    expect(teachingInstructions(lesson, settings, [])).not.toContain(
      settings.profile,
    );
    settings.personalization = true;
    expect(teachingInstructions(lesson, settings, [])).toContain(
      settings.profile,
    );
  });
});
