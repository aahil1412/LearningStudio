import {
  test,
  expect,
  chromium,
  type Browser,
  type Page,
} from "@playwright/test";
import { build } from "esbuild";
import { readFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { writeOfflineTextbook } from "../electron/exporter";
import { pathToFileURL } from "node:url";
import type { IllustrationSpec } from "../src/types";
let browser: Browser;
const bundle = resolve(".tools/scientific-models-v22.js");
let css = "";
test.beforeAll(async () => {
  await mkdir(".tools", { recursive: true });
  await mkdir("docs/v22-figures", { recursive: true });
  await build({
    stdin: {
      contents: `import React,{useState,useEffect} from 'react';import{createRoot}from'react-dom/client';import ScientificIllustration from './src/components/visuals/ScientificIllustration';import{VisualRuntimeContext}from'./src/lib/visualState';let serial=0;const root=createRoot(document.getElementById('root'));function Host({spec,initial}){const[state,setState]=useState(initial);useEffect(()=>{window.scienceState=state;},[state]);return React.createElement(VisualRuntimeContext.Provider,{value:{id:'model',subjectId:'subject',state,placement:'inline',visible:true,patch:patch=>setState(value=>({...value,...patch})),move:()=>{},storeAsset:async()=>'',loadAsset:async()=>null}},React.createElement(ScientificIllustration,{spec}));}window.mountScience=(spec,initial={})=>root.render(React.createElement(Host,{key:++serial,spec,initial}));`,
      resolveDir: process.cwd(),
      loader: "tsx",
    },
    bundle: true,
    format: "iife",
    platform: "browser",
    outfile: bundle,
    logLevel: "silent",
  });
  css = await readFile(bundle.replace(/\.js$/, ".css"), "utf8");
  browser = await chromium.launch({ channel: "chrome", headless: true });
});
test.afterAll(async () => browser?.close());
async function mount(
  page: Page,
  spec: IllustrationSpec,
  state: Record<string, unknown> = {},
  dark = false,
  width = 690,
) {
  await page.setViewportSize({
    width: Math.max(900, width + 80),
    height: 1050,
  });
  await page.setContent(
    `<style>:root{--text:${dark ? "#e9e6de" : "#272d32"};--heading:var(--text);--secondary:${dark ? "#c2bfb6" : "#53606a"};--figure:${dark ? "#20262d" : "#f9faf8"};--surface:${dark ? "#29313a" : "#eef1ee"};--popover:var(--surface);--border:${dark ? "#53606a" : "#c7cecd"};--accent:${dark ? "#8cc2af" : "#2f6e60"};--selected:${dark ? "#34483e" : "#dcebe3"};--link:var(--accent);--reading-font:'Segoe UI',sans-serif;--ui-font:'Segoe UI',sans-serif}*{box-sizing:border-box}body{margin:24px;background:var(--figure);color:var(--text);font-family:var(--reading-font)}#root{width:${width}px;max-width:100%;margin:auto}.science-export{padding:12px}.science-export button{padding:7px 12px;background:var(--surface);color:var(--text);border:1px solid var(--border);border-radius:6px}${css}</style><div id="root"></div>`,
  );
  await page.addScriptTag({ path: bundle });
  await page.evaluate(
    ({ spec, state }) => (window as any).mountScience(spec, state),
    { spec, state },
  );
  await expect(page.locator(".scientific-illustration")).toBeVisible();
}
const field: IllustrationSpec = {
  template: "field-explorer",
  title: "A field takes a value at every position",
  field: { mode: "packet" },
};
const aggregation: IllustrationSpec = {
  template: "protein-aggregation",
  title: "Exposed chains can associate",
  aggregation: { condensate: true },
};
const vertex: IllustrationSpec = {
  template: "interaction-vertices",
  title: "Compare elementary gauge-field couplings",
  interaction: { theory: "qcd", vertex: "three-boson" },
};
test("calculated field parameters change geometry and numerical values, playback changes time, and state rehydrates", async () => {
  const page = await browser.newPage();
  try {
    await mount(page, field);
    const curve = page.locator(".field-line"),
      before = await curve.getAttribute("d");
    await page
      .getByRole("slider", { name: "Field amplitude", exact: true })
      .fill("1.6");
    await expect(curve).not.toHaveAttribute("d", before!);
    await expect(page.locator(".model-readout")).toContainText("1.600");
    await page
      .getByRole("slider", { name: "Model time", exact: true })
      .fill("4");
    await expect(page.locator(".model-readout")).not.toContainText("φ=1.600");
    await page.getByRole("button", { name: "Play model", exact: true }).click();
    await expect
      .poll(() =>
        page
          .getByRole("slider", { name: "Model time", exact: true })
          .inputValue(),
      )
      .not.toBe("4");
    await page.getByRole("button", { name: "Pause", exact: true }).click();
    const svg = page.locator(".model-svg"),
      box = (await svg.boundingBox())!;
    await page.mouse.click(box.x + box.width * 0.58, box.y + box.height * 0.45);
    const popup = page.getByRole("dialog", {
      name: "Inspect the field",
      exact: true,
    });
    await expect(popup).toBeVisible();
    expect((await popup.boundingBox())!.y).toBeGreaterThanOrEqual(16);
    const state = await page.evaluate(() => (window as any).scienceState);
    await mount(page, field, state, true);
    await expect(
      page.getByRole("slider", { name: "Field amplitude", exact: true }),
    ).toHaveValue("1.6");
    await page.screenshot({ path: "docs/v22-figures/field-packet-dark.png" });
  } finally {
    await page.close();
  }
});
test("association changes chain geometry, preserves material, responds to phase partitioning, and opens local feedback", async () => {
  const page = await browser.newPage();
  try {
    await mount(page, aggregation);
    await expect(page.locator('[data-chain-state="aggregated"]')).toHaveCount(
      0,
    );
    await page
      .getByRole("slider", { name: "Model time", exact: true })
      .fill("8");
    await expect
      .poll(() => page.locator('[data-chain-state="aggregated"]').count())
      .toBeGreaterThan(0);
    const count = await page.locator('[data-chain-state="aggregated"]').count();
    await page
      .getByRole("slider", { name: "Association rate", exact: true })
      .fill("0");
    await expect(page.locator('[data-chain-state="aggregated"]')).toHaveCount(
      0,
    );
    await page
      .getByRole("slider", { name: "Association rate", exact: true })
      .fill("0.8");
    expect(
      await page.locator('[data-chain-state="aggregated"]').count(),
    ).toBeGreaterThanOrEqual(count);
    await page
      .getByRole("button", { name: "Inspect protein 20", exact: true })
      .focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("dialog")).toBeVisible();
    const popup = (await page.getByRole("dialog").boundingBox())!;
    expect(popup.y + popup.height).toBeLessThanOrEqual(1050);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page.locator(".scientific-illustration").screenshot({
      path: "docs/v22-figures/protein-aggregation-condensate.png",
    });
    await page
      .getByRole("slider", {
        name: "Fraction with exposed patches",
        exact: true,
      })
      .fill("0");
    await expect(
      page.locator(
        '[data-chain-state="aggregated"],[data-chain-state="exposed"]',
      ),
    ).toHaveCount(0);
  } finally {
    await page.close();
  }
});
test("QCD controls change actual vertex topology, QED has no fake elementary self-vertices, and branch feedback is anchored", async () => {
  const page = await browser.newPage();
  try {
    await mount(page, vertex);
    await expect(page.locator(".vertex-boson-wave")).toHaveCount(3);
    await page
      .getByRole("button", { name: "Four gluons", exact: true })
      .click();
    await expect(page.locator(".vertex-boson-wave")).toHaveCount(4);
    await expect(page.locator(".vertex-fermion")).toHaveCount(0);
    await page
      .getByRole("button", { name: "Inspect gluon line 1", exact: true })
      .focus();
    await page.keyboard.press("Enter");
    await expect(
      page.getByRole("dialog", { name: "Gluon line", exact: true }),
    ).toBeVisible();
    await page.screenshot({
      path: "docs/v22-figures/qcd-four-gluon-inspection.png",
    });
    await page.keyboard.press("Escape");
    await page
      .getByRole("button", { name: "Electromagnetism · QED", exact: true })
      .click();
    await expect(page.locator(".interaction-explorer")).toHaveAttribute(
      "data-interaction-vertex",
      "matter",
    );
    await expect(page.locator(".vertex-boson-wave")).toHaveCount(1);
    await expect(
      page.getByRole("button", { name: "Four gluons", exact: true }),
    ).toHaveCount(0);
    await expect(page.locator(".vertex-fermion")).toHaveCount(1);
    await page.screenshot({ path: "docs/v22-figures/qed-matter-vertex.png" });
  } finally {
    await page.close();
  }
});
test("a generic one-step relationship diagram has no fake playback and clicking gets immediate local explanation", async () => {
  const page = await browser.newPage();
  try {
    const spec: IllustrationSpec = {
      template: "scene",
      title: "A relationship to inspect",
      scene: {
        participants: [
          {
            id: "folded",
            label: "Compact chain",
            shape: "protein",
            description: "A compact chain.",
          },
          {
            id: "exposed",
            label: "Extended chain",
            shape: "unfolded-protein",
            description: "An extended chain.",
          },
        ],
        relations: [
          {
            from: "folded",
            to: "exposed",
            label: "A change in conformation.",
            kind: "conversion",
          },
        ],
        steps: [
          {
            id: "only",
            label: "Conformation",
            description: "One relationship is shown.",
            activeIds: ["folded", "exposed"],
          },
        ],
      },
    };
    await mount(page, spec);
    // At a desktop width there is enough room beside the entire drawing.
    // The explanation must not cover any part of that drawing.
    await page.setViewportSize({ width: 1600, height: 1050 });
    await expect(
      page.getByRole("button", { name: /Play explanation/ }),
    ).toHaveCount(0);
    await expect(page.getByLabel("Scientific scene steps")).toHaveCount(0);
    await page
      .getByRole("button", { name: "Inspect Extended chain", exact: true })
      .click();
    await expect(
      page.getByRole("dialog", { name: "Extended chain", exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("dialog")).toContainText("An extended chain.");
    await expect(page.locator(".scene-inspector")).not.toContainText(
      "An extended chain.",
    );
    await expect
      .poll(
        async () => {
          const drawing = (await page.locator(".scene-svg").boundingBox())!,
            popup = (await page.getByRole("dialog").boundingBox())!;
          return (
            Math.max(
              0,
              Math.min(drawing.x + drawing.width, popup.x + popup.width) -
                Math.max(drawing.x, popup.x),
            ) *
            Math.max(
              0,
              Math.min(drawing.y + drawing.height, popup.y + popup.height) -
                Math.max(drawing.y, popup.y),
            )
          );
        },
        {
          message:
            "When side space exists, the explanation stays outside the complete SVG",
        },
      )
      .toBe(0);
    await page.screenshot({
      path: "docs/v22-figures/local-scene-inspection-unobstructed.png",
    });
    const saved = await page.evaluate(() => (window as any).scienceState);
    await mount(page, spec, saved);
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.locator(".scene-inspector")).toContainText(
      "An extended chain.",
    );
  } finally {
    await page.close();
  }
});
test("translation selections show a nearby explanation without scrolling to the figure end", async () => {
  const page = await browser.newPage();
  try {
    await mount(page, {
      template: "translation",
      title: "Inspect translation",
    });
    await page
      .getByRole("button", { name: "Inspect tRNA", exact: true })
      .first()
      .focus();
    await page.keyboard.press("Enter");
    await expect(
      page.getByRole("dialog", { name: "tRNA: an adaptor", exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("dialog")).toContainText(
      "transfer RNA recognizes a complementary mRNA codon",
    );
    await expect(page.locator(".science-inspector")).not.toContainText(
      "transfer RNA recognizes a complementary mRNA codon",
    );
    const popup = (await page.getByRole("dialog").boundingBox())!;
    expect(popup.y + popup.height).toBeLessThanOrEqual(1050);
    await page.screenshot({
      path: "docs/v22-figures/translation-local-inspector-unobstructed.png",
    });
    const controls = await page
      .locator(".science-step-controls button")
      .evaluateAll((items) =>
        items.map((item) => {
          const r = item.getBoundingClientRect();
          return { x: r.x, y: r.y, width: r.width, height: r.height };
        }),
      );
    for (const control of controls) {
      const area =
        Math.max(
          0,
          Math.min(popup.x + popup.width, control.x + control.width) -
            Math.max(popup.x, control.x),
        ) *
        Math.max(
          0,
          Math.min(popup.y + popup.height, control.y + control.height) -
            Math.max(popup.y, control.y),
        );
      expect(area, "Inspection must leave playback buttons reachable").toBe(0);
    }
    await page.getByRole("button", { name: "Next step", exact: true }).click();
    await expect(page.getByText("Step 2 of 3", { exact: true })).toBeVisible();
  } finally {
    await page.close();
  }
});

test("offline trusted models retain safe saved parameters and actual interactive mechanisms", async () => {
  const context = await browser.newContext({
    viewport: { width: 1250, height: 1100 },
  });
  await context.setOffline(true);
  const page = await context.newPage();
  const requests: string[] = [];
  page.on("request", (request) => {
    if (/^https?:/.test(request.url())) requests.push(request.url());
  });
  try {
    const now = "2026-10-28T12:00:00Z",
      path = resolve(".tools/scientific-models-offline.html");
    const specs = [field, aggregation, vertex],
      states = [
        {
          "field.amplitude": 1.7,
          "field.mode": "wave",
          "field.time": 2,
          "field.secret": "PRIVATE_MODEL_SENTINEL",
        },
        {
          "aggregation.time": 8,
          "aggregation.partition": 6,
          "aggregation.condensate": true,
        },
        { "interaction.theory": "qcd", "interaction.vertex": "four-boson" },
      ];
    await writeOfflineTextbook(
      path,
      {
        title: "Trusted models, portable edition",
        lessons: [],
        resources: [],
        visuals: specs.map((spec, i) => ({
          id: "model-" + i,
          subjectId: "subject",
          block: { type: "illustration" as const, spec },
          state: states[i],
          placement: "inline" as const,
          tags: [],
          annotations: [],
          createdAt: now,
          updatedAt: now,
        })),
        includeNotes: false,
        includeUserMessages: false,
        exportedAt: now,
        chapters: specs.map((spec, i) => ({
          id: "chapter-" + i,
          subjectId: "subject",
          title: spec.title,
          markdown: "Authored acceptance fixture, not live model inference.",
          blocks: [{ type: "illustration" as const, spec }],
          citations: [],
          originMessageIds: [],
          revision: 1,
          createdAt: now,
          updatedAt: now,
        })),
      },
      { offlineOnly: true },
    );
    expect(await readFile(path, "utf8")).not.toContain(
      "PRIVATE_MODEL_SENTINEL",
    );
    await page.goto(pathToFileURL(path).href);
    await expect(
      page.getByRole("slider", { name: "Field amplitude", exact: true }),
    ).toHaveValue("1.7");
    const before = await page.locator(".field-line").getAttribute("d");
    await page
      .getByRole("slider", { name: "Field amplitude", exact: true })
      .fill("0.5");
    await expect(page.locator(".field-line")).not.toHaveAttribute("d", before!);
    await page
      .getByRole("navigation", { name: "Textbook chapters", exact: true })
      .getByRole("button")
      .nth(1)
      .click();
    await expect(
      page.getByRole("slider", { name: "Model time", exact: true }),
    ).toHaveValue("8");
    await expect
      .poll(() => page.locator('[data-chain-state="aggregated"]').count())
      .toBeGreaterThan(0);
    await page
      .getByRole("slider", { name: "Association rate", exact: true })
      .fill("0");
    await expect(page.locator('[data-chain-state="aggregated"]')).toHaveCount(
      0,
    );
    await page
      .getByRole("navigation", { name: "Textbook chapters", exact: true })
      .getByRole("button")
      .nth(2)
      .click();
    await expect(page.locator(".vertex-boson-wave")).toHaveCount(4);
    await page
      .getByRole("button", { name: "Three gluons", exact: true })
      .click();
    await expect(page.locator(".vertex-boson-wave")).toHaveCount(3);
    await page
      .getByRole("button", { name: "Inspect interaction vertex", exact: true })
      .click();
    await expect(page.getByRole("dialog")).toBeVisible();
    expect(requests).toEqual([]);
  } finally {
    await context.close();
  }
});
