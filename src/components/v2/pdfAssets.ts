// PDF font/CMap resources are data URLs, so the file:// desktop build never
// depends on a remote font service or fetch support for local asset paths.
const cmaps = import.meta.glob<string>(
  "/node_modules/pdfjs-dist/cmaps/*.bcmap",
  { eager: true, query: "?url&inline", import: "default" },
);
const fonts = import.meta.glob<string>(
  [
    "/node_modules/pdfjs-dist/standard_fonts/*.pfb",
    "/node_modules/pdfjs-dist/standard_fonts/*.ttf",
  ],
  { eager: true, query: "?url&inline", import: "default" },
);
function bytes(resources: Record<string, string>, filename: string) {
  const entry = Object.entries(resources).find(([path]) =>
    path.endsWith("/" + filename),
  );
  if (!entry)
    throw new Error(
      "This PDF requests an unavailable local rendering resource: " + filename,
    );
  const url = entry[1],
    offset = url.indexOf(","),
    raw = url.slice(offset + 1);
  return url.slice(0, offset).endsWith(";base64")
    ? Uint8Array.from(atob(raw), (char) => char.charCodeAt(0))
    : new TextEncoder().encode(decodeURIComponent(raw));
}
export class BundledCMaps {
  async fetch({ name }: { name: string }) {
    return { cMapData: bytes(cmaps, name + ".bcmap"), isCompressed: true };
  }
}
export class BundledPdfFonts {
  async fetch({ filename }: { filename: string }) {
    return bytes(fonts, filename);
  }
}
