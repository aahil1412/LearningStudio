import { readFile, stat, mkdir, writeFile, readdir } from "node:fs/promises";
import { basename, extname } from "node:path";
import { createHash } from "node:crypto";
import { gzipSync, gunzipSync } from "node:zlib";
import type { LibraryItem } from "../src/types";

export type DocumentPage = { page: number; text: string; ocr?: boolean };
export type DocumentFigure = {
  id: string;
  page: number;
  dataUrl: string;
  caption?: string;
  width?: number;
  height?: number;
};
export type DocumentCitation = { text: string; doi?: string; url?: string };
export type ExtractedDocument = {
  title: string;
  content: string;
  source: string;
  pages: DocumentPage[];
  figures: DocumentFigure[];
  citations: DocumentCitation[];
  warnings: string[];
};
export type DocumentChunk = {
  id: string;
  documentId: string;
  title: string;
  page?: number;
  text: string;
  citation: string;
};
export type DocumentHit = DocumentChunk & { score: number; chunkId: string };
let runtime: {
  cacheDirectory?: string;
  languageDirectory?: string;
  workerPath?: string;
  corePath?: string;
} = {};
export function configureDocumentRuntime(options: typeof runtime) {
  runtime = options;
}
export async function availableOcrLanguages(): Promise<string[]> {
  const languages = new Set<string>();
  for (const directory of [runtime.languageDirectory, runtime.cacheDirectory]) {
    if (!directory) continue;
    try {
      for (const name of await readdir(directory)) {
        const match = /^([a-z]{3})\.traineddata(?:\.gz)?$/.exec(name);
        if (match) languages.add(match[1]);
      }
    } catch {
      /* An empty language cache is valid on first launch. */
    }
  }
  return [...languages].sort();
}
export async function installOcrLanguage(
  path: string,
): Promise<{ language: string; sha256: string }> {
  if (!runtime.cacheDirectory)
    throw new Error("The local OCR storage directory is not configured.");
  const match = /^([a-z]{3})\.traineddata(?:\.gz)?$/.exec(
    basename(path).toLowerCase(),
  );
  if (!match)
    throw new Error(
      "Choose a language file named with its three-letter code, such as fra.traineddata.gz.",
    );
  const info = await stat(path);
  if (!info.isFile() || info.size > 50_000_000)
    throw new Error("Choose an OCR language file smaller than 50 MB.");
  const bytes = await readFile(path);
  const data =
    bytes[0] === 31 && bytes[1] === 139
      ? gunzipSync(bytes, { maxOutputLength: 50_000_000 })
      : bytes;
  if (
    data.length < 1000 ||
    data.readInt32LE(0) < 1 ||
    data.readInt32LE(0) > 1000
  )
    throw new Error("This file is not a supported Tesseract language dataset.");
  await mkdir(runtime.cacheDirectory, { recursive: true });
  await writeFile(
    `${runtime.cacheDirectory}/${match[1]}.traineddata.gz`,
    gzipSync(data),
  );
  return {
    language: match[1],
    sha256: createHash("sha256").update(data).digest("hex"),
  };
}
export function extractCitations(content: string): DocumentCitation[] {
  const citations: DocumentCitation[] = [];
  const seen = new Set<string>();
  for (const match of content.matchAll(
    /\b10\.\d{4,9}\/[a-zA-Z0-9._;()/:+-]+/g,
  )) {
    const doi = match[0].replace(/[.,;:)]+$/, "");
    if (seen.has(doi.toLowerCase())) continue;
    seen.add(doi.toLowerCase());
    const start = content.lastIndexOf("\n", match.index);
    const end = content.indexOf("\n", match.index! + doi.length);
    citations.push({
      doi,
      url: `https://doi.org/${encodeURI(doi)}`,
      text: content
        .slice(
          Math.max(0, start + 1),
          end < 0 ? Math.min(content.length, match.index! + 300) : end,
        )
        .slice(0, 1000),
    });
    if (citations.length >= 100) break;
  }
  return citations;
}
export async function extractDocument(
  path: string,
  options: {
    ocr?: boolean;
    extractImages?: boolean;
    language?: string;
    maxBytes?: number;
    maxPages?: number;
    maxOcrPages?: number;
    onProgress?: (progress: { status: string; progress: number }) => void;
  } = {},
): Promise<ExtractedDocument> {
  const info = await stat(path);
  const maxBytes = Math.max(
    1,
    Math.min(100_000_000, options.maxBytes || 20_000_000),
  );
  const maxPages = Math.max(1, Math.min(2000, options.maxPages || 200));
  const maxOcrPages = Math.max(1, Math.min(2000, options.maxOcrPages || 30));
  if (!info.isFile() || info.size > maxBytes)
    throw new Error(
      `Choose a document file smaller than ${Math.round(maxBytes / 1_000_000)} MB.`,
    );
  const extension = extname(path).toLowerCase();
  if (
    ![
      ".md",
      ".txt",
      ".pdf",
      ".png",
      ".jpg",
      ".jpeg",
      ".webp",
      ".bmp",
      ".tif",
      ".tiff",
    ].includes(extension)
  )
    throw new Error(
      "Choose Markdown, text, PDF, or a supported image for local OCR.",
    );
  const source = basename(path);
  const pages: DocumentPage[] = [];
  const figures: DocumentFigure[] = [];
  const warnings: string[] = [];
  let worker: import("tesseract.js").Worker | undefined;
  const recognize = async (bytes: Buffer | Uint8Array, page: number) => {
    if (!worker) {
      if (runtime.cacheDirectory)
        await mkdir(runtime.cacheDirectory, { recursive: true });
      const { createWorker, OEM } = await import("tesseract.js");
      const language = options.language || "eng";
      if (!/^[a-z]{3}(?:\+[a-z]{3}){0,2}$/.test(language))
        throw new Error("Choose up to three three-letter OCR language codes.");
      if (!runtime.cacheDirectory)
        throw new Error("The local OCR storage directory is not configured.");
      for (const code of language.split("+")) {
        let data: Buffer | undefined;
        for (const directory of [
          runtime.cacheDirectory,
          runtime.languageDirectory,
        ]) {
          if (!directory) continue;
          for (const suffix of [".traineddata.gz", ".traineddata"]) {
            try {
              data = await readFile(`${directory}/${code}${suffix}`);
              break;
            } catch {
              /* Look only in explicitly configured local OCR folders. */
            }
          }
          if (data) break;
        }
        if (!data)
          throw new Error(
            `OCR language ${code} is not installed. Import its free Tesseract .traineddata file in document settings.`,
          );
        await writeFile(
          `${runtime.cacheDirectory}/${code}.traineddata.gz`,
          data[0] === 31 && data[1] === 139 ? data : gzipSync(data),
        );
      }
      worker = await createWorker(language, OEM.LSTM_ONLY, {
        ...(runtime.cacheDirectory
          ? { cachePath: runtime.cacheDirectory }
          : {}),
        langPath: runtime.cacheDirectory,
        ...(runtime.workerPath ? { workerPath: runtime.workerPath } : {}),
        ...(runtime.corePath ? { corePath: runtime.corePath } : {}),
        logger: (value) =>
          options.onProgress?.({
            status: `Page ${page}: ${value.status}`,
            progress: value.progress,
          }),
      });
    }
    const result = await worker.recognize(Buffer.from(bytes));
    return result.data.text.slice(0, 300_000);
  };
  try {
    if (extension === ".pdf") {
      const { PDFParse } = await import("pdf-parse");
      const parser = new PDFParse({ data: await readFile(path) });
      try {
        const extracted = await parser.getText({
          first: maxPages,
          parseHyperlinks: true,
        });
        if (extracted.total > maxPages)
          warnings.push(
            `This import includes the first ${maxPages} pages. Split larger documents to import additional pages.`,
          );
        let ocrPages = 0;
        for (const page of extracted.pages) {
          let text = page.text;
          let ocr = false;
          if (options.ocr !== false && text.replace(/\W/g, "").length < 35) {
            if (ocrPages >= maxOcrPages) {
              warnings.push(
                `Page ${page.num}: OCR page limit reached. Split this PDF for further scanned pages.`,
              );
            } else {
              ocrPages++;
              try {
                const screenshot = await parser.getScreenshot({
                  partial: [page.num],
                  desiredWidth: 1800,
                  imageDataUrl: false,
                  imageBuffer: true,
                });
                if (screenshot.pages[0]?.data) {
                  text = await recognize(screenshot.pages[0].data, page.num);
                  ocr = true;
                }
              } catch (error) {
                warnings.push(
                  `Page ${page.num}: local OCR could not complete. ${error instanceof Error ? error.message : "Try a clearer scan."}`.slice(
                    0,
                    400,
                  ),
                );
              }
            }
          }
          pages.push({ page: page.num, text: text.slice(0, 300_000), ocr });
          options.onProgress?.({
            status: `Reading PDF page ${page.num} of ${extracted.total}`,
            progress: page.num / extracted.total,
          });
        }
        if (options.extractImages !== false) {
          try {
            const embedded = await parser.getImage({
              first: Math.min(40, extracted.total),
              imageDataUrl: true,
              imageBuffer: false,
              imageThreshold: 100,
            });
            let bytes = 0;
            for (const page of embedded.pages)
              for (const image of page.images) {
                bytes += image.dataUrl.length;
                if (figures.length >= 100 || bytes > 8_000_000) {
                  warnings.push(
                    "Embedded image preview limit reached (100 images / 8 MB). The original document is unchanged.",
                  );
                  break;
                }
                if (
                  /^data:image\/(?:png|jpeg|webp);base64,/i.test(image.dataUrl)
                )
                  figures.push({
                    id: `p${page.pageNumber}-${createHash("sha256").update(image.name).digest("hex").slice(0, 12)}`,
                    page: page.pageNumber,
                    dataUrl: image.dataUrl,
                    width: image.width,
                    height: image.height,
                    caption: `Imported figure, page ${page.pageNumber}. Source document rights apply.`,
                  });
              }
          } catch {
            warnings.push(
              "Some embedded image formats could not be extracted. Text and page citations remain available.",
            );
          }
        }
      } finally {
        await parser.destroy();
      }
    } else if ([".md", ".txt"].includes(extension))
      pages.push({
        page: 1,
        text: (await readFile(path, "utf8")).slice(0, 2_000_000),
      });
    else {
      if (options.ocr === false)
        throw new Error("Image documents need local OCR enabled.");
      const bytes = await readFile(path);
      pages.push({ page: 1, text: await recognize(bytes, 1), ocr: true });
      const mime =
        extension === ".jpg" || extension === ".jpeg"
          ? "image/jpeg"
          : extension === ".png"
            ? "image/png"
            : extension === ".webp"
              ? "image/webp"
              : undefined;
      if (mime && bytes.length < 6_000_000)
        figures.push({
          id: "source-image",
          page: 1,
          dataUrl: `data:${mime};base64,${bytes.toString("base64")}`,
          caption: "Imported source image. Original rights apply.",
        });
    }
    const content = pages
      .map((page) => `[Page ${page.page}]\n${page.text}`)
      .join("\n\n")
      .slice(0, 2_000_000);
    if (!pages.some((page) => page.text.trim()))
      warnings.push(
        "No readable text was found. Try a higher-resolution scan or a different OCR language.",
      );
    return {
      title: source,
      content,
      source,
      pages,
      figures,
      citations: extractCitations(content),
      warnings: [...new Set(warnings)],
    };
  } finally {
    await worker?.terminate();
  }
}

export function chunkDocument(
  document: Pick<LibraryItem, "id" | "title" | "content"> & {
    pages?: { page: number; text: string }[];
  },
): DocumentChunk[] {
  const pages = document.pages?.length
    ? document.pages
    : [{ page: 1, text: document.content }];
  const chunks: DocumentChunk[] = [];
  for (const page of pages) {
    const text = page.text.slice(0, 2_000_000);
    let start = 0;
    while (start < text.length && chunks.length < 2000) {
      let end = Math.min(text.length, start + 1300);
      if (end < text.length) {
        const split = Math.max(
          text.lastIndexOf(". ", end),
          text.lastIndexOf("\n", end),
        );
        if (split > start + 650) end = split + 1;
      }
      const excerpt = text.slice(start, end).trim();
      if (excerpt)
        chunks.push({
          id: `${document.id}:p${page.page}:c${chunks.length}`,
          documentId: document.id,
          title: document.title,
          page: page.page,
          text: excerpt,
          citation: `${document.title}, page ${page.page}, excerpt ${chunks.length + 1}`,
        });
      if (end >= text.length) break;
      start = Math.max(start + 1, end - 180);
    }
  }
  return chunks;
}
const tokens = (text: string) =>
  text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .match(/[\p{L}\p{N}]{2,}/gu) || [];
/** Local BM25 retrieval: deterministic, no embeddings, uploads or model calls. */
export function searchDocuments(input: {
  query: string;
  documents: Array<
    Pick<LibraryItem, "id" | "title" | "content"> & {
      pages?: { page: number; text: string }[];
    }
  >;
  limit?: number;
}): DocumentHit[] {
  if (!input.query?.trim() || input.query.length > 500)
    throw new Error("Enter a document search of 1–500 characters.");
  const query = [...new Set(tokens(input.query))];
  if (!query.length) return [];
  const chunks = input.documents
    .slice(0, 500)
    .flatMap(chunkDocument)
    .slice(0, 12000);
  if (!chunks.length) return [];
  const corpus = chunks.map((chunk) => {
    const terms = tokens(chunk.text);
    const counts = new Map<string, number>();
    for (const term of terms) counts.set(term, (counts.get(term) || 0) + 1);
    return { chunk, length: terms.length, counts };
  });
  const average =
    corpus.reduce((sum, item) => sum + item.length, 0) / corpus.length || 1;
  const frequency = new Map(
    query.map((term) => [
      term,
      corpus.filter((item) => item.counts.has(term)).length,
    ]),
  );
  return corpus
    .map((item) => {
      let score = 0;
      for (const term of query) {
        const count = item.counts.get(term) || 0;
        if (!count) continue;
        const df = frequency.get(term)!;
        score +=
          (Math.log(1 + (corpus.length - df + 0.5) / (df + 0.5)) *
            (count * 2.2)) /
          (count + 1.2 * (0.25 + (0.75 * item.length) / average));
      }
      if (item.chunk.text.toLowerCase().includes(input.query.toLowerCase()))
        score += 2;
      return { ...item.chunk, chunkId: item.chunk.id, score };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.chunkId.localeCompare(b.chunkId))
    .slice(0, Math.max(1, Math.min(30, input.limit || 8)));
}
