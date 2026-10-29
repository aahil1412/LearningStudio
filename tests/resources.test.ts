import { afterEach, describe, expect, it, vi } from "vitest";
import {
  boundedFetch,
  fetchStructure,
  searchImages,
} from "../electron/resources";
afterEach(() => {
  vi.unstubAllGlobals();
});
describe("bounded educational resources", () => {
  it("rejects local URLs, off-list hosts, credentials and nonstandard ports before fetching", async () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    for (const url of [
      "http://127.0.0.1/private",
      "https://example.com/image",
      "https://user:pass@commons.wikimedia.org/x",
      "https://commons.wikimedia.org:8443/x",
    ])
      await expect(boundedFetch(url)).rejects.toThrow("not allowed");
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("uses redirect rejection and a finite byte bound even when content-length is absent", async () => {
    let cancelled = false;
    const fetcher = vi.fn(
      async (_url: unknown, _options?: unknown) =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new Uint8Array(11));
            },
            cancel() {
              cancelled = true;
            },
          }),
        ),
    );
    vi.stubGlobal("fetch", fetcher);
    await expect(boundedFetch("https://files.rcsb.org/x", 10)).rejects.toThrow(
      "size limit",
    );
    expect(cancelled).toBe(true);
    expect(fetcher.mock.calls[0][1]).toMatchObject({ redirect: "error" });
  });
  it("retains source attribution and ignores unsafe thumbnails and unknown reuse licenses", async () => {
    const good = {
      pageid: 1,
      title: "File:Educational figure.png",
      imageinfo: [
        {
          url: "https://upload.wikimedia.org/figure.png",
          thumburl: "https://upload.wikimedia.org/thumb.png",
          descriptionurl:
            "https://commons.wikimedia.org/wiki/File:Educational_figure.png",
          extmetadata: {
            LicenseShortName: { value: "CC BY-SA 4.0" },
            LicenseUrl: {
              value: "https://creativecommons.org/licenses/by-sa/4.0/",
            },
            Artist: { value: '<a href="https://example.org">Author</a>' },
            ImageDescription: { value: "An educational figure" },
          },
        },
      ],
    };
    const unsafe = structuredClone(good);
    unsafe.pageid = 2;
    unsafe.imageinfo[0].thumburl = "file:///C:/private.png";
    const copyrighted = structuredClone(good);
    copyrighted.pageid = 3;
    copyrighted.imageinfo[0].extmetadata.LicenseShortName.value =
      "All rights reserved";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          query: { pages: { one: good, two: unsafe, three: copyrighted } },
        }),
      ),
    );
    const images = await searchImages("broad educational topic");
    expect(images).toHaveLength(1);
    expect(images[0]).toMatchObject({
      author: "Author",
      license: "CC BY-SA 4.0",
      caption: "An educational figure",
    });
    expect(images[0].source).toContain("commons.wikimedia.org");
  });
  it("validates structure identifiers and only accepts real structure response formats", async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(
          "ATOM      1  N   ALA A   1      11.100  12.200  13.300\nEND",
        ),
    );
    vi.stubGlobal("fetch", fetcher);
    expect(await fetchStructure("pdb", "1crn")).toMatchObject({
      format: "pdb",
      sourceUrl: "https://files.rcsb.org/download/1CRN.pdb",
    });
    await expect(fetchStructure("pdb", "../../secret")).rejects.toThrow(
      "accession",
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("<html>provider unavailable</html>")),
    );
    await expect(fetchStructure("pubchem", "2244")).rejects.toThrow(
      "no readable molecular structure",
    );
  });
  it("uses Wikimedia raster thumbnails for scientific SVG originals and refuses raw SVG thumbnails", async () => {
    const svg = {
      pageid: 4,
      title: "File:Mitosis.svg",
      imageinfo: [
        {
          url: "https://upload.wikimedia.org/mitosis.svg",
          thumburl:
            "https://thumb.wikimedia.org/thumb/mitosis.svg/800px-mitosis.svg.png",
          descriptionurl: "https://commons.wikimedia.org/wiki/File:Mitosis.svg",
          extmetadata: {
            LicenseShortName: { value: "CC BY-SA 4.0" },
            Artist: { value: "Scientific illustrator" },
          },
        },
      ],
    };
    const raw = structuredClone(svg);
    raw.pageid = 5;
    raw.imageinfo[0].thumburl = "https://upload.wikimedia.org/raw.svg";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({ query: { pages: { rasterized: svg, unsafe: raw } } }),
      ),
    );
    const images = await searchImages("mitosis diagram");
    expect(images).toHaveLength(1);
    expect(images[0].url).toBe(svg.imageinfo[0].thumburl);
    expect(images[0].thumbnail).toBe(svg.imageinfo[0].thumburl);
    expect(images[0].source).toContain("File:Mitosis.svg");
    expect(images[0].license).toBe("CC BY-SA 4.0");
  });
  it("surfaces provider failure without accepting an error body as a resource", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("Unavailable", { status: 503 })),
    );
    await expect(searchImages("mitosis")).rejects.toThrow("503");
  });
});
