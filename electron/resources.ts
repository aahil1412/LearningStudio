import type { ImageResult } from "../src/types";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { XMLParser } from "fast-xml-parser";
const allowedHosts = new Set([
  "commons.wikimedia.org",
  "upload.wikimedia.org",
  "files.rcsb.org",
  "pubchem.ncbi.nlm.nih.gov",
  "thumb.wikimedia.org",
  "api.openverse.org",
  "eutils.ncbi.nlm.nih.gov",
  "pmc-oa-opendata.s3.amazonaws.com",
  "en.wikipedia.org",
  "api.crossref.org",
]);
let resourceTransport:
  ((url: string | URL, options?: RequestInit) => Promise<Response>) | undefined;
/** Electron's Chromium transport honors Windows networking configuration. Cookies stay omitted. */
export function configureResourceTransport(
  transport: typeof resourceTransport,
) {
  resourceTransport = transport;
}
function allowedResource(url: string, hosts = allowedHosts): URL {
  const u = new URL(url);
  if (
    u.protocol !== "https:" ||
    !hosts.has(u.hostname) ||
    u.port ||
    u.username ||
    u.password
  )
    throw new Error("Resource origin is not allowed.");
  return u;
}
export async function boundedFetch(
  url: string,
  max = 12_000_000,
): Promise<Response> {
  const u = allowedResource(url);
  if (!Number.isSafeInteger(max) || max < 1 || max > 20_000_000)
    throw new Error("Invalid resource size limit.");
  const response = await (resourceTransport || fetch)(u, {
    signal: AbortSignal.timeout(25000),
    redirect: "error",
    credentials: "omit",
    headers: {
      "User-Agent":
        "LearningStudio/1.0 (educational desktop; source attribution displayed)",
    },
  });
  if (!response.ok)
    throw new Error(
      `The resource provider returned ${response.status}. Try again later.`,
    );
  if (Number(response.headers.get("content-length")) > max)
    throw new Error("Resource exceeds size limit.");
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Empty resource response.");
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > max) throw new Error("Resource exceeds size limit.");
      chunks.push(value);
    }
    return new Response(Buffer.concat(chunks), { headers: response.headers });
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
const strip = (s: string) =>
  s
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .slice(0, 1000);
export async function searchWikimediaImages(
  query: string,
): Promise<ImageResult[]> {
  if (!query.trim() || query.length > 300)
    throw new Error("Enter an image search of 1–300 characters.");
  const url = new URL("https://commons.wikimedia.org/w/api.php");
  url.search = new URLSearchParams({
    action: "query",
    format: "json",
    generator: "search",
    gsrsearch: query,
    gsrnamespace: "6",
    gsrlimit: "12",
    prop: "imageinfo",
    iiprop: "url|extmetadata",
    iiurlwidth: "800",
  }).toString();
  const json = await (await boundedFetch(url.href, 3_000_000)).json();
  return Object.values(json.query?.pages ?? {}).flatMap((page: any) => {
    const info = page?.imageinfo?.[0],
      meta = info?.extmetadata;
    if (!info || typeof meta?.LicenseShortName?.value !== "string") return [];
    const license = strip(meta.LicenseShortName.value);
    if (!/^(CC BY(?:-SA)?\b|CC0\b|Public domain\b|PD\b|GFDL\b)/i.test(license))
      return [];
    if (
      /disputed|inaccurate diagram|scientifically inaccurate/i.test(
        String(meta.Categories?.value || ""),
      )
    )
      return [];
    // Wikimedia rasterizes many scientific SVGs. Display only its raster bytes.
    try {
      const original = allowedResource(
        info.url,
        new Set(["upload.wikimedia.org"]),
      );
      const originalRaster = /\.(png|jpe?g|webp)$/i.test(original.pathname);
      const originalSvg = /\.svg$/i.test(original.pathname);
      if (!originalRaster && !originalSvg) return [];
      if (originalSvg && !info.thumburl) return [];
      const thumbnail = allowedResource(
        info.thumburl || info.url,
        new Set(["upload.wikimedia.org", "thumb.wikimedia.org"]),
      );
      if (!/\.(png|jpe?g|webp)$/i.test(thumbnail.pathname)) return [];
      const source = allowedResource(
        info.descriptionurl,
        new Set(["commons.wikimedia.org"]),
      );
      const licenseUrl = new URL(
        String(meta.LicenseUrl?.value || source.href),
        source,
      );
      if (
        licenseUrl.protocol !== "https:" ||
        licenseUrl.username ||
        licenseUrl.password
      )
        return [];
      const title =
        typeof page.title === "string"
          ? page.title.replace(/^File:/, "").slice(0, 500)
          : "Educational figure";
      return [
        {
          id: String(page.pageid),
          title,
          url: originalSvg ? thumbnail.href : original.href,
          thumbnail: thumbnail.href,
          source: source.href,
          author: strip(String(meta.Artist?.value || "See source for author")),
          license,
          licenseUrl: licenseUrl.href,
          caption: strip(String(meta.ImageDescription?.value || title)),
        },
      ];
    } catch {
      return [];
    }
  });
}

export type ImageProvider = "wikimedia" | "openverse" | "pmc";
export type EducationalImage = ImageResult & {
  provider?: ImageProvider;
  cached?: boolean;
  cachedAt?: string;
  originalUrl?: string;
  sha256?: string;
  offline?: boolean;
};
type CacheEntry = {
  image: EducationalImage;
  key: string;
  mime: string;
  bytes: number;
  cachedAt: string;
  sha256: string;
};
let cacheDirectory: string | undefined;
let cacheLoaded = false;
let cacheEntries: CacheEntry[] = [];
let cacheQueue = Promise.resolve();
const issuedImages = new Map<string, EducationalImage>();
export function configureResourceCache(path: string) {
  cacheDirectory = path;
  cacheLoaded = false;
  cacheEntries = [];
}
function safePublicLink(value: unknown): string {
  const url = new URL(String(value));
  if (url.protocol !== "https:" || url.username || url.password || url.port)
    throw new Error("Invalid public source link.");
  return url.href;
}
function rememberImages(images: EducationalImage[], provider: ImageProvider) {
  return images.map((image) => {
    const value = { ...image, provider };
    issuedImages.set(value.id, value);
    return value;
  });
}
const reusable = (license: string) =>
  /^(?:CC[ -]?BY(?:[ -]?SA)?(?:[ -]?\d|$)|CC0\b|Public domain\b|PD\b|GFDL\b)/i.test(
    license,
  ) && !/\bNC\b|\bND\b/i.test(license);
const xmlParser = new XMLParser({
  ignoreAttributes: false,
  processEntities: false,
  parseTagValue: false,
  trimValues: true,
});
const arr = (value: any): any[] =>
  value == null ? [] : Array.isArray(value) ? value : [value];
function xmlText(value: any): string {
  if (typeof value === "string") return strip(value);
  if (Array.isArray(value)) return value.map(xmlText).join(" ");
  if (value && typeof value === "object")
    return Object.entries(value)
      .filter(([key]) => !key.startsWith("@_"))
      .map(([, child]) => xmlText(child))
      .join(" ");
  return "";
}
export async function searchOpenverseImages(
  query: string,
): Promise<EducationalImage[]> {
  if (!query.trim() || query.length > 300)
    throw new Error("Enter an image search of 1–300 characters.");
  const url = new URL("https://api.openverse.org/v1/images/");
  url.search = new URLSearchParams({
    q: query.slice(0, 200),
    license: "by,by-sa,cc0,pdm",
    page_size: "12",
    mature: "false",
    filter_dead: "true",
  }).toString();
  const json = await (await boundedFetch(url.href, 3_000_000)).json();
  return arr(json.results).flatMap((item) => {
    if (
      !/^[a-f0-9-]{36}$/i.test(String(item.id)) ||
      !["by", "by-sa", "cc0", "pdm"].includes(item.license) ||
      item.mature
    )
      return [];
    try {
      const source = safePublicLink(item.foreign_landing_url);
      const licenseUrl = safePublicLink(item.license_url);
      if (
        !["creativecommons.org", "www.creativecommons.org"].includes(
          new URL(licenseUrl).hostname,
        )
      )
        return [];
      // Proxy endpoint owns retrieval; the backend never follows arbitrary origin URLs from results.
      const proxy = `https://api.openverse.org/v1/images/${item.id}/thumb/`;
      const license =
        item.license === "pdm"
          ? "Public domain"
          : item.license === "cc0"
            ? "CC0"
            : `CC ${String(item.license).toUpperCase()} ${item.license_version || ""}`.trim();
      return [
        {
          id: `openverse:${item.id}`,
          title: strip(String(item.title || "Educational image")),
          url: proxy,
          thumbnail: proxy,
          source,
          license,
          licenseUrl,
          author: strip(String(item.creator || "See source for author")),
          caption: strip(
            String(
              item.attribution || item.title || "Openverse educational image",
            ),
          ),
          provider: "openverse" as const,
        },
      ];
    } catch {
      return [];
    }
  });
}

/** Current NIH Article Dataset route; legacy oa.fcgi was retired in August 2026. */
export async function searchPmcImages(
  query: string,
): Promise<EducationalImage[]> {
  if (!query.trim() || query.length > 300)
    throw new Error("Enter an image search of 1–300 characters.");
  const search = new URL(
    "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi",
  );
  search.search = new URLSearchParams({
    db: "pmc",
    term: `(${query}) AND (cc_by_license[Filter] OR cc_by-sa_license[Filter] OR cc0_license[Filter]) NOT retracted publication[Publication Type]`,
    retmode: "json",
    retmax: "3",
    sort: "relevance",
    tool: "LearningStudio",
  }).toString();
  const ids = arr(
    (await (await boundedFetch(search.href, 1_000_000)).json()).esearchresult
      ?.idlist,
  ).filter((id) => /^\d{1,12}$/.test(String(id)));
  const results = await Promise.allSettled(
    ids.map(async (id) => {
      const listing = new URL("https://pmc-oa-opendata.s3.amazonaws.com/");
      listing.search = new URLSearchParams({
        "list-type": "2",
        prefix: `PMC${id}.`,
        delimiter: "/",
        "max-keys": "8",
      }).toString();
      const listed = xmlParser.parse(
        await (await boundedFetch(listing.href, 1_000_000)).text(),
      );
      const prefixes = arr(listed.ListBucketResult?.CommonPrefixes)
        .map((value) => String(value.Prefix))
        .filter((value) => new RegExp(`^PMC${id}\\.\\d+/$`).test(value));
      for (const prefix of prefixes.slice(0, 3)) {
        const version = prefix.slice(0, -1);
        const base = `https://pmc-oa-opendata.s3.amazonaws.com/${prefix}`;
        const meta = await (
          await boundedFetch(`${base}${version}.json`, 2_000_000)
        ).json();
        const code = String(meta.license_code || "")
          .toUpperCase()
          .replace(/[_\s]+/g, "-");
        if (
          !/^(?:CC-BY(?:-SA)?|CC0)(?:[- ]\d.*)?$/.test(code) ||
          /^(yes|true|1)$/i.test(String(meta.is_retracted))
        )
          continue;
        let article: any = {};
        const datasetUrl = (value: unknown) =>
          String(value).replace(
            /^s3:\/\/pmc-oa-opendata\//,
            "https://pmc-oa-opendata.s3.amazonaws.com/",
          );
        const xmlUrl = datasetUrl(meta.xml_url || `${base}${version}.xml`);
        try {
          article = xmlParser.parse(
            await (
              await boundedFetch(
                allowedResource(
                  xmlUrl,
                  new Set(["pmc-oa-opendata.s3.amazonaws.com"]),
                ).href,
                4_000_000,
              )
            ).text(),
          );
        } catch {
          continue;
        }
        const figures: any[] = [];
        const collect = (node: any) => {
          if (!node || typeof node !== "object") return;
          for (const [key, value] of Object.entries(node)) {
            if (key === "fig") figures.push(...arr(value));
            else if (!key.startsWith("@_"))
              for (const child of arr(value)) collect(child);
          }
        };
        collect(article);
        const articleLicense = arr(
          article?.article?.front?.["article-meta"]?.permissions?.license,
        )
          .map((value) => value?.["@_xlink:href"])
          .find(
            (value) =>
              typeof value === "string" &&
              /^https?:\/\/(?:www\.)?creativecommons\.org\//i.test(value),
          );
        if (
          articleLicense &&
          /\/licenses\/(?:by-nc|by-nd)/i.test(String(articleLicense))
        )
          continue;
        const media = arr(meta.media_urls)
          .map(datasetUrl)
          .filter((value) => /\.(png|jpe?g|webp)(?:\?|$)/i.test(value));
        return media.slice(0, 5).flatMap((value, index) => {
          try {
            const resource = allowedResource(
              value,
              new Set(["pmc-oa-opendata.s3.amazonaws.com"]),
            );
            if (!resource.pathname.startsWith(`/${prefix}`)) return [];
            const filename = resource.pathname.split("/").pop()!;
            const figure = figures.find((fig) =>
              arr(fig.graphic).some((g) =>
                filename.startsWith(
                  String(g?.["@_xlink:href"] || "impossible-filename"),
                ),
              ),
            );
            const figureLicense = arr(figure?.permissions?.license)
              .map((value) => value?.["@_xlink:href"])
              .find((value) => typeof value === "string");
            if (
              figure?.permissions &&
              !/^https?:\/\/(?:www\.)?creativecommons\.org\/(?:licenses\/by(?:-sa)?\/|publicdomain\/zero\/)/i.test(
                String(figureLicense || ""),
              )
            )
              return [];
            if (
              /reproduced (?:with|by) permission|all rights reserved|not (?:included|covered) (?:in|by).*creative commons/i.test(
                xmlText(figure?.caption),
              )
            )
              return [];
            const license = code
              .replace(/^CC-/, "CC ")
              .replace(/-([0-9])/, " $1");
            const licenseUrl =
              figureLicense || articleLicense
                ? String(figureLicense || articleLicense).replace(
                    /^http:/,
                    "https:",
                  )
                : code.startsWith("CC0")
                  ? "https://creativecommons.org/publicdomain/zero/1.0/"
                  : `https://creativecommons.org/licenses/${code.includes("-SA") ? "by-sa" : "by"}/${code.match(/(\d\.\d)/)?.[1] || ""}`;
            return [
              {
                id: `pmc:${version}:${index}`,
                title: strip(
                  `${meta.title || `PMC${id}`} · ${xmlText(figure?.label) || `Figure ${index + 1}`}`,
                ),
                url: resource.href,
                thumbnail: resource.href,
                source: `https://pmc.ncbi.nlm.nih.gov/articles/PMC${id}/`,
                license,
                licenseUrl,
                author: strip(
                  xmlText(
                    article?.article?.front?.["article-meta"]?.[
                      "contrib-group"
                    ],
                  ) || "Article authors; NIH/NLM PMC Article Datasets",
                ),
                caption: strip(
                  xmlText(figure?.caption) ||
                    `${meta.title || "Scientific article figure"}. NIH/NLM PMC Article Datasets; downloaded metadata may not reflect subsequent updates.`,
                ),
                provider: "pmc" as const,
              },
            ];
          } catch {
            return [];
          }
        });
      }
      return [];
    }),
  );
  return results.flatMap((result) =>
    result.status === "fulfilled" ? result.value : [],
  );
}

async function loadCache() {
  if (cacheLoaded) return;
  cacheLoaded = true;
  if (!cacheDirectory) return;
  await mkdir(cacheDirectory, { recursive: true });
  try {
    const parsed = JSON.parse(
      await readFile(join(cacheDirectory, "index.json"), "utf8"),
    );
    cacheEntries = arr(parsed.entries)
      .filter(
        (entry) =>
          /^[a-f0-9]{64}$/.test(String(entry.key)) &&
          reusable(String(entry.image?.license)) &&
          entry.bytes > 0 &&
          entry.bytes < 12_000_000 &&
          ["image/png", "image/jpeg", "image/webp"].includes(entry.mime),
      )
      .slice(0, 200);
  } catch {
    cacheEntries = [];
  }
}
function rasterMime(bytes: Buffer): string {
  if (
    bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  )
    return "image/png";
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255)
    return "image/jpeg";
  if (
    bytes.toString("ascii", 0, 4) === "RIFF" &&
    bytes.toString("ascii", 8, 12) === "WEBP"
  )
    return "image/webp";
  throw new Error(
    "The resource was not a supported raster image. Raw SVG and HTML are never cached.",
  );
}
async function cacheResult(
  entry: CacheEntry,
  offline = false,
): Promise<EducationalImage> {
  const bytes = await readFile(join(cacheDirectory!, entry.key));
  if (createHash("sha256").update(bytes).digest("hex") !== entry.sha256)
    throw new Error("Cached image integrity check failed.");
  const data = `data:${entry.mime};base64,${bytes.toString("base64")}`;
  return {
    ...entry.image,
    originalUrl: entry.image.url,
    url: data,
    thumbnail: data,
    cached: true,
    cachedAt: entry.cachedAt,
    sha256: entry.sha256,
    offline,
  };
}
export async function cachedImages(query = ""): Promise<EducationalImage[]> {
  await loadCache();
  if (!cacheDirectory) return [];
  const words = query.toLowerCase().split(/\W+/).filter(Boolean);
  const entries = cacheEntries
    .filter(
      (entry) =>
        !words.length ||
        words.some((word) =>
          (entry.image.title + " " + entry.image.caption)
            .toLowerCase()
            .includes(word),
        ),
    )
    .slice(0, 24);
  const results = await Promise.allSettled(
    entries.map((entry) => cacheResult(entry, true)),
  );
  return results.flatMap((result) =>
    result.status === "fulfilled" ? [result.value] : [],
  );
}
export async function cacheImage(
  value: EducationalImage | string,
): Promise<EducationalImage> {
  const id = typeof value === "string" ? value : value.id;
  let resolve!: (result: EducationalImage) => void,
    reject!: (error: unknown) => void;
  const result = new Promise<EducationalImage>((ok, fail) => {
    resolve = ok;
    reject = fail;
  });
  cacheQueue = cacheQueue
    .catch(() => {})
    .then(async () => {
      try {
        await loadCache();
        if (!cacheDirectory)
          throw new Error("The desktop image cache is not configured.");
        const existing = cacheEntries.find((entry) => entry.image.id === id);
        if (existing) {
          resolve(await cacheResult(existing));
          return;
        }
        const image = issuedImages.get(id);
        if (!image || !reusable(image.license))
          throw new Error(
            "Search for a permitted image before caching it. Imported URLs cannot authorize downloads.",
          );
        const response = await boundedFetch(image.url, 12_000_000);
        const bytes = Buffer.from(await response.arrayBuffer());
        const mime = rasterMime(bytes);
        const key = createHash("sha256")
          .update(image.id + image.url)
          .digest("hex");
        const entry: CacheEntry = {
          image,
          key,
          mime,
          bytes: bytes.length,
          cachedAt: new Date().toISOString(),
          sha256: createHash("sha256").update(bytes).digest("hex"),
        };
        await writeFile(join(cacheDirectory, key), bytes);
        cacheEntries.unshift(entry);
        let total = 0;
        const keep: CacheEntry[] = [];
        for (const item of cacheEntries) {
          total += item.bytes;
          if (keep.length < 200 && total <= 100_000_000) keep.push(item);
          else await rm(join(cacheDirectory, item.key), { force: true });
        }
        cacheEntries = keep;
        const temporary = join(cacheDirectory, "index.json.tmp");
        await writeFile(
          temporary,
          JSON.stringify({ version: 1, entries: cacheEntries }),
        );
        await rename(temporary, join(cacheDirectory, "index.json"));
        resolve(await cacheResult(entry));
      } catch (error) {
        reject(error);
      }
    });
  return result;
}
export async function searchImages(
  query: string,
  options: { provider?: ImageProvider | "all" } = {},
): Promise<EducationalImage[]> {
  if (!query.trim() || query.length > 300)
    throw new Error("Enter an image search of 1–300 characters.");
  const provider = options.provider || "wikimedia";
  const selected =
    provider === "all"
      ? (["wikimedia", "openverse", "pmc"] as const)
      : [provider];
  const queries = imageSearchQueries(query);
  let outcomes: PromiseSettledResult<EducationalImage[]>[] = [];
  // Long model descriptions often become over-constrained Commons searches.
  // One transparent, bounded keyword fallback retains the same source/license rules.
  for (const phrase of queries) {
    outcomes = await Promise.allSettled(
    selected.map(async (name) =>
      rememberImages(
        await (name === "wikimedia"
          ? searchWikimediaImages(phrase)
          : name === "openverse"
            ? searchOpenverseImages(phrase)
            : searchPmcImages(phrase)),
        name,
      ),
    ),
  );
  const images = outcomes.flatMap((value) =>
    value.status === "fulfilled" ? value.value : [],
  );
    if (images.length) return images.map((image) => ({ ...image, searchQuery: phrase }));
    // Provider errors are not evidence of poor keywords. Do not multiply retries
    // during outages; cached images and a concrete error remain available.
    if (outcomes.some((outcome) => outcome.status === "rejected")) break;
  }
  const offline = await cachedImages(query);
  if (offline.length) return offline;
  const failure = outcomes.find((value) => value.status === "rejected");
  if (failure?.status === "rejected") throw failure.reason;
  return [];
}
export function imageSearchQueries(query: string): string[] {
  const phrase = query.trim().replace(/\s+/g, " ");
  const words = phrase.split(" ");
  if (words.length <= 7) return [phrase];
  const content = words.filter((word) => !/^(?:a|an|the|of|for|with|showing|show|educational|scientific|diagram|illustration|figure|image|labeled|labelled|structure)$/i.test(word));
  const fallback = content.length ? `${content[0]} diagram` : "";
  return fallback && fallback.toLowerCase() !== phrase.toLowerCase() ? [phrase, fallback] : [phrase];
}
export async function fetchStructure(source: string, id: string) {
  let url: string, format: string;
  if (source === "pdb" && /^[a-zA-Z0-9]{4}$/.test(id)) {
    url = `https://files.rcsb.org/download/${id.toUpperCase()}.pdb`;
    format = "pdb";
  } else if (source === "pubchem" && /^\d{1,12}$/.test(id)) {
    url = `https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/cid/${id}/SDF?record_type=3d`;
    format = "sdf";
  } else
    throw new Error(
      "Use a four-character PDB accession or numeric PubChem CID.",
    );
  const data = await (await boundedFetch(url)).text();
  if (format === "pdb" && !/^(ATOM {2}|HETATM)/m.test(data))
    throw new Error("The provider returned no readable PDB atom coordinates.");
  if (format === "sdf" && !/M {2}END/.test(data))
    throw new Error("The provider returned no readable molecular structure.");
  return { data, format, sourceUrl: url };
}
