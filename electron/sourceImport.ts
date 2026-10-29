import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { request } from "node:https";
import { Readable } from "node:stream";

export const MAX_STUDY_SOURCE_BYTES = 100_000_000;
type Options = {
  fetch?: typeof fetch;
  resolve?: (host: string) => Promise<{ address: string }[]>;
};
function privateAddress(value: string): boolean {
  const address = value.replace(/^\[|\]$/g, "").toLowerCase();
  if (address.startsWith("::ffff:")) {
    const mapped = address.slice(7);
    if (mapped.includes(".")) return privateAddress(mapped);
    const parts = mapped.split(":");
    if (parts.length === 2) {
      const high = parseInt(parts[0], 16),
        low = parseInt(parts[1], 16);
      return privateAddress(
        `${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`,
      );
    }
    return true;
  }
  if (isIP(address) === 4) {
    const [a, b] = address.split(".").map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      a >= 224 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 198 && (b === 18 || b === 19))
    );
  }
  return (
    isIP(address) === 6 &&
    (!/^[23]/.test(address) || address.startsWith("2001:db8:"))
  );
}
async function publicSourceUrl(
  input: string,
  options: Options,
): Promise<{ url: URL; addresses: { address: string }[] }> {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new Error("Enter a complete HTTPS curriculum or textbook URL.");
  }
  if (url.protocol !== "https:" || url.username || url.password)
    throw new Error("Use a public HTTPS source without embedded credentials.");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    (!host.includes(".") && !isIP(host))
  )
    throw new Error(
      "Local and private-network sources must be imported as files.",
    );
  const addresses = isIP(host)
    ? [{ address: host }]
    : await (options.resolve?.(host) || lookup(host, { all: true }));
  if (
    !addresses.length ||
    addresses.some(({ address }) => privateAddress(address))
  )
    throw new Error(
      "Local and private-network sources must be imported as files.",
    );
  url.hash = "";
  return { url, addresses };
}
/** Pin the validated address for this TLS connection to prevent DNS rebinding.
 * The URL hostname still supplies certificate validation and SNI. */
function pinnedFetch(
  url: URL,
  addresses: { address: string }[],
  init: RequestInit,
): Promise<Response> {
  return new Promise((resolve, reject) => {
    const destination = addresses[0].address;
    const req = request(
      url,
      {
        method: "GET",
        headers: {
          Accept: "text/html,text/plain,text/markdown,application/pdf",
        },
        signal: init.signal || undefined,
        lookup: (_hostname, options, callback) => {
          const family = isIP(destination);
          if (options.all) callback(null, [{ address: destination, family }]);
          else callback(null, destination, family);
        },
      },
      (incoming) => {
        const headers = new Headers();
        for (const [key, value] of Object.entries(incoming.headers))
          if (value !== undefined)
            headers.set(key, Array.isArray(value) ? value.join(", ") : value);
        const status = incoming.statusCode || 502;
        if ([204, 205, 304].includes(status)) {
          incoming.resume();
          resolve(new Response(null, { status, headers }));
        } else
          resolve(
            new Response(
              Readable.toWeb(incoming) as ReadableStream<Uint8Array>,
              { status, headers },
            ),
          );
      },
    );
    req.on("error", reject);
    req.end();
  });
}
function entities(text: string) {
  return text.replace(
    /&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi,
    (_, entity: string) => {
      const key = entity.toLowerCase();
      if (key[0] === "#") {
        const code =
          key[1] === "x"
            ? parseInt(key.slice(2), 16)
            : parseInt(key.slice(1), 10);
        return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "";
      }
      return (
        (
          {
            amp: "&",
            lt: "<",
            gt: ">",
            quot: '"',
            apos: "'",
            nbsp: " ",
          } as Record<string, string>
        )[key] || ""
      );
    },
  );
}
export function curriculumHtmlText(html: string): {
  title: string;
  text: string;
} {
  const clean = html.replace(
    /<(script|style|nav|footer|aside|noscript|template|iframe|form)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,
    "",
  );
  const strip = (text: string) =>
    entities(text.replace(/<[^>]*>/g, " "))
      .replace(/[ \t]+/g, " ")
      .trim();
  const title = strip(
    /<h1\b[^>]*>([\s\S]*?)<\/h1\s*>/i.exec(clean)?.[1] ||
      /<title\b[^>]*>([\s\S]*?)<\/title\s*>/i.exec(clean)?.[1] ||
      "Imported curriculum",
  ).slice(0, 300);
  const body = /<body\b[^>]*>([\s\S]*?)<\/body\s*>/i.exec(clean)?.[1] || clean;
  const text = entities(
    body
      .replace(
        /<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1\s*>/gi,
        (_, level: string, content: string) =>
          `\n\n${"#".repeat(Number(level))} ${strip(content)}\n\n`,
      )
      .replace(/<li\b[^>]*>/gi, "\n- ")
      .replace(/<\/?(?:p|div|section|article|table|tr)\b[^>]*>/gi, "\n")
      .replace(/<\/?(?:td|th)\b[^>]*>/gi, " | ")
      .replace(/<br\b[^>]*>/gi, "\n")
      .replace(/<[^>]*>/g, " "),
  )
    .replace(/[ \t]+/g, " ")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, 2_000_000);
  return { title, text };
}
export async function fetchStudySource(
  input: string,
  options: Options = {},
): Promise<{ url: string; title: string; text?: string; pdf?: Buffer }> {
  let { url, addresses } = await publicSourceUrl(input, options);
  for (let redirects = 0; redirects < 4; redirects++) {
    const init: RequestInit = {
      method: "GET",
      redirect: "manual",
      credentials: "omit",
      headers: { Accept: "text/html,text/plain,text/markdown,application/pdf" },
      signal: AbortSignal.timeout(30000),
    };
    const response = await (options.fetch
      ? options.fetch(url, init)
      : pinnedFetch(url, addresses, init));
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      await response.body?.cancel();
      if (!location)
        throw new Error("The source redirected without a destination.");
      ({ url, addresses } = await publicSourceUrl(
        new URL(location, url).href,
        options,
      ));
      continue;
    }
    if (!response.ok)
      throw new Error(
        `The source returned HTTP ${response.status}. Upload the file or paste its curriculum text instead.`,
      );
    const type = (response.headers.get("content-type") || "").toLowerCase();
    const pdf =
      type.includes("application/pdf") ||
      url.pathname.toLowerCase().endsWith(".pdf");
    const limit = pdf ? MAX_STUDY_SOURCE_BYTES : 4_000_000;
    if (Number(response.headers.get("content-length")) > limit) {
      await response.body?.cancel();
      throw new Error(
        pdf
          ? "Choose a textbook PDF smaller than100 MB."
          : "This page is too large. Upload a document or paste the curriculum instead.",
      );
    }
    const reader = response.body?.getReader();
    if (!reader) throw new Error("The source returned an empty document.");
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      for (;;) {
        const part = await reader.read();
        if (part.done) break;
        size += part.value.length;
        if (size > limit)
          throw new Error("The source exceeds the supported document size.");
        chunks.push(part.value);
      }
    } catch (error) {
      await reader.cancel().catch(() => {});
      throw error;
    }
    const bytes = Buffer.concat(chunks, size);
    if (pdf) {
      if (!bytes.subarray(0, 1024).toString("latin1").includes("%PDF-"))
        throw new Error("This URL did not return a PDF file.");
      return {
        url: url.href,
        title: decodeURIComponent(url.pathname.split("/").pop() || "Textbook")
          .replace(/\.pdf$/i, "")
          .slice(0, 300),
        pdf: bytes,
      };
    }
    if (!/text\/|application\/(?:xhtml|xml|json)/.test(type) && type)
      throw new Error(
        "This URL is not a readable curriculum page, text document or PDF.",
      );
    const raw = bytes.toString("utf8"),
      html = type.includes("html") || /<(?:html|body|h1)\b/i.test(raw);
    const extracted = html
      ? curriculumHtmlText(raw)
      : { title: url.hostname, text: raw.slice(0, 2_000_000) };
    if (extracted.text.trim().length < 40)
      throw new Error(
        "This page has too little readable text. Upload the source or paste its curriculum instead.",
      );
    return { url: url.href, title: extracted.title, text: extracted.text };
  }
  throw new Error(
    "The source redirected too many times. Upload the file or use its final public URL.",
  );
}
