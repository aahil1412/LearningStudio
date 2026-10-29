import { afterEach, describe, it, expect } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import {
  searchImages,
  searchPmcImages,
  configureResourceCache,
  cacheImage,
  cachedImages,
} from "../electron/resources";
import { researchSearch, verifyReference } from "../electron/research";
const live = process.env.STUDIO_NETWORK_TESTS === "1" ? it : it.skip;
const directories: string[] = [];
afterEach(async () => {
  for (const path of directories.splice(0))
    await rm(path, { recursive: true, force: true });
});
describe("real public research services", () => {
  live(
    "recovers the original overconstrained photosynthesis query with sourced reusable results",
    async () => {
      const images = await searchImages("educational photosynthesis diagram leaf chloroplast sunlight absorbed by chlorophyll carbon dioxide from air water from roots sugar production oxygen released labeled");
      expect(images.length).toBeGreaterThan(0);
      expect(images[0].searchQuery).toBe("photosynthesis diagram");
      expect(images[0].source).toContain("commons.wikimedia.org");
      expect(images[0].license).toMatch(/CC|Public domain|PD|GFDL/);
    },
    60000,
  );
  live(
    "retrieves actual NIH raster bytes and persistent licensed provenance",
    async () => {
      const path = await mkdtemp(join(process.cwd(), ".live-image-cache-"));
      directories.push(path);
      configureResourceCache(path);
      const images = await searchImages("PMC10009416", { provider: "pmc" });
      expect(images.length).toBeGreaterThan(0);
      const result = await cacheImage(images[0]);
      expect(result.url).toMatch(/^data:image\/(png|jpeg|webp);base64,/);
      expect(result.license).toMatch(/CC|Public domain/);
      expect(result.source).toMatch(/^https:/);
      configureResourceCache(path);
      const restored = await cachedImages();
      expect(restored[0].sha256).toBe(result.sha256);
      expect(restored[0].offline).toBe(true);
    },
    60000,
  );
  live(
    "retrieves licensed PMC figure metadata from the current NIH dataset",
    async () => {
      const images = await searchPmcImages("PMC10009416");
      expect(images.length).toBeGreaterThan(0);
      expect(images[0].url).toContain(
        "pmc-oa-opendata.s3.amazonaws.com/PMC10009416.",
      );
      expect(images[0].license).toMatch(/^CC BY/);
      expect(images[0].caption.length).toBeGreaterThan(20);
    },
    60000,
  );
  live(
    "searches live public reference metadata and verifies an actual DOI",
    async () => {
      const result = await researchSearch("Fourier transform");
      expect(result.results.length).toBeGreaterThan(0);
      expect(result.results.some((item) => item.provider === "Crossref")).toBe(
        true,
      );
      const reference = await verifyReference({ doi: "10.1038/nphys1170" });
      expect(reference.doi).toBe("10.1038/nphys1170");
      expect(reference.title.length).toBeGreaterThan(5);
      expect(reference.verified).toBe(true);
    },
    60000,
  );
});
