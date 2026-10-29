import type { ReferenceResult } from "../src/types";
import { boundedFetch } from "./resources";
const text = (value: unknown, max = 1200) =>
  String(value ?? "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
const list = (value: any): any[] => (Array.isArray(value) ? value : []);
function https(value: unknown): string {
  const url = new URL(String(value));
  if (url.protocol !== "https:" || url.username || url.password)
    throw new Error("Invalid public reference URL.");
  return url.href;
}
async function json(url: string) {
  return (await boundedFetch(url, 4_000_000)).json();
}
function fromCrossref(item: any): ReferenceResult {
  const doi = text(item.DOI, 300);
  const issued = item.issued?.["date-parts"]?.[0]?.[0];
  return {
    id: `doi:${doi.toLowerCase()}`,
    title: text(list(item.title)[0] || doi, 600),
    url: `https://doi.org/${encodeURI(doi)}`,
    provider: "Crossref",
    authors: list(item.author)
      .map((author) =>
        text([author.given, author.family].filter(Boolean).join(" "), 200),
      )
      .slice(0, 12),
    year: issued ? Number(issued) : undefined,
    doi,
    snippet: text(
      item.abstract ||
        list(item["container-title"])[0] ||
        "Publisher-deposited bibliographic metadata. Open the source to assess the claims.",
    ),
    verified: true,
  };
}
async function wikipedia(query: string): Promise<ReferenceResult[]> {
  const url = new URL("https://en.wikipedia.org/w/api.php");
  url.search = new URLSearchParams({
    action: "query",
    format: "json",
    generator: "search",
    gsrsearch: query,
    gsrlimit: "5",
    prop: "extracts|info",
    exintro: "1",
    explaintext: "1",
    exsentences: "3",
    inprop: "url",
  }).toString();
  const data = await json(url.href);
  return Object.values(data.query?.pages || {}).map((page: any) => ({
    id: `wikipedia:${page.pageid}`,
    title: text(page.title, 600),
    url: https(
      page.fullurl || `https://en.wikipedia.org/?curid=${page.pageid}`,
    ),
    provider: "Wikipedia",
    authors: ["Wikipedia contributors"],
    snippet: text(page.extract),
    verified: false,
  }));
}
async function crossref(query: string): Promise<ReferenceResult[]> {
  const url = new URL("https://api.crossref.org/works");
  url.search = new URLSearchParams({
    query,
    rows: "6",
    select: "DOI,title,author,issued,container-title,abstract,type",
  }).toString();
  return list((await json(url.href)).message?.items)
    .filter((item) => typeof item.DOI === "string")
    .map(fromCrossref);
}
function fromPubmed(item: any): ReferenceResult {
  const doi = list(item.articleids).find(
    (value) => value.idtype === "doi",
  )?.value;
  return {
    id: `pubmed:${item.uid}`,
    title: text(item.title, 600),
    url: `https://pubmed.ncbi.nlm.nih.gov/${item.uid}/`,
    provider: "PubMed",
    authors: list(item.authors)
      .map((value) => text(value.name, 200))
      .slice(0, 12),
    year: Number(String(item.pubdate).match(/\d{4}/)?.[0]) || undefined,
    doi: doi ? text(doi, 300) : undefined,
    pmid: String(item.uid),
    snippet: text(
      [item.fulljournalname, item.pubdate, item.volume, item.pages]
        .filter(Boolean)
        .join(" · "),
    ),
    verified: true,
  };
}
async function pubmed(query: string): Promise<ReferenceResult[]> {
  const search = new URL(
    "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi",
  );
  search.search = new URLSearchParams({
    db: "pubmed",
    term: query,
    retmode: "json",
    retmax: "5",
    sort: "relevance",
    tool: "LearningStudio",
  }).toString();
  const ids = list((await json(search.href)).esearchresult?.idlist).filter(
    (value) => /^\d+$/.test(String(value)),
  );
  if (!ids.length) return [];
  await new Promise((resolve) => setTimeout(resolve, 350));
  const summary = new URL(
    "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi",
  );
  summary.search = new URLSearchParams({
    db: "pubmed",
    id: ids.join(","),
    retmode: "json",
    tool: "LearningStudio",
  }).toString();
  const data = (await json(summary.href)).result || {};
  return ids.flatMap((id) => (data[id] ? [fromPubmed(data[id])] : []));
}
export async function researchSearch(
  query: string,
  options: { timeoutMs?: number } = {},
): Promise<{ results: ReferenceResult[]; warnings: string[] }> {
  if (typeof query !== "string" || !query.trim() || query.length > 300)
    throw new Error("Enter a reference search of 1–300 characters.");
  const providers = [
    { name: "Wikipedia", search: wikipedia },
    { name: "Crossref", search: crossref },
    { name: "PubMed", search: pubmed },
  ];
  const timeoutMs = Number.isFinite(options.timeoutMs)
    ? Math.max(20, Math.min(15_000, options.timeoutMs!))
    : 12_000;
  const outcomes = await Promise.allSettled(
    providers.map(async (provider) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        return await Promise.race([
          provider.search(query.trim()),
          new Promise<ReferenceResult[]>((_, reject) => {
            timer = setTimeout(
              () => reject(new Error("Reference provider deadline exceeded.")),
              timeoutMs,
            );
          }),
        ]);
      } finally {
        if (timer) clearTimeout(timer);
      }
    }),
  );
  const warnings = outcomes.flatMap((value, index) =>
    value.status === "rejected"
      ? [
          `${providers[index].name} could not be reached. Other results remain available.`,
        ]
      : [],
  );
  const results = outcomes.flatMap((value) =>
    value.status === "fulfilled" ? value.value : [],
  );
  const seen = new Set<string>();
  return {
    results: results.filter((item) => {
      const identity = (item.doi || item.id).toLowerCase();
      if (seen.has(identity)) return false;
      seen.add(identity);
      return true;
    }),
    warnings,
  };
}
export async function verifyReference(input: {
  doi?: string;
  pmid?: string;
  url?: string;
}): Promise<ReferenceResult> {
  let doi = input.doi;
  let pmid = input.pmid;
  if (input.url) {
    const url = new URL(https(input.url));
    if (url.hostname === "doi.org" || url.hostname === "dx.doi.org")
      doi = decodeURIComponent(url.pathname.slice(1));
    else if (url.hostname === "pubmed.ncbi.nlm.nih.gov")
      pmid = url.pathname.split("/").filter(Boolean)[0];
    else if (url.hostname === "en.wikipedia.org") {
      const title =
        url.searchParams.get("title") ||
        decodeURIComponent(url.pathname.replace(/^\/wiki\//, "")).replace(
          /_/g,
          " ",
        );
      const found = (await wikipedia(title)).find(
        (value) => value.title.toLowerCase() === title.toLowerCase(),
      );
      if (found)
        return {
          ...found,
          verified: true,
          snippet:
            found.snippet +
            " (Page metadata matched; this does not verify every statement.)",
        };
      throw new Error("No matching Wikipedia page metadata was found.");
    } else
      throw new Error(
        "Verify a DOI, PubMed PMID, or Wikipedia source. Arbitrary website fetching is disabled.",
      );
  }
  if (doi) {
    if (doi.length > 300 || !/^10\.\d{4,9}\/\S+$/i.test(doi))
      throw new Error("Enter a valid DOI.");
    const data = await json(
      `https://api.crossref.org/works/${encodeURIComponent(doi)}`,
    );
    if (String(data.message?.DOI).toLowerCase() !== doi.toLowerCase())
      throw new Error("The registry metadata did not match this DOI.");
    return fromCrossref(data.message);
  }
  if (pmid && /^\d{1,12}$/.test(pmid)) {
    const data = await json(
      `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&id=${pmid}&retmode=json&tool=LearningStudio`,
    );
    if (data.result?.[pmid]?.uid === pmid) return fromPubmed(data.result[pmid]);
    throw new Error("No matching PubMed metadata was found.");
  }
  throw new Error("Provide a DOI, PubMed PMID, or supported source URL.");
}
