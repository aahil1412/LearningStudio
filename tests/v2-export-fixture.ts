import type { OfflineExportPayload } from "../src/v2types";
import type { ExportAssets } from "../src/export/contracts";
import type { ExportOptions } from "../electron/exporter";
import { readFileSync } from "node:fs";
import { join } from "node:path";
export const dotImage =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==";
export function exportFixture(): {
  payload: OfflineExportPayload;
  assets: Partial<ExportAssets>;
  assetRecords?: ExportOptions["assetRecords"];
} {
  const now = "2026-10-28T12:00:00.000Z";
  const fixture: {
    payload: OfflineExportPayload;
    assets: Partial<ExportAssets>;
    assetRecords?: ExportOptions["assetRecords"];
  } = {
    payload: {
      title: "A portable study of change",
      lessons: [],
      resources: [],
      visuals: [],
      includeNotes: false,
      includeUserMessages: false,
      exportedAt: now,
      chapters: [
        {
          id: "change",
          subjectId: "subject",
          title: "Understanding local change",
          markdown:
            "## A change you can calculate\n\nFor $f(x)=x^2$, the derivative is $f'(x)=2x$. The symbols and assumptions travel with this chapter.",
          blocks: [
            { type: "equation", latex: "\\frac{(x+h)^2-x^2}{h}=2x+h" },
            {
              type: "plot",
              spec: {
                kind: "derivative",
                title: "A calculated tangent",
                xLabel: "x (dimensionless)",
                yLabel: "f(x) (dimensionless)",
              },
            },
            {
              type: "diagram",
              spec: {
                title: "From average to local",
                nodes: [
                  {
                    id: "a",
                    label: "Choose a change",
                    detail: "Take a nonzero interval h.",
                  },
                  {
                    id: "b",
                    label: "Compute the average",
                    detail: "Divide output change by input change.",
                  },
                  {
                    id: "c",
                    label: "Take the limit",
                    detail: "Let h approach zero after forming the quotient.",
                  },
                ],
                edges: [
                  { from: "a", to: "b" },
                  { from: "b", to: "c" },
                ],
              },
            },
            {
              type: "exercise",
              question: "What is the tangent slope of x² at x = 3?",
              hint: "Use f′(x) = 2x.",
              answer: "The slope is 6.",
            },
            { type: "image", query: "licensed fixture image" },
            {
              type: "molecule",
              source: "pdb",
              id: "1CRN",
              caption: "Real RCSB crambin · 1CRN",
            },
          ],
          citations: [
            {
              label: "RCSB PDB · 1CRN",
              url: "https://www.rcsb.org/structure/1CRN",
            },
          ],
          originMessageIds: ["selected-message"],
          revision: 1,
          createdAt: now,
          updatedAt: now,
        },
        {
          id: "limits",
          subjectId: "subject",
          title: "Limits and neighborhoods",
          markdown:
            "A limit describes nearby behavior. This chapter is searchable even when it is not currently open.\n\n<script>window.__exportAttack=true</script>",
          blocks: [],
          citations: [],
          originMessageIds: [],
          revision: 1,
          createdAt: now,
          updatedAt: now,
        },
      ],
    },
    assets: {
      images: {
        "licensed fixture image": [
          {
            id: "fixture",
            title: "Authored one-pixel test image",
            url: dotImage,
            thumbnail: dotImage,
            source: "https://example.org/authored-test-image",
            author: "Learning Studio test fixture",
            license: "CC0",
            licenseUrl: "https://creativecommons.org/publicdomain/zero/1.0/",
            caption:
              "An authored raster fixture with explicit attribution, used to verify offline embedding.",
          },
        ],
      },
      structures: {
        "pdb:1CRN": {
          data: readFileSync(
            join(process.cwd(), "tests/fixtures/v2-1crn.pdb"),
            "utf8",
          ),
          format: "pdb",
          sourceUrl: "https://files.rcsb.org/download/1CRN.pdb",
          name: "Crambin · real RCSB 1CRN coordinates",
        },
      },
    },
  };
  const chapter = fixture.payload.chapters[0],
    structure = fixture.assets.structures!["pdb:1CRN"];
  fixture.payload.visuals = [
    {
      id: "saved-tangent",
      subjectId: "subject",
      block: chapter.blocks[1],
      state: {
        "plot.parameters": { point: 2 },
        "plot.layout": { xaxis: { range: [-2, 4], autorange: false } },
        "plot.secret": "HIDDEN_STATE_SENTINEL",
      },
      placement: "side",
      tags: [],
      annotations: [],
      originMessageId: "selected-message",
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "saved-crambin",
      subjectId: "subject",
      block: chapter.blocks[5],
      state: {
        "molecule.structure": { assetId: "crambin-source" },
        "molecule.style": "stick",
      },
      placement: "split",
      tags: [],
      annotations: [],
      originMessageId: "selected-message",
      createdAt: now,
      updatedAt: now,
    },
  ];
  fixture.assetRecords = {
    "crambin-source": { kind: "visual-source", value: structure },
  };
  return fixture;
}
