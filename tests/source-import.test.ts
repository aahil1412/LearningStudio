import { describe, expect, it, vi } from "vitest";
import {
  curriculumHtmlText,
  fetchStudySource,
  MAX_STUDY_SOURCE_BYTES,
} from "../electron/sourceImport";

const publicResolve = vi.fn(async () => [{ address: "93.184.216.34" }]);
const sourceText =
  "# University mechanics\n\nWeek 1: Motion\nCoordinates, vectors, speed and acceleration.\nWeek 2: Forces\nNewton's laws and practical examples.";
const transport = (
  handler: (
    input: Parameters<typeof fetch>[0],
    init?: RequestInit,
  ) => Promise<Response>,
) => vi.fn(handler) as unknown as typeof fetch;

describe("public university and textbook source import", () => {
  it("preserves actual HTML headings and Unicode text while discarding executable and navigation content", () => {
    const result = curriculumHtmlText(
      `<html><head><title>Course page</title><style>.private{display:none}</style></head><body><nav>Account menu</nav><h1>Mechanics &amp; modelling</h1><script>fetch('/private/token')</script><h2>Week 1: Motion</h2><p>Velocity is measured in m/s &mdash; use clear units.</p><ul><li>Coordinates &#x2192; vectors</li><li>Acceleration and forces</li></ul><form><input value="token">Private account controls</form><aside>Unrelated newsletter</aside><iframe>Embedded login</iframe><footer>Cookie preferences</footer></body></html>`,
    );
    expect(result.title).toBe("Mechanics & modelling");
    expect(result.text).toContain("# Mechanics & modelling");
    expect(result.text).toContain("## Week 1: Motion");
    expect(result.text).toContain("Coordinates → vectors");
    expect(result.text).not.toMatch(
      /fetch|private|Account menu|newsletter|Embedded login|Cookie preferences|<script|<input/i,
    );
  });
  it("imports real plaintext/Markdown without synthetic page references and never sends credentials", async () => {
    const fetcher = transport(
      async () =>
        new Response(sourceText, {
          headers: { "content-type": "text/markdown; charset=utf-8" },
        }),
    );
    const result = await fetchStudySource(
      "https://university.example/course#week1",
      { fetch: fetcher, resolve: publicResolve },
    );
    expect(result).toEqual({
      url: "https://university.example/course",
      title: "university.example",
      text: sourceText,
    });
    expect(result).not.toHaveProperty("pages");
    expect(result).not.toHaveProperty("pdf");
    const [url, options] = vi.mocked(fetcher).mock.calls[0];
    expect(String(url)).toBe("https://university.example/course");
    expect(options?.credentials).toBe("omit");
    expect(options?.redirect).toBe("manual");
    expect(options?.headers).not.toHaveProperty("Authorization");
    expect(options?.headers).not.toHaveProperty("Cookie");
    expect(options?.signal).toBeInstanceOf(AbortSignal);
  });
  it("follows a validated public redirect, retains the final provenance URL and extracts HTML outline", async () => {
    const fetcher = transport(async (input) =>
      String(input).endsWith("/old")
        ? new Response(null, { status: 302, headers: { location: "/course" } })
        : new Response(
            `<h1>University course</h1><h2>Week 1: Motion</h2><p>Vectors and coordinates introduce the physical model.</p>`,
            { headers: { "content-type": "text/html" } },
          ),
    );
    const result = await fetchStudySource("https://university.example/old", {
      fetch: fetcher,
      resolve: publicResolve,
    });
    expect(result.url).toBe("https://university.example/course");
    expect(result.title).toBe("University course");
    expect(result.text).toContain("## Week 1: Motion");
    expect(vi.mocked(fetcher).mock.calls).toHaveLength(2);
  });
  it.each([
    "http://university.example/course",
    "file:///C:/private.txt",
    "https://user:secret@university.example/course",
    "https://localhost/course",
    "https://intranet/course",
    "https://host.local/course",
    "https://127.0.0.1/course",
    "https://10.0.0.1/course",
    "https://192.168.1.1/course",
    "https://172.16.0.1/course",
    "https://169.254.169.254/latest",
    "https://[::1]/course",
    "https://[fd00::1]/course",
    "https://[fe80::1]/course",
    "https://[::ffff:127.0.0.1]/course",
    "https://[ff02::1]/course",
  ])(
    "rejects private or credential-bearing source %s before fetch",
    async (url) => {
      const fetcher = transport(async () => new Response(sourceText));
      await expect(
        fetchStudySource(url, { fetch: fetcher, resolve: publicResolve }),
      ).rejects.toThrow(/HTTPS|private|Local/);
      expect(vi.mocked(fetcher).mock.calls).toHaveLength(0);
    },
  );
  it("rejects domains resolving to any private address and revalidates every redirect target", async () => {
    const fetcher = transport(
      async () =>
        new Response(null, {
          status: 302,
          headers: { location: "https://127.0.0.1/internal" },
        }),
    );
    await expect(
      fetchStudySource("https://university.example/course", {
        fetch: fetcher,
        resolve: async () => [
          { address: "93.184.216.34" },
          { address: "10.0.0.1" },
        ],
      }),
    ).rejects.toThrow(/private/);
    expect(vi.mocked(fetcher).mock.calls).toHaveLength(0);
    await expect(
      fetchStudySource("https://university.example/course", {
        fetch: fetcher,
        resolve: publicResolve,
      }),
    ).rejects.toThrow(/private/);
    expect(vi.mocked(fetcher).mock.calls).toHaveLength(1);
  });
  it("validates PDF bytes and returns an intact source file without inventing chapter extraction", async () => {
    const bytes = Buffer.from(
      "%PDF-1.7\nAn original textbook fixture, extracted separately.\n%%EOF",
    );
    const result = await fetchStudySource(
      "https://university.example/Mechanics%20Book.pdf",
      {
        fetch: transport(
          async () =>
            new Response(bytes, {
              headers: { "content-type": "application/pdf" },
            }),
        ),
        resolve: publicResolve,
      },
    );
    expect(result.title).toBe("Mechanics Book");
    expect(result.pdf?.equals(bytes)).toBe(true);
    expect(result.text).toBeUndefined();
    await expect(
      fetchStudySource("https://university.example/fake.pdf", {
        fetch: transport(
          async () =>
            new Response(sourceText, {
              headers: { "content-type": "application/pdf" },
            }),
        ),
        resolve: publicResolve,
      }),
    ).rejects.toThrow(/did not return a PDF/);
  });
  it("enforces declared and streamed size caps and handles non-readable/empty/HTTP/redirect failures", async () => {
    const cases: [Response, string][] = [
      [
        new Response("", {
          headers: {
            "content-type": "application/pdf",
            "content-length": String(MAX_STUDY_SOURCE_BYTES + 1),
          },
        }),
        "100 MB",
      ],
      [
        new Response("", {
          headers: { "content-type": "text/html", "content-length": "4000001" },
        }),
        "too large",
      ],
      [
        new Response("x".repeat(4_000_001), {
          headers: { "content-type": "text/plain" },
        }),
        "supported document size",
      ],
      [
        new Response("binary data", {
          headers: { "content-type": "application/octet-stream" },
        }),
        "not a readable",
      ],
      [new Response(null, { status: 204 }), "empty document"],
      [
        new Response("<h1>Login</h1>", {
          headers: { "content-type": "text/html" },
        }),
        "too little readable",
      ],
      [new Response("", { status: 403 }), "HTTP 403"],
      [new Response(null, { status: 302 }), "without a destination"],
    ];
    for (const [response, error] of cases)
      await expect(
        fetchStudySource("https://university.example/course", {
          fetch: transport(async () => response),
          resolve: publicResolve,
        }),
      ).rejects.toThrow(error);
    await expect(
      fetchStudySource("https://university.example/course", {
        fetch: transport(
          async () =>
            new Response(null, {
              status: 302,
              headers: { location: "/course" },
            }),
        ),
        resolve: publicResolve,
      }),
    ).rejects.toThrow(/too many times/);
  });
});
