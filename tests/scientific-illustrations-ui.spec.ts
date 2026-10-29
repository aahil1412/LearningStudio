import { test, expect, chromium, type Browser } from "@playwright/test";
import { build } from "esbuild";
import { createRequire } from "node:module";
import { readFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { XMLValidator } from "fast-xml-parser";
import type { IllustrationSpec } from "../src/types";
import { scientificScenes } from "./scientific-scenes-fixture";
import { writeOfflineTextbook } from "../electron/exporter";
import { pathToFileURL } from "node:url";

// Browser checks of the production SVG renderer, not a fixture drawing. Actual
// Electron integration is covered by the release suite; this isolates geometry.
let browser: Browser;
let render: (type: string, step?: number) => string;
let renderScene: (
  spec: IllustrationSpec,
  state?: Record<string, unknown>,
) => string;
let css: string;
const interactiveBundle = resolve(".tools/scientific-interactive.js");
test.beforeAll(async () => {
  await mkdir(resolve(".tools"), { recursive: true });
  await build({
    stdin: {
      contents: `import {createElement} from 'react';
        import {renderToStaticMarkup} from 'react-dom/server';
        import ScientificIllustration,{TranslationIllustration,MembraneIllustration} from './src/components/visuals/ScientificIllustration';
        import {VisualRuntimeContext} from './src/lib/visualState';
        export const render=(type,step=0)=>renderToStaticMarkup(createElement('div',
          {className:'scientific-illustration'},createElement('div',{className:'science-viewport'},
          createElement(type==='translation'?TranslationIllustration:MembraneIllustration,{step,id:'geometry'}))));
        export const renderScene=(spec,state={})=>renderToStaticMarkup(createElement(VisualRuntimeContext.Provider,
          {value:{id:'scene',subjectId:'subject',state,visible:true,placement:'inline',patch:()=>{},move:()=>{},storeAsset:async()=>'',loadAsset:async()=>null}},
          createElement(ScientificIllustration,{spec})));`,
      resolveDir: process.cwd(),
      loader: "tsx",
    },
    bundle: true,
    platform: "node",
    format: "cjs",
    loader: { ".css": "empty" },
    outfile: resolve(".tools/scientific-geometry.cjs"),
    logLevel: "silent",
  });
  render = createRequire(import.meta.url)(
    resolve(".tools/scientific-geometry.cjs"),
  ).render;
  renderScene = createRequire(import.meta.url)(
    resolve(".tools/scientific-geometry.cjs"),
  ).renderScene;
  await build({
    stdin: {
      contents: `import {createElement} from 'react';
        import {createRoot} from 'react-dom/client';
        import ScientificIllustration from './src/components/visuals/ScientificIllustration';
        import {VisualRuntimeContext} from './src/lib/visualState';
        window.mountScientificIllustration=(state={},spec={template:'translation',title:'How translation works'})=>{
          const root=createRoot(document.getElementById('root'));
          const runtime={id:'translation-acceptance',subjectId:'subject',state,visible:true,
            placement:'inline',patch:(patch)=>Object.assign(window.savedIllustrationState,patch),
            move:()=>{},storeAsset:async()=>'',loadAsset:async()=>null};
          window.savedIllustrationState={...state};
          root.render(createElement(VisualRuntimeContext.Provider,{value:runtime},
            createElement(ScientificIllustration,{spec})));
          window.unmountScientificIllustration=()=>root.unmount();
        };`,
      resolveDir: process.cwd(),
      loader: "tsx",
    },
    bundle: true,
    platform: "browser",
    format: "iife",
    loader: { ".css": "empty" },
    outfile: interactiveBundle,
    logLevel: "silent",
  });
  css = (
    await Promise.all(
      [
        "scientific-illustrations.css",
        "scientific-scene.css",
        "science-popover.css",
      ].map((file) =>
        readFile(resolve("src/components/visuals", file), "utf8"),
      ),
    )
  ).join("\n");
  browser = await chromium.launch({ channel: "chrome" });
});
test.afterAll(async () => browser?.close());

const themes = {
  light: {
    figure: "#f0ebe3",
    text: "#352f2b",
    surface: "#e8e0d5",
    border: "#b2ab9f",
  },
  dark: {
    figure: "#302923",
    text: "#efe9e1",
    surface: "#40382f",
    border: "#74695c",
  },
  custom: {
    figure: "#1f3345",
    text: "#f2e5d1",
    surface: "#273b50",
    border: "#798f9f",
  },
};
function html(type: string, step: number, theme: keyof typeof themes) {
  const t = themes[theme];
  return `<style>:root{--figure:${t.figure};--text:${t.text};--surface:${t.surface};--border:${t.border};--reading-font:'Segoe UI',sans-serif;--accent:#805436;--accent2:#805436;}body{margin:0;background:var(--figure)}.scientific-illustration{width:100%;max-width:1100px}${css}</style>${render(type, step)}`;
}
function sceneHtml(
  spec: IllustrationSpec,
  theme: keyof typeof themes,
  state: Record<string, unknown> = {},
) {
  return (
    html("translation", 0, theme).replace(/<svg[\s\S]*<\/svg>/, "") +
    renderScene(spec, state)
  );
}

for (const theme of Object.keys(themes) as (keyof typeof themes)[]) {
  for (const width of [360, 690, 1100]) {
    test(`authored scenes ${theme} at ${width}px keep symbols and labels separate`, async () => {
      const page = await browser.newPage({ viewport: { width, height: 1200 } });
      try {
        const dense = structuredClone(scientificScenes.photosynthesis);
        dense.scene!.participants.forEach(
          (participant, index) =>
            (participant.label = [
              "W".repeat(64),
              "科学的概念".repeat(12) + "AAAA",
              "LongUnbrokenScientificRelationshipNameWithManyLetters".padEnd(
                64,
                "M",
              ),
              "Repeated scientific terminology in an intentionally long label".padEnd(
                64,
                "M",
              ),
            ][index]),
        );
        dense.scene!.relations = dense.scene!.participants.flatMap(
          (from, index) =>
            dense.scene!.participants.slice(index + 1).map((to) => ({
              from: from.id,
              to: to.id,
              label: "An authored relationship in a routing stress test",
              kind: "regulation" as const,
            })),
        );
        for (const [name, spec] of [
          ...Object.entries(scientificScenes),
          ["dense", dense] as const,
        ]) {
          await page.setContent(sceneHtml(spec, theme));
          const geometry = await page.locator(".scene-svg").evaluate((svg) => {
            const frame = svg.getBoundingClientRect();
            const labels = [
              ...svg.querySelectorAll<SVGTextElement>("text"),
            ].map((el) => ({
              label: el.textContent,
              box: el.getBoundingClientRect(),
              size:
                parseFloat(getComputedStyle(el).fontSize) *
                (el.getScreenCTM()?.a || 1),
            }));
            const overlap: string[] = [],
              crossed: string[] = [];
            labels.forEach((label, index) =>
              labels.slice(index + 1).forEach((other) => {
                if (
                  Math.min(label.box.right, other.box.right) -
                    Math.max(label.box.left, other.box.left) >
                    1 &&
                  Math.min(label.box.bottom, other.box.bottom) -
                    Math.max(label.box.top, other.box.top) >
                    1
                )
                  overlap.push(`${label.label} / ${other.label}`);
              }),
            );
            for (const shape of svg.querySelectorAll<SVGGeometryElement>(
              "path,ellipse,circle,rect",
            )) {
              if (shape.closest("defs")) continue;
              const matrix = shape.getScreenCTM();
              if (!matrix) continue;
              const length = shape.getTotalLength();
              for (let at = 0; at <= length; at += 2) {
                const point = shape
                  .getPointAtLength(at)
                  .matrixTransform(matrix);
                for (const label of labels)
                  if (
                    point.x > label.box.left - 1 &&
                    point.x < label.box.right + 1 &&
                    point.y > label.box.top - 1 &&
                    point.y < label.box.bottom + 1 &&
                    !crossed.includes(label.label || "")
                  )
                    crossed.push(label.label || "");
              }
            }
            return {
              overlap,
              crossed,
              overflow: labels
                .filter(
                  (label) =>
                    label.box.left < frame.left - 1 ||
                    label.box.right > frame.right + 1 ||
                    label.box.top < frame.top - 1 ||
                    label.box.bottom > frame.bottom + 1,
                )
                .map((label) => label.label),
              minimum: Math.min(...labels.map((label) => label.size)),
              pageOverflow: document.documentElement.scrollWidth > innerWidth,
              needsPan:
                svg.parentElement!.scrollWidth > svg.parentElement!.clientWidth,
            };
          });
          expect(geometry.overlap, name).toEqual([]);
          expect(geometry.crossed, name).toEqual([]);
          expect(geometry.overflow, name).toEqual([]);
          expect(geometry.minimum).toBeGreaterThanOrEqual(16);
          expect(geometry.pageOverflow).toBe(false);
          expect(geometry.needsPan).toBe(width < 660);
          await expect(
            page.locator(
              ".scene-label :is(rect,path,circle),.scene-symbol text",
            ),
          ).toHaveCount(0);
          if (name !== "dense")
            await page
              .locator(".scientific-illustration")
              .last()
              .screenshot({
                path: `docs/v212-figures/${name}-${theme}-${width}.png`,
              });
        }
      } finally {
        await page.close();
      }
    });
  }
}

test("authored scene interactions visibly focus participants, change active stages and restore state", async () => {
  const page = await browser.newPage({
    viewport: { width: 690, height: 1200 },
  });
  try {
    await page.clock.install();
    await page.setContent(
      html("translation", 0, "light").replace(/<svg[\s\S]*<\/svg>/, "") +
        '<div id="root"></div>',
    );
    await page.addScriptTag({ path: interactiveBundle });
    await page.evaluate(
      (spec) =>
        (
          window as unknown as {
            mountScientificIllustration: (
              state: Record<string, unknown>,
              spec: IllustrationSpec,
            ) => void;
          }
        ).mountScientificIllustration({}, spec),
      scientificScenes.photosynthesis,
    );
    await page
      .getByRole("button", {
        name: "Inspect Chloroplast pathways",
        exact: true,
      })
      .click();
    await expect(page.getByRole("dialog")).toContainText(
      "different chloroplast regions",
    );
    await page.keyboard.press("Escape");
    await page
      .getByRole("button", {
        name: "Inspect Carbon dioxide and water",
        exact: true,
      })
      .click();
    await expect(page.getByRole("dialog")).toContainText(
      "source of the oxygen",
    );
    await page.keyboard.press("Escape");
    await page
      .getByRole("button", {
        name: "Inspect Chloroplast pathways",
        exact: true,
      })
      .click();
    await expect(
      page.locator('[data-participant-id="chloroplast"]'),
    ).toHaveClass(/is-selected/);
    await expect(page.getByRole("dialog")).toContainText(
      "different chloroplast regions",
    );
    const visibleRing = await page
      .locator('[data-participant-id="chloroplast"] .scene-focus-ring')
      .evaluate((el) => getComputedStyle(el).opacity);
    expect(visibleRing).toBe("1");
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Next step", exact: true }).click();
    await expect(page.locator('[data-participant-id="inputs"]')).toHaveClass(
      /is-active/,
    );
    await expect(page.locator('[data-participant-id="light"]')).not.toHaveClass(
      /is-active/,
    );
    const saved = await page.evaluate(() => ({
      ...(
        window as unknown as { savedIllustrationState: Record<string, unknown> }
      ).savedIllustrationState,
    }));
    expect(saved["scene.step"]).toBe(1);
    expect(saved["scene.selection"]).toBe("chloroplast");
    await page.evaluate(
      ({ spec, state }) => {
        const api = window as unknown as {
          unmountScientificIllustration: () => void;
          mountScientificIllustration: (
            state: Record<string, unknown>,
            spec: IllustrationSpec,
          ) => void;
        };
        api.unmountScientificIllustration();
        api.mountScientificIllustration(state, spec);
      },
      { spec: scientificScenes.photosynthesis, state: saved },
    );
    await expect(page.getByText("Step 2 of 3", { exact: true })).toBeVisible();
    await expect(
      page.locator('[data-participant-id="chloroplast"]'),
    ).toHaveClass(/is-selected/);
    await expect(page.locator(".scene-inspector")).toContainText(
      "different chloroplast regions",
    );
    await expect(page.getByRole("dialog")).toHaveCount(0);
    // A relationship diagram exposes manual stages, not a fake simulation.
    await expect(
      page.getByRole("button", { name: "Play explanation", exact: true }),
    ).toHaveCount(0);
    await page.getByRole("button", { name: "Next step", exact: true }).click();
    await expect(page.getByText("Step 3 of 3", { exact: true })).toBeVisible();
    await expect(page.locator('[data-participant-id="outputs"]')).toHaveClass(
      /is-active/,
    );
    await page.getByText("All 3 connections", { exact: true }).click();
    await page
      .getByRole("button", { name: "Show relationship 2", exact: true })
      .click();
    await expect(page.getByRole("dialog")).toContainText(
      "Water feeds light reactions",
    );
    await expect(page.locator(".scene-relation").nth(1)).toHaveClass(
      /is-selected/,
    );
    await page.locator(".scientific-illustration").last().screenshot({
      path: "docs/v212-figures/photosynthesis-interactive-690.png",
    });
  } finally {
    await page.close();
  }
});

test("offline production textbook preserves authored scene state and interactions without a network", async () => {
  const context = await browser.newContext({
    viewport: { width: 1250, height: 1100 },
  });
  await context.setOffline(true);
  const page = await context.newPage(),
    requests: string[] = [],
    errors: string[] = [];
  page.on("request", (request) => {
    if (/^https?:/.test(request.url())) requests.push(request.url());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  try {
    const path = resolve(".tools/scientific-scene-offline.html"),
      now = "2026-10-28T12:00:00.000Z";
    const block = {
      type: "illustration" as const,
      spec: scientificScenes.photosynthesis,
    };
    await writeOfflineTextbook(
      path,
      {
        title: "Authored scientific scenes offline",
        lessons: [],
        resources: [],
        visuals: [
          {
            id: "saved-scene",
            subjectId: "subject",
            block,
            state: {
              "scene.step": 1,
              "scene.selection": "chloroplast",
              "scene.secret": "MUST_NOT_EXPORT",
            },
            placement: "inline",
            tags: [],
            annotations: [],
            createdAt: now,
            updatedAt: now,
          },
        ],
        includeNotes: false,
        includeUserMessages: false,
        exportedAt: now,
        chapters: [
          {
            id: "photo",
            subjectId: "subject",
            title: "Photosynthesis overview",
            markdown:
              "A functional overview of coupled processes. The arrows summarize pathways, not one elementary reaction.",
            blocks: [block],
            citations: [
              {
                label: "OpenStax Biology 2e, photosynthesis",
                url: "https://openstax.org/books/biology-2e/pages/8-1-overview-of-photosynthesis",
              },
            ],
            originMessageIds: [],
            revision: 1,
            createdAt: now,
            updatedAt: now,
          },
        ],
      },
      { offlineOnly: true },
    );
    expect(await readFile(path, "utf8")).not.toContain("MUST_NOT_EXPORT");
    await page.goto(pathToFileURL(path).href);
    await expect(page.getByText("Step 2 of 3", { exact: true })).toBeVisible();
    await expect(
      page.locator('[data-participant-id="chloroplast"]'),
    ).toHaveClass(/is-selected/);
    await expect(page.locator(".scene-inspector")).toContainText(
      "different chloroplast regions",
    );
    await page.getByRole("button", { name: "Next step", exact: true }).click();
    await expect(page.getByText("Step 3 of 3", { exact: true })).toBeVisible();
    await page
      .getByRole("button", {
        name: "Inspect Carbon dioxide and water",
        exact: true,
      })
      .click();
    await expect(page.getByRole("dialog")).toContainText(
      "source of the oxygen",
    );
    await page
      .getByRole("button", { name: "Dark appearance", exact: true })
      .click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await page.screenshot({
      path: "docs/v212-figures/photosynthesis-offline-dark.png",
    });
    expect(requests).toEqual([]);
    expect(errors).toEqual([]);
  } finally {
    await context.close();
  }
});

for (const theme of Object.keys(themes) as (keyof typeof themes)[]) {
  for (const width of [360, 690, 700, 1100]) {
    test(`${theme} at ${width}px keeps semantic hues and readable collision-free annotations`, async () => {
      const page = await browser.newPage({ viewport: { width, height: 1100 } });
      try {
        for (const type of ["translation", "membrane"]) {
          await page.setContent(html(type, 0, theme));
          const geometry = await page
            .locator(".scientific-svg")
            .evaluate((svg) => {
              const frame = svg.getBoundingClientRect();
              const text = [...svg.querySelectorAll<SVGTextElement>("text")]
                .filter((el) => !el.closest("[clip-path]"))
                .map((el) => {
                  const b = el.getBoundingClientRect();
                  return {
                    label: el.textContent,
                    x: b.x,
                    y: b.y,
                    right: b.right,
                    bottom: b.bottom,
                    size:
                      parseFloat(getComputedStyle(el).fontSize) *
                      (el.getScreenCTM()?.a || 1),
                  };
                });
              const overlaps: (string | null)[][] = [];
              const leaderCollisions: (string | null)[] = [];
              for (let i = 0; i < text.length; i++)
                for (let j = i + 1; j < text.length; j++) {
                  const a = text[i],
                    b = text[j];
                  if (
                    Math.min(a.right, b.right) - Math.max(a.x, b.x) > 1 &&
                    Math.min(a.bottom, b.bottom) - Math.max(a.y, b.y) > 1
                  )
                    overlaps.push([a.label, b.label]);
                }
              for (const leader of svg.querySelectorAll<SVGPathElement>(
                ".science-leader",
              )) {
                const matrix = leader.getScreenCTM();
                if (!matrix) continue;
                const length = leader.getTotalLength();
                for (let at = 0; at <= length; at += 2) {
                  const point = leader
                    .getPointAtLength(at)
                    .matrixTransform(matrix);
                  for (const label of text) {
                    if (
                      point.x > label.x + 1 &&
                      point.x < label.right - 1 &&
                      point.y > label.y + 1 &&
                      point.y < label.bottom - 1 &&
                      !leaderCollisions.includes(label.label)
                    )
                      leaderCollisions.push(label.label);
                  }
                }
              }
              return {
                overlaps,
                leaderCollisions,
                minimumText: Math.min(...text.map((t) => t.size)),
                overflow: text
                  .filter(
                    (t) =>
                      t.x < frame.x - 1 ||
                      t.right > frame.right + 1 ||
                      t.y < frame.y - 1 ||
                      t.bottom > frame.bottom + 1,
                  )
                  .map((t) => t.label),
                documentOverflow:
                  document.documentElement.scrollWidth > innerWidth,
                inks: [
                  ".science-mrna",
                  ".science-trna-body",
                  ".science-ribosome",
                  ".science-amino",
                  ".science-lipid",
                  ".science-lipid-tail",
                  ".science-channel",
                ]
                  .map((selector) => {
                    const el = svg.querySelector(selector);
                    return el ? getComputedStyle(el).stroke : null;
                  })
                  .filter(Boolean),
              };
            });
          expect(geometry.overlaps).toEqual([]);
          expect(geometry.leaderCollisions).toEqual([]);
          expect(geometry.overflow).toEqual([]);
          expect(geometry.minimumText).toBeGreaterThanOrEqual(15.99);
          expect(geometry.documentOverflow).toBe(false);
          expect(new Set(geometry.inks).size).toBe(
            type === "translation" ? 4 : 3,
          );
          await page.locator(".scientific-svg").screenshot({
            path: `docs/v212-figures/${type}-${theme}-${width}.png`,
          });
        }
      } finally {
        await page.close();
      }
    });
  }
}

test("translation progression keeps antiparallel pairing visible without an overprinted ghost", async () => {
  const page = await browser.newPage({ viewport: { width: 900, height: 800 } });
  try {
    for (let step = 0; step < 3; step++) {
      await page.setContent(html("translation", step, "light"));
      await expect(page.locator(".science-trna")).toHaveCount(
        step === 2 ? 1 : 2,
      );
      await expect(page.getByText("P site", { exact: true })).toHaveCount(1);
      await expect(page.getByText("A site", { exact: true })).toHaveCount(1);
      const data = await page.locator(".scientific-svg").evaluate((svg) => ({
        codons: [...svg.querySelectorAll(".science-codon")].length,
        pairing: svg.querySelectorAll(".science-pairing path").length,
        directions: [...svg.querySelectorAll(".science-trna text")]
          .map((el) => el.textContent)
          .filter((t) => t === "3′" || t === "5′"),
      }));
      expect(data.codons).toBe(4);
      expect(data.pairing).toBe(step === 2 ? 3 : 6);
      expect(data.directions).toEqual(
        step === 2 ? ["3′", "5′"] : ["3′", "5′", "3′", "5′"],
      );
      await page.locator(".scientific-svg").screenshot({
        path: `docs/v212-figures/translation-step-${step + 1}.png`,
      });
    }
  } finally {
    await page.close();
  }
});

test("production translation controls inspect participants, animate causal changes and restore saved state", async () => {
  const page = await browser.newPage({
    viewport: { width: 700, height: 1150 },
  });
  try {
    await page.clock.install();
    await page.setContent(
      html("translation", 0, "light").replace(/<svg[\s\S]*<\/svg>/, "") +
        '<div id="root"></div>',
    );
    await page.addScriptTag({ path: interactiveBundle });
    await page.evaluate("window.mountScientificIllustration()");
    await expect(page.getByText("Step 1 of 3", { exact: true })).toBeVisible();
    await page
      .getByRole("button", { name: "Inspect tRNA", exact: true })
      .first()
      .click();
    await expect(page.getByRole("dialog")).toContainText(
      "transfer RNA recognizes a complementary mRNA codon",
    );
    // In this narrow viewport the below-drawing explanation occupies the
    // controls' area. Dismiss the inspector before advancing the mechanism.
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page.getByRole("button", { name: "Next step", exact: true }).click();
    await expect(page.getByText("Step 2 of 3", { exact: true })).toBeVisible();
    await expect(page.locator(".science-transfer")).toHaveCount(1);
    await expect(
      page.locator('[data-science-layer="peptidyl-trna"] .science-amino'),
    ).toHaveCount(0);
    const saved = await page.evaluate(() => ({
      ...(
        window as unknown as { savedIllustrationState: Record<string, unknown> }
      ).savedIllustrationState,
    }));
    expect(saved["illustration.step"]).toBe(1);
    expect(saved["illustration.selection"]).toBe("trna");
    await page.evaluate((state) => {
      const api = window as unknown as {
        unmountScientificIllustration: () => void;
        mountScientificIllustration: (state: Record<string, unknown>) => void;
      };
      api.unmountScientificIllustration();
      api.mountScientificIllustration(state);
    }, saved);
    await expect(page.getByText("Step 2 of 3", { exact: true })).toBeVisible();
    await expect(page.locator(".science-inspector")).toContainText(
      "transfer RNA recognizes",
    );
    await page
      .getByRole("button", { name: "Play illustration playback", exact: true })
      .click();
    await page.clock.fastForward(1900);
    await expect(page.getByText("Step 3 of 3", { exact: true })).toBeVisible();
    await expect(page.locator(".science-trna")).toHaveCount(1);
    await page.clock.fastForward(1900);
    await expect(
      page.getByRole("button", {
        name: "Play illustration playback",
        exact: true,
      }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Reset", exact: true }).click();
    await expect(page.getByText("Step 1 of 3", { exact: true })).toBeVisible();
    await page
      .getByRole("button", { name: "Play illustration playback", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Pause illustration playback", exact: true })
      .click();
    await page.clock.fastForward(6000);
    await expect(page.getByText("Step 1 of 3", { exact: true })).toBeVisible();
    await page
      .getByRole("button", { name: "Inspect pairing", exact: true })
      .first()
      .click();
    await expect(page.getByRole("dialog")).toContainText(
      "pairs with the tRNA anticodon",
    );
    await page.locator(".scientific-illustration").last().screenshot({
      path: "docs/v212-figures/translation-interactive-700.png",
    });
  } finally {
    await page.close();
  }
});

test("annotation letters clear structural strokes without concealing the mechanism behind label plates", async () => {
  const page = await browser.newPage({ viewport: { width: 700, height: 900 } });
  try {
    for (const type of ["translation", "membrane"])
      for (let step = 0; step < (type === "translation" ? 3 : 2); step++) {
        await page.setContent(html(type, step, "light"));
        await expect(
          page.locator(
            ".science-trna-label-plate,.science-annotation-plate,[data-science-plate]",
          ),
        ).toHaveCount(0);
        const collisions = await page
          .locator(".scientific-svg")
          .evaluate((svg) => {
            const labels = [
              ...svg.querySelectorAll<SVGTextElement>("text"),
            ].filter((el) => !el.closest("[clip-path]"));
            const shapes = [
              ...svg.querySelectorAll<SVGGeometryElement>(
                "path,rect,circle,line,polyline,polygon",
              ),
            ].filter(
              (shape) =>
                !shape.closest("defs") &&
                getComputedStyle(shape).stroke !== "none",
            );
            const result: { label: string | null; shape: string }[] = [];
            for (const label of labels) {
              const b = label.getBoundingClientRect();
              for (const shape of shapes) {
                const r = shape.getBoundingClientRect();
                if (
                  r.right < b.left ||
                  r.left > b.right ||
                  r.bottom < b.top ||
                  r.top > b.bottom
                )
                  continue;
                const matrix = shape.getScreenCTM();
                if (!matrix) continue;
                const clippedGroup = shape.closest<SVGGElement>("[clip-path]");
                const clipId = clippedGroup
                  ?.getAttribute("clip-path")
                  ?.match(/#([^)]*)/)?.[1];
                const clipRect = clipId
                  ? svg.querySelector<SVGRectElement>(
                      `clipPath[id="${clipId}"] rect`,
                    )
                  : null;
                const clipMatrix = clippedGroup?.getScreenCTM();
                const clipBounds =
                  clipRect && clipMatrix
                    ? [
                        new DOMPoint(
                          clipRect.x.baseVal.value,
                          clipRect.y.baseVal.value,
                        ).matrixTransform(clipMatrix),
                        new DOMPoint(
                          clipRect.x.baseVal.value +
                            clipRect.width.baseVal.value,
                          clipRect.y.baseVal.value +
                            clipRect.height.baseVal.value,
                        ).matrixTransform(clipMatrix),
                      ]
                    : null;
                const length = shape.getTotalLength();
                for (let at = 0; at <= length; at += 1.5) {
                  const p = shape.getPointAtLength(at).matrixTransform(matrix);
                  if (
                    clipBounds &&
                    (p.x < clipBounds[0].x ||
                      p.x > clipBounds[1].x ||
                      p.y < clipBounds[0].y ||
                      p.y > clipBounds[1].y)
                  )
                    continue;
                  if (
                    p.x > b.left - 1 &&
                    p.x < b.right + 1 &&
                    p.y > b.top - 1 &&
                    p.y < b.bottom + 1
                  ) {
                    result.push({
                      label: label.textContent,
                      shape: shape.getAttribute("class") || shape.tagName,
                    });
                    break;
                  }
                }
              }
            }
            return result;
          });
        expect(
          collisions,
          `${type} step ${step} must not cross letters with unrelated structural edges`,
        ).toEqual([]);
      }
  } finally {
    await page.close();
  }
});

test("both membrane routes conserve particles between explanatory steps and export valid standalone SVG", async () => {
  const page = await browser.newPage({ viewport: { width: 900, height: 800 } });
  try {
    for (let step = 0; step < 2; step++) {
      await page.setContent(html("membrane", step, "custom"));
      await expect(page.locator(".science-oxygen")).toHaveCount(8);
      await expect(page.locator(".science-solute")).toHaveCount(8);
      const transport = page.locator('[data-science-layer="net-flow-arrows"]');
      expect(
        await transport.locator("path").evaluateAll((paths) =>
          paths.map((path) => ({
            start: path.hasAttribute("marker-start"),
            end: path.hasAttribute("marker-end"),
          })),
        ),
      ).toEqual([
        { start: step === 1, end: true },
        { start: step === 1, end: true },
      ]);
      await expect(
        page.getByText(
          step
            ? "Equal concentrations: no net flow."
            : "Net movement follows the concentration gradient.",
          { exact: true },
        ),
      ).toHaveCount(1);
      const distribution = await page
        .locator(".scientific-svg")
        .evaluate((svg) => ({
          oxygen: [
            ...svg.querySelectorAll<SVGCircleElement>(".science-oxygen"),
          ].reduce(
            (count, particle) => {
              count[particle.cy.baseVal.value < 200 ? 0 : 1]++;
              return count;
            },
            [0, 0],
          ),
          channel: [
            ...svg.querySelectorAll<SVGRectElement>(".science-solute"),
          ].reduce(
            (count, particle) => {
              count[particle.y.baseVal.value < 200 ? 0 : 1]++;
              return count;
            },
            [0, 0],
          ),
        }));
      expect(distribution).toEqual({
        oxygen: step ? [4, 4] : [6, 2],
        channel: step ? [4, 4] : [6, 2],
      });
      await expect(
        page.getByText("Simple diffusion", { exact: true }),
      ).toHaveCount(1);
      await expect(
        page.getByText("Facilitated diffusion", { exact: true }),
      ).toHaveCount(1);
      const exported = await page.locator(".scientific-svg").evaluate((svg) => {
        const clone = svg.cloneNode(true) as SVGSVGElement;
        const originals = [svg, ...svg.querySelectorAll("*")];
        [clone, ...clone.querySelectorAll("*")].forEach((el, i) => {
          const style = getComputedStyle(originals[i]);
          for (const key of [
            "fill",
            "stroke",
            "stroke-width",
            "font-family",
            "font-size",
            "font-weight",
          ])
            (el as SVGElement).style.setProperty(
              key,
              style.getPropertyValue(key),
            );
        });
        return new XMLSerializer().serializeToString(clone);
      });
      expect(XMLValidator.validate(exported)).toBe(true);
      expect(exported).toContain('markerUnits="userSpaceOnUse"');
      expect(exported).not.toContain("var(--accent");
      await page.setContent(
        `<img width="800" alt="Exported membrane figure" src="data:image/svg+xml,${encodeURIComponent(exported)}">`,
      );
      const loaded = await page
        .getByAltText("Exported membrane figure")
        .evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0);
      expect(loaded).toBe(true);
    }
  } finally {
    await page.close();
  }
});
