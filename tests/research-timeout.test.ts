import { afterEach, expect, it } from "vitest";
import { configureResourceTransport } from "../electron/resources";
import { researchSearch } from "../electron/research";
afterEach(() => configureResourceTransport(undefined));
it("returns verified available references when another public provider never completes", async () => {
  configureResourceTransport(async (input) => {
    const url = new URL(String(input));
    if (url.hostname === "en.wikipedia.org")
      return new Promise<Response>(() => {});
    if (url.hostname === "api.crossref.org")
      return Response.json({
        message: {
          items: [
            {
              DOI: "10.1234/test",
              title: ["An available reference"],
              issued: { "date-parts": [[2025]] },
            },
          ],
        },
      });
    return Response.json({ esearchresult: { idlist: [] } });
  });
  const result = await researchSearch("energy", { timeoutMs: 20 });
  expect(result.results).toHaveLength(1);
  expect(result.results[0]).toMatchObject({
    provider: "Crossref",
    verified: true,
    title: "An available reference",
  });
  expect(result.warnings).toEqual([
    "Wikipedia could not be reached. Other results remain available.",
  ]);
}, 2000);
