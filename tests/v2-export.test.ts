import { describe, expect, it } from "vitest";
import {
  composeOfflineBook,
  exportVisualState,
  offlineHtml,
  portableZip,
  prepareOfflineBook,
  renderOfflineTextbook,
} from "../electron/exporter";
import { exportFixture } from "./v2-export-fixture";
import { scientificScenes } from "./scientific-scenes-fixture";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
describe("standalone export data and resource boundaries", () => {
  it("exports validated scientific figure focus and steps without autoplay or private state", () => {
    const block = { type: "illustration" as const, spec: scientificScenes.photosynthesis };
    expect(exportVisualState(block, {
      "scene.step": 1, "scene.relation": 2, "scene.selection": "chloroplast",
      "scene.playing": true, "scene.secret": "PRIVATE", "illustration.playing": true,
    })).toEqual({ "scene.step": 1, "scene.relation": 2, "scene.selection": "chloroplast" });
    expect(exportVisualState(block, { "scene.step": Infinity, "scene.relation": 99, "scene.selection": "not-a-participant" })).toEqual({});
    const translation = { type: "illustration" as const, spec: { template: "translation" as const, title: "Translation" } };
    expect(exportVisualState(translation, { "illustration.step": 2, "illustration.selection": "trna", "illustration.playing": true, "illustration.hidden": "PRIVATE" })).toEqual({ "illustration.step": 2, "illustration.selection": "trna" });
    expect(exportVisualState(translation, { "illustration.selection": "not-a-participant", "scene.selection": "chloroplast" })).toEqual({});
  });
  it("exports only selected visible content and never includes hidden object fields, notes, user messages, or empty selections", () => {
    const { payload } = exportFixture();
    const now = payload.exportedAt;
    const extra = {
      ...payload,
      chapters: [],
      memory: { content: "HIDDEN_MEMORY_SENTINEL" },
      accessToken: "PRIVATE_ACCOUNT_SENTINEL",
      lessons: [
        {
          id: "lesson",
          title: "Selected lesson",
          subject: "Any",
          mode: "Learn" as const,
          objective: "Learn a visible idea",
          position: "Private current position",
          messages: [
            {
              id: "user",
              role: "user" as const,
              text: "PRIVATE_QUESTION_SENTINEL",
              createdAt: now,
            },
            {
              id: "selected",
              role: "assistant" as const,
              text: "Visible selected explanation",
              createdAt: now,
            },
            {
              id: "unselected",
              role: "assistant" as const,
              text: "UNSELECTED_MESSAGE_SENTINEL",
              createdAt: now,
            },
          ],
          notes: "PRIVATE_NOTES_SENTINEL",
          createdAt: now,
          updatedAt: now,
        },
      ],
      messageIds: ["selected"],
    };
    const book = composeOfflineBook(extra);
    const json = JSON.stringify(book);
    expect(json).toContain("Visible selected explanation");
    for (const hidden of [
      "HIDDEN_MEMORY_SENTINEL",
      "PRIVATE_ACCOUNT_SENTINEL",
      "PRIVATE_QUESTION_SENTINEL",
      "UNSELECTED_MESSAGE_SENTINEL",
      "PRIVATE_NOTES_SENTINEL",
      "Private current position",
    ])
      expect(json).not.toContain(hidden);
    expect(() => composeOfflineBook({ ...extra, messageIds: [] })).toThrow(
      "empty selection",
    );
  });
  it("embeds actual supplied molecular data and licensed raster bytes while retaining provenance", async () => {
    const { payload, assets } = exportFixture(),
      book = await prepareOfflineBook(payload, { assets, offlineOnly: true });
    expect(book.assets.structures["pdb:1CRN"].data).toContain("CRAMBIN");
    expect(book.assets.images["licensed fixture image"][0]).toMatchObject({
      license: "CC0",
      source: "https://example.org/authored-test-image",
    });
    expect(book.assets.images["licensed fixture image"][0].url).toMatch(
      /^data:image\/png;base64,/,
    );
    const excluded = await prepareOfflineBook(payload, {
      assets,
      offlineOnly: true,
      embedResources: false,
    });
    expect(excluded.assets.images).toEqual({});
    expect(excluded.assets.structures).toEqual({});
  });
  it("safely serializes closing script tags and Unicode separators without treating selected text as executable HTML", () => {
    const { payload } = exportFixture();
    payload.title = "</title><script>window.attack=true</script>";
    payload.chapters[0].markdown =
      "</script><script>window.attack=true</script>\u2028\u2029";
    const book = composeOfflineBook(payload),
      html = offlineHtml(book, {
        js: "window.runtimeLoaded=true;",
        css: "body{color:green}",
      });
    expect(html).not.toContain("</title><script>window.attack");
    const match = html.match(
      /<script type="application\/json" id="studio-book-data">([\s\S]*?)<\/script>/,
    );
    expect(match).not.toBeNull();
    expect(JSON.parse(match![1]).chapters[0].markdown).toBe(
      payload.chapters[0].markdown,
    );
    expect(html).toContain("connect-src &#39;none&#39;");
  });
  it("retains actual renderer settings but strips unknown nested state and source metadata and unselected assets", async () => {
    const { payload, assets, assetRecords } = exportFixture();
    payload.visuals[0].state["plot.parameters"] = {
      point: 2,
      accessToken: "PRIVATE_PARAMETER_SENTINEL",
    };
    payload.visuals[0].state["plot.layout"] = {
      xaxis: {
        range: [-2, 4],
        autorange: false,
        token: "PRIVATE_AXIS_SENTINEL",
      },
      private: "PRIVATE_LAYOUT_SENTINEL",
    };
    const source = assetRecords!["crambin-source"].value as Record<
      string,
      unknown
    >;
    source.credentials = "PRIVATE_SOURCE_SENTINEL";
    payload.visuals[1].state["chemical.editor.applied"] = {
      assetId: "ethanol-source",
    };
    payload.visuals[1].state["chemical.editor.input"] =
      "UNAPPLIED_CHEMICAL_DRAFT_SENTINEL";
    assetRecords!["ethanol-source"] = {
      kind: "visual-source",
      value: {
        input: "CCO",
        format: "smiles",
        private: "PRIVATE_CHEMICAL_SENTINEL",
      },
    };
    assetRecords!["unrelated-source"] = {
      kind: "visual-source",
      value: { ...source, name: "UNSELECTED_SOURCE_SENTINEL" },
    };
    assets.images!["unrelated-query"] = [
      {
        ...assets.images!["licensed fixture image"][0],
        title: "UNSELECTED_IMAGE_SENTINEL",
      },
    ];
    const book = await prepareOfflineBook(payload, {
        assets,
        assetRecords,
        offlineOnly: true,
      }),
      json = JSON.stringify(book);
    expect(book.chapters[0].visualStates?.[1].state["plot.parameters"]).toEqual(
      { point: 2 },
    );
    expect(book.chapters[0].visualStates?.[1].state["plot.layout"]).toEqual({
      xaxis: { range: [-2, 4], autorange: false },
    });
    expect(book.assets.sources["ethanol-source"]).toEqual({
      input: "CCO",
      format: "smiles",
    });
    expect(book.assets.chemicals["smiles:CCO"].light.svg).toContain("<svg");
    expect(book.assets.sources["crambin-source"]).toMatchObject({
      data: expect.stringContaining("CRAMBIN"),
      format: "pdb",
    });
    for (const secret of [
      "PRIVATE_PARAMETER_SENTINEL",
      "PRIVATE_AXIS_SENTINEL",
      "PRIVATE_LAYOUT_SENTINEL",
      "PRIVATE_SOURCE_SENTINEL",
      "UNSELECTED_SOURCE_SENTINEL",
      "UNSELECTED_IMAGE_SENTINEL",
      "HIDDEN_STATE_SENTINEL",
      "UNAPPLIED_CHEMICAL_DRAFT_SENTINEL",
      "PRIVATE_CHEMICAL_SENTINEL",
    ])
      expect(json).not.toContain(secret);
    expect(
      exportVisualState(
        {
          type: "plot",
          spec: {
            kind: "surface",
            title: "Safe surface",
            parameters: { a: 1 },
          },
        },
        {
          "advanced.parameters": { a: 2, token: "secret" },
          "three.camera": {
            position: [1, 2, 3],
            quaternion: [0, 0, 0, 1],
            target: [0, 0, 0],
            zoom: 1,
            private: "secret",
          },
        },
      ),
    ).toEqual({
      "advanced.parameters": { a: 2 },
      "three.camera": {
        position: [1, 2, 3],
        quaternion: [0, 0, 0, 1],
        target: [0, 0, 0],
        zoom: 1,
      },
    });
    const withoutNotebook = composeOfflineBook({
      ...payload,
      includeVisualNotebook: true,
      notebookVisualIds: [],
    });
    expect(
      withoutNotebook.chapters.some(
        (chapter) => chapter.id === "visual-notebook",
      ),
    ).toBe(false);
    expect(withoutNotebook.chapters[0].visualStates?.[1].id).toBe(
      "saved-tangent",
    );
  });
  it("bundles the actual runtime, scientific renderer code, styles, and fonts in one HTML document", async () => {
    const { payload, assets } = exportFixture();
    const html = await renderOfflineTextbook(payload, {
      assets,
      offlineOnly: true,
    });
    expect(html.length).toBeGreaterThan(1000000);
    expect(html).toContain("data:font/woff2;base64,");
    expect(html).not.toContain('src="https://');
    expect(html).not.toContain('href="assets/runtime.css"');
  });
  it("produces a portable ZIP readable by an independent ZIP decoder", async () => {
    const bytes = portableZip([
      { name: "index.html", data: Buffer.from("<h1>Portable</h1>") },
      {
        name: "assets/runtime.js",
        data: Buffer.from('console.log("offline")'),
      },
    ]);
    const decoded = await require("unzipper").Open.buffer(bytes);
    expect(decoded.files.map((file: { path: string }) => file.path)).toEqual([
      "index.html",
      "assets/runtime.js",
    ]);
    expect((await decoded.files[0].buffer()).toString()).toBe(
      "<h1>Portable</h1>",
    );
  });
});
