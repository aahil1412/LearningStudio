import { describe, expect, it } from "vitest";
import { readZoom, saveZoom, zoomFactor, zoomShortcut } from "../electron/zoom";
import { defaultAppearance, sanitizeAppearance } from "../src/lib/themes";
import { defaultData } from "../src/lib/defaults";
import { messageContent } from "../src/lib/messageContent";
import { StudioStore } from "../electron/storage";
import type { Message } from "../src/types";

describe("2.1 readable defaults and additive message compatibility", () => {
  it("updates only untouched legacy factory typography and preserves explicit choices", () => {
    const legacy = defaultAppearance();
    delete legacy.typographyVersion;
    legacy.light.typography = {
      ...legacy.light.typography,
      readingFont: "Georgia, serif",
      uiFont: '"Segoe UI", sans-serif',
      size: 17,
      lineHeight: 1.8,
    };
    legacy.light.colors.bold = "#684637";
    const upgraded = sanitizeAppearance(legacy);
    expect(upgraded.light.typography).toMatchObject({
      readingFont: defaultAppearance().light.typography.readingFont,
      size: 18,
      lineHeight: 1.7,
    });
    expect(upgraded.light.colors.bold).toBe("#684637");
    expect(
      sanitizeAppearance({ ...legacy, typographyVersion: 2 }).light.typography
        .readingFont,
    ).toBe("Georgia, serif");
    const custom = {
      ...legacy,
      light: {
        ...legacy.light,
        typography: { ...legacy.light.typography, size: 21 },
      },
    };
    expect(sanitizeAppearance(custom).light.typography.readingFont).toBe(
      "Georgia, serif",
    );
  });
  it("uses sans serif and inline figures without forcing a laboratory", () => {
    expect(defaultAppearance().light.typography.readingFont).toContain(
      "Segoe UI",
    );
    expect(defaultAppearance().dark.typography.size).toBe(18);
    expect(defaultData().settings).toMatchObject({
      labOpen: false,
      visualizationPlacement: "inline",
    });
  });
  it("reads legacy text and block indexes without duplicate explanation or figure IDs", () => {
    const message: Message = {
      id: "old",
      role: "assistant",
      text: "An explanation",
      blocks: [
        { type: "text", text: "An explanation" },
        { type: "plot", spec: { kind: "wave", title: "Wave" } },
      ],
      createdAt: "2026-10-28",
    };
    const entries = messageContent(message);
    expect(entries).toHaveLength(2);
    expect(entries[1].key).toBe("old:1");
    expect(
      messageContent({ ...message, text: "Introduction" })[0].block,
    ).toEqual({ type: "text", text: "Introduction" });
    const content: Message["content"] = [
      { type: "text", text: "Before" },
      { type: "equation", latex: "x=1" },
      { type: "text", text: "After" },
    ];
    expect(messageContent({ ...message, content }).map((e) => e.block)).toEqual(
      content,
    );
  });
  it("handles zoom shortcuts without swallowing ordinary typing and persists installation zoom", () => {
    expect(zoomShortcut({ control: true, key: "=", type: "keyDown" })).toBe(
      "in",
    );
    expect(zoomShortcut({ control: true, key: "+", type: "keyDown" })).toBe(
      "in",
    );
    expect(zoomShortcut({ control: true, key: "-", type: "keyDown" })).toBe(
      "out",
    );
    expect(zoomShortcut({ control: true, key: "0", type: "keyDown" })).toBe(
      "reset",
    );
    expect(
      zoomShortcut({ control: false, key: "=", type: "keyDown" }),
    ).toBeUndefined();
    expect(zoomFactor(Infinity)).toBe(1);
    expect(zoomFactor(10)).toBe(2);
    const store = new StudioStore(":memory:");
    try {
      expect(readZoom(store.db)).toBe(1);
      saveZoom(store.db, 1.2);
      store.save(defaultData());
      expect(readZoom(store.db)).toBe(1.2);
    } finally {
      store.close();
    }
  });
});
