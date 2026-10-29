import { afterEach, describe, expect, it, vi } from "vitest";
import { imageSearchQueries, searchImages } from "../electron/resources";

afterEach(() => vi.unstubAllGlobals());
describe("bounded licensed-image query recovery", () => {
  const long = "educational photosynthesis diagram leaf chloroplast sunlight absorbed by chlorophyll carbon dioxide from air water from roots sugar production oxygen released labeled";
  it("keeps normal queries exact and reduces an overconstrained description only once", () => {
    expect(imageSearchQueries("tRNA structure")).toEqual(["tRNA structure"]);
    expect(imageSearchQueries(long)).toEqual([long, "photosynthesis diagram"]);
  });
  it("retains real attribution after an empty long query and discloses the successful fallback", async () => {
    const queries: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: URL) => {
      const query = new URL(input).searchParams.get("gsrsearch") || ""; queries.push(query);
      return Response.json(query === long ? { query: { pages: {} } } : { query: { pages: { one: {
        pageid: 1, title: "File:Photosynthesis.png", imageinfo: [{ url: "https://upload.wikimedia.org/photosynthesis.png", thumburl: "https://upload.wikimedia.org/thumb.png", descriptionurl: "https://commons.wikimedia.org/wiki/File:Photosynthesis.png", extmetadata: { LicenseShortName: { value: "CC BY-SA 4.0" }, Artist: { value: "A credited author" }, ImageDescription: { value: "A schematic of photosynthesis" } } }],
      } } } });
    }));
    const results = await searchImages(long);
    expect(queries).toEqual([long, "photosynthesis diagram"]);
    expect(results[0]).toMatchObject({ searchQuery: "photosynthesis diagram", license: "CC BY-SA 4.0", author: "A credited author" });
    expect(results[0].source).toContain("commons.wikimedia.org");
  });
  it("does not multiply calls on a provider outage", async () => {
    const fetcher = vi.fn(async () => new Response("Unavailable", { status: 503 })); vi.stubGlobal("fetch", fetcher);
    await expect(searchImages(long)).rejects.toThrow("503");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
