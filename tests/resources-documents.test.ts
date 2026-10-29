import { afterEach, describe, it, expect } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  configureDocumentRuntime,
  extractDocument,
  chunkDocument,
  searchDocuments,
  extractCitations,
  availableOcrLanguages,
  installOcrLanguage,
} from "../electron/documents";
const directories: string[] = [];
afterEach(async () => {
  for (const path of directories.splice(0))
    await rm(path, { recursive: true, force: true });
});
async function directory() {
  const path = await mkdtemp(join(process.cwd(), ".document-test-"));
  directories.push(path);
  configureDocumentRuntime({
    cacheDirectory: join(path, "ocr"),
    languageDirectory: join(process.cwd(), "assets", "ocr"),
  });
  return path;
}
describe("document retrieval and local OCR", () => {
  it("imports a bounded local language dataset and lists only installed OCR languages", async () => {
    await directory();
    expect(await availableOcrLanguages()).toContain("eng");
    const installed = await installOcrLanguage(
      join(process.cwd(), "assets", "ocr", "eng.traineddata.gz"),
    );
    expect(installed).toMatchObject({
      language: "eng",
      sha256:
        "7d4322bd2a7749724879683fc3912cb542f19906c83bcc1a52132556427170b2",
    });
    await expect(installOcrLanguage("untrusted-language.exe")).rejects.toThrow(
      "three-letter code",
    );
  });
  it("chunks with overlap and ranks relevant page citations using local BM25", () => {
    const document = {
      id: "doc",
      title: "Physics notes",
      content: "",
      pages: [
        { page: 1, text: "Waves carry energy. ".repeat(120) },
        {
          page: 2,
          text: "The Fourier transform decomposes a signal into frequencies. Orthogonal basis functions describe spectra.",
        },
      ],
    };
    const chunks = chunkDocument(document);
    expect(chunks.length).toBeGreaterThan(2);
    expect(chunks[0].text.slice(-100)).toContain("Waves");
    const hits = searchDocuments({
      query: "Fourier transform frequencies",
      documents: [document],
    });
    expect(hits[0]).toMatchObject({
      documentId: "doc",
      page: 2,
      title: "Physics notes",
    });
    expect(hits[0].citation).toContain("page 2");
    expect(
      searchDocuments({ query: "unrelatedword", documents: [document] }),
    ).toEqual([]);
  });
  it("imports Markdown locally and extracts deduplicated DOI provenance without verification claims", async () => {
    const dir = await directory();
    const path = join(dir, "notes.md");
    await writeFile(
      path,
      "# Sources\nA citation: 10.1038/nphys1170.\nSame DOI 10.1038/nphys1170\n",
    );
    const result = await extractDocument(path);
    expect(result.pages[0].page).toBe(1);
    expect(result.citations).toHaveLength(1);
    expect(result.citations[0].doi).toBe("10.1038/nphys1170");
    expect(extractCitations("No reference here")).toEqual([]);
  });
  it("recognizes actual image text using the bundled offline Tesseract engine", async () => {
    const dir = await directory();
    const { createCanvas } = await import("@napi-rs/canvas");
    const canvas = createCanvas(1400, 280);
    const context = canvas.getContext("2d");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, 1400, 280);
    context.fillStyle = "#000000";
    context.font = "64px Arial";
    context.fillText("WAVES CARRY ENERGY", 70, 150);
    const path = join(dir, "scan.png");
    await writeFile(path, canvas.toBuffer("image/png"));
    const result = await extractDocument(path);
    expect(result.pages[0].ocr).toBe(true);
    expect(result.content.toUpperCase()).toContain("WAVES CARRY ENERGY");
    expect(result.figures[0].dataUrl).toMatch(/^data:image\/png;base64,/);
  }, 30000);
  it("extracts an embedded image and OCRs a scanned PDF page with actual PDF rendering", async () => {
    const dir = await directory();
    const { createCanvas } = await import("@napi-rs/canvas");
    const canvas = createCanvas(1400, 280);
    const context = canvas.getContext("2d");
    context.fillStyle = "white";
    context.fillRect(0, 0, 1400, 280);
    context.fillStyle = "black";
    context.font = "64px Arial";
    context.fillText("SCIENCE CONNECTS IDEAS", 40, 150);
    const jpeg = canvas.toBuffer("image/jpeg");
    const content = Buffer.from("q 600 0 0 120 6 600 cm /Im1 Do Q");
    const objects = [
      Buffer.from("<< /Type /Catalog /Pages 2 0 R >>"),
      Buffer.from("<< /Type /Pages /Kids [3 0 R] /Count 1 >>"),
      Buffer.from(
        "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /XObject << /Im1 5 0 R >> >> /Contents 4 0 R >>",
      ),
      Buffer.concat([
        Buffer.from(`<< /Length ${content.length} >>\nstream\n`),
        content,
        Buffer.from("\nendstream"),
      ]),
      Buffer.concat([
        Buffer.from(
          `<< /Type /XObject /Subtype /Image /Width 1400 /Height 280 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`,
        ),
        jpeg,
        Buffer.from("\nendstream"),
      ]),
    ];
    const buffers = [Buffer.from("%PDF-1.4\n")],
      offsets: number[] = [0];
    let length = buffers[0].length;
    objects.forEach((object, index) => {
      offsets.push(length);
      const buffer = Buffer.concat([
        Buffer.from(`${index + 1} 0 obj\n`),
        object,
        Buffer.from("\nendobj\n"),
      ]);
      buffers.push(buffer);
      length += buffer.length;
    });
    const xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets
      .slice(1)
      .map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)
      .join(
        "",
      )}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${length}\n%%EOF`;
    const path = join(dir, "scanned.pdf");
    await writeFile(path, Buffer.concat([...buffers, Buffer.from(xref)]));
    const result = await extractDocument(path, {
      ocr: true,
      extractImages: true,
    });
    expect(result.pages[0].ocr).toBe(true);
    expect(result.content.toUpperCase()).toContain("SCIENCE CONNECTS IDEAS");
    expect(result.figures.length).toBeGreaterThan(0);
    expect(result.figures[0].page).toBe(1);
  }, 30000);
});
