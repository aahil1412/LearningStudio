import { afterEach, describe, it, expect, vi } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import {
  searchImages,
  searchOpenverseImages,
  searchPmcImages,
  configureResourceCache,
  cacheImage,
  cachedImages,
} from "../electron/resources";
import { researchSearch, verifyReference } from "../electron/research";
const directories: string[] = [];
afterEach(async () => {
  vi.unstubAllGlobals();
  for (const path of directories.splice(0))
    await rm(path, { recursive: true, force: true });
});
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aetkAAAAASUVORK5CYII=",
  "base64",
);
const openverseImage = {
  id: "bbb64cd3-830f-47a2-b714-629871ff24fc",
  title: "A cell diagram",
  license: "by-sa",
  license_version: "4.0",
  license_url: "https://creativecommons.org/licenses/by-sa/4.0/",
  foreign_landing_url: "https://www.flickr.com/photos/public/123",
  creator: "Example author",
};
describe("image provider and persistent cache boundaries", () => {
  it("excludes an individual PMC figure with a restrictive permission override", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: URL | string) => {
        const path = String(url);
        if (path.includes("esearch"))
          return Response.json({ esearchresult: { idlist: ["777"] } });
        if (path.includes("list-type"))
          return new Response(
            "<ListBucketResult><CommonPrefixes><Prefix>PMC777.1/</Prefix></CommonPrefixes></ListBucketResult>",
          );
        if (path.endsWith(".json"))
          return Response.json({
            title: "Licensed article with an excluded figure",
            license_code: "CC BY",
            media_urls: ["s3://pmc-oa-opendata/PMC777.1/figure.jpg"],
            xml_url: "s3://pmc-oa-opendata/PMC777.1/PMC777.1.xml",
          });
        return new Response(
          '<article><body><fig><caption><p>Reproduced with permission. All rights reserved.</p></caption><permissions><copyright-statement>Third party copyright</copyright-statement></permissions><graphic xlink:href="figure"/></fig></body></article>',
        );
      }),
    );
    expect(await searchPmcImages("pathway")).toEqual([]);
  });
  it("uses only Openverse proxy URLs and excludes restrictive or unsafe source metadata", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          results: [
            openverseImage,
            { ...openverseImage, license: "by-nc" },
            { ...openverseImage, foreign_landing_url: "file:///private" },
          ],
        }),
      ),
    );
    const result = await searchOpenverseImages("cell division");
    expect(result).toHaveLength(1);
    expect(result[0].url).toBe(
      `https://api.openverse.org/v1/images/${openverseImage.id}/thumb/`,
    );
    expect(result[0].author).toBe("Example author");
  });
  it("persists only issued licensed raster bytes and restores verified provenance offline", async () => {
    const path = await mkdtemp(join(process.cwd(), ".resource-cache-test-"));
    directories.push(path);
    configureResourceCache(path);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: URL | string) =>
        String(url).includes("/thumb/")
          ? new Response(png)
          : Response.json({ results: [openverseImage] }),
      ),
    );
    const [image] = await searchImages("cell diagram", {
      provider: "openverse",
    });
    const cached = await cacheImage(image);
    expect(cached.cached).toBe(true);
    expect(cached.url).toMatch(/^data:image\/png;base64,/);
    expect(cached.source).toBe(openverseImage.foreign_landing_url);
    configureResourceCache(path);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("offline");
      }),
    );
    const [offline] = await searchImages("cell", { provider: "openverse" });
    expect(offline.offline).toBe(true);
    expect(offline.cachedAt).toBe(cached.cachedAt);
    expect(offline.sha256).toBe(cached.sha256);
    expect(
      JSON.parse(await readFile(join(path, "index.json"), "utf8")).entries,
    ).toHaveLength(1);
    await expect(
      cacheImage({
        id: "forged",
        url: "https://127.0.0.1/private",
        license: "CC0",
      } as any),
    ).rejects.toThrow("Search for a permitted");
    expect(await cachedImages("unmatched")).toEqual([]);
  });
  it("rejects raw SVG returned by an image endpoint instead of caching active content", async () => {
    const path = await mkdtemp(join(process.cwd(), ".resource-cache-test-"));
    directories.push(path);
    configureResourceCache(path);
    const image = {
      ...openverseImage,
      id: "aab64cd3-830f-47a2-b714-629871ff24fc",
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: URL | string) =>
        String(url).includes("/thumb/")
          ? new Response("<svg onload='bad()'/>")
          : Response.json({ results: [image] }),
      ),
    );
    const [result] = await searchImages("cell", { provider: "openverse" });
    await expect(cacheImage(result)).rejects.toThrow("not a supported raster");
  });
  it("uses current NIH per-version license metadata and figure captions", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: URL | string) => {
        const path = String(url);
        if (path.includes("esearch"))
          return Response.json({ esearchresult: { idlist: ["123"] } });
        if (path.includes("list-type"))
          return new Response(
            "<ListBucketResult><CommonPrefixes><Prefix>PMC123.2/</Prefix></CommonPrefixes></ListBucketResult>",
          );
        if (path.endsWith(".json"))
          return Response.json({
            title: "A real article title",
            license_code: "CC-BY-4.0",
            media_urls: [
              "https://pmc-oa-opendata.s3.amazonaws.com/PMC123.2/figure1.jpg",
            ],
            xml_url:
              "https://pmc-oa-opendata.s3.amazonaws.com/PMC123.2/PMC123.2.xml",
          });
        return new Response(
          '<article><body><fig><label>Figure 1</label><caption><p>The measured pathway.</p></caption><graphic xlink:href="figure1"/></fig></body></article>',
        );
      }),
    );
    const result = await searchPmcImages("pathway");
    expect(result).toHaveLength(1);
    expect(result[0].caption).toBe("The measured pathway.");
    expect(result[0].license).toBe("CC BY 4.0");
    expect(result[0].source).toBe(
      "https://pmc.ncbi.nlm.nih.gov/articles/PMC123/",
    );
  });
});
describe("public reference metadata", () => {
  it("keeps useful results when another source is unavailable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: URL | string) => {
        if (String(url).includes("crossref")) throw new Error("unavailable");
        if (String(url).includes("wikipedia"))
          return Response.json({
            query: {
              pages: {
                one: {
                  pageid: 1,
                  title: "Waves",
                  extract: "A wave transfers energy.",
                  fullurl: "https://en.wikipedia.org/wiki/Wave",
                },
              },
            },
          });
        return Response.json({ esearchresult: { idlist: [] } });
      }),
    );
    const result = await researchSearch("waves");
    expect(result.results[0].provider).toBe("Wikipedia");
    expect(result.warnings).toContain(
      "Crossref could not be reached. Other results remain available.",
    );
  });
  it("verifies DOI registry identity and rejects arbitrary web fetches", async () => {
    const fetcher = vi.fn(async () =>
      Response.json({
        message: {
          DOI: "10.1038/nphys1170",
          title: ["A publication"],
          author: [{ given: "A", family: "Scholar" }],
          issued: { "date-parts": [[2009]] },
        },
      }),
    );
    vi.stubGlobal("fetch", fetcher);
    expect(await verifyReference({ doi: "10.1038/nphys1170" })).toMatchObject({
      doi: "10.1038/nphys1170",
      year: 2009,
      verified: true,
    });
    await expect(
      verifyReference({ url: "https://127.0.0.1/private" }),
    ).rejects.toThrow("Arbitrary website");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
