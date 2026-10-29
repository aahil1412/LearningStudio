import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, open, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { extractDocument } from "../electron/documents";

const directories: string[] = [];
afterEach(async () => {
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});
async function directory() {
  const path = await mkdtemp(join(tmpdir(), "studio-pdf-limit-"));
  directories.push(path);
  return path;
}

/** A real multipage PDF with embedded text, explicit page tree and valid xref.
 * No remote PDF, OCR, model, parser mock or image renderer is involved. */
function textbookPdf(pageCount: number): Buffer {
  const objects: Buffer[] = [
    Buffer.from("<< /Type /Catalog /Pages 2 0 R >>"),
    Buffer.from(
      `<< /Type /Pages /Kids [${Array.from({ length: pageCount }, (_, i) => `${4 + i * 2} 0 R`).join(" ")}] /Count ${pageCount} >>`,
    ),
    Buffer.from("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"),
  ];
  for (let page = 1; page <= pageCount; page++) {
    const text = `Chapter ${page}: Actual textbook page ${page}. Physical-page-marker-${page}. ${page === pageCount ? "END_OF_TEXTBOOK_205" : "Scientific explanations preserve their original page locations."}`;
    const content = Buffer.from(`BT /F1 11 Tf 30 730 Td (${text}) Tj ET`);
    objects.push(
      Buffer.from(
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + (page - 1) * 2} 0 R >>`,
      ),
      Buffer.concat([
        Buffer.from(`<< /Length ${content.length} >>\nstream\n`),
        content,
        Buffer.from("\nendstream"),
      ]),
    );
  }
  const parts = [Buffer.from("%PDF-1.4\n")],
    offsets: number[] = [];
  let length = parts[0].length;
  objects.forEach((object, index) => {
    offsets.push(length);
    const part = Buffer.concat([
      Buffer.from(`${index + 1} 0 obj\n`),
      object,
      Buffer.from("\nendobj\n"),
    ]);
    parts.push(part);
    length += part.length;
  });
  parts.push(
    Buffer.from(
      `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${length}\n%%EOF\n`,
    ),
  );
  return Buffer.concat(parts);
}

describe("real textbook document import limits", () => {
  it("retains the default 200-page limit and lets explicit source-study import read genuine page 205", async () => {
    const path = join(await directory(), "205-page-textbook.pdf"),
      bytes = textbookPdf(205);
    await writeFile(path, bytes);
    const ordinary = await extractDocument(path, {
      ocr: false,
      extractImages: false,
    });
    expect(ordinary.pages).toHaveLength(200);
    expect(ordinary.pages.at(-1)?.page).toBe(200);
    expect(ordinary.warnings.join(" ")).toContain("first 200 pages");
    expect(ordinary.content).not.toContain("END_OF_TEXTBOOK_205");
    const source = await extractDocument(path, {
      ocr: false,
      extractImages: false,
      maxPages: 2000,
      maxOcrPages: 2000,
      maxBytes: 100_000_000,
    });
    expect(source.pages).toHaveLength(205);
    expect(source.pages[204]).toMatchObject({ page: 205, ocr: false });
    expect(source.pages[204].text).toContain("Physical-page-marker-205");
    expect(source.content).toContain("[Page 205]");
    expect(source.content).toContain("END_OF_TEXTBOOK_205");
    expect(source.warnings.join(" ")).not.toMatch(/first 200 pages|OCR/);
    expect(source.pages.every((page) => page.ocr === false)).toBe(true);
  }, 30000);
  it("rejects files above the hard 100 MB ceiling using file metadata before reading or parsing", async () => {
    const path = join(await directory(), "oversized-textbook.pdf"),
      file = await open(path, "w");
    // Extending a file exercises the real stat gate without allocating a
    // 100 MB JavaScript buffer or passing oversized bytes into the PDF parser.
    try {
      await file.truncate(100_000_001);
    } finally {
      await file.close();
    }
    await expect(
      extractDocument(path, {
        ocr: false,
        extractImages: false,
        maxBytes: 200_000_000,
        maxPages: 2000,
      }),
    ).rejects.toThrow("smaller than 100 MB");
    await expect(
      extractDocument(path, { ocr: false, extractImages: false }),
    ).rejects.toThrow("smaller than 20 MB");
  });
});
