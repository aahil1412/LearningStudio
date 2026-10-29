import { afterEach, describe, expect, it, vi } from "vitest";
import { createServer, type Server } from "node:http";
import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
vi.mock("electron", () => ({
  safeStorage: {
    isEncryptionAvailable: vi.fn(() => true),
    encryptString: vi.fn((value: string) => Buffer.from("protected:" + value)),
    decryptString: vi.fn((value: Buffer) => {
      if (!value.toString().startsWith("protected:"))
        throw new Error("Cannot decrypt");
      return value.toString().slice(10);
    }),
  },
}));
import { safeStorage } from "electron";
import {
  consumeProviderStream,
  ModelProviderService,
  providerEndpoint,
} from "../electron/providers";
import { consumeResponseStream } from "../electron/auth";
import type { ProviderUsageSample } from "../src/providerTypes";

const directories: string[] = [],
  servers: Server[] = [];
afterEach(async () => {
  vi.clearAllMocks();
  vi.mocked(safeStorage.isEncryptionAvailable).mockReturnValue(true);
  await Promise.all(
    servers
      .splice(0)
      .map(
        (server) =>
          new Promise<void>((resolve) => server.close(() => resolve())),
      ),
  );
  for (const dir of directories.splice(0)) {
    if (!dir.startsWith(join(resolve(".tools"), "providers-test-")))
      throw new Error("Unsafe fixture cleanup path");
    await rm(dir, { recursive: true, force: true });
  }
});
const request = {
  model: "subscription-model",
  instructions: "Return a concise explanation.",
  input: [
    {
      role: "user" as const,
      content: "An explicit controlled provider acceptance question.",
    },
  ],
};
function authAdapter() {
  return {
    status: vi.fn(async () => ({
      connected: true,
      profileId: "primary",
      account: "Controlled account fixture",
    })),
    models: vi.fn(async () => [
      {
        id: "subscription-model",
        name: "Subscription fixture",
        reasoningLevels: ["low"],
      },
    ]),
    respond: vi.fn(
      async (
        _request: typeof request,
        onDelta: (value: string) => void,
        _signal: AbortSignal,
        onUsage?: (value: ProviderUsageSample) => void,
      ) => {
        onDelta("Subscription fixture text");
        onUsage?.({ inputTokens: 11, outputTokens: 7 });
        return "Subscription fixture text";
      },
    ),
  };
}
async function directory() {
  await mkdir(".tools", { recursive: true });
  const dir = await mkdtemp(join(resolve(".tools"), "providers-test-"));
  directories.push(dir);
  return dir;
}
const fromBytes = (value: string, kind = "text/event-stream", size = 7) =>
  new Response(
    new ReadableStream({
      start(controller) {
        const bytes = new TextEncoder().encode(value);
        for (let i = 0; i < bytes.length; i += size)
          controller.enqueue(bytes.slice(i, i + size));
        controller.close();
      },
    }),
    { headers: { "Content-Type": kind } },
  );
async function httpFixture() {
  const calls: { path: string; authorization?: string; body?: any }[] = [];
  const server = createServer(async (req, res) => {
    let text = "";
    for await (const chunk of req) text += chunk.toString();
    const call = {
      path: req.url!,
      authorization: req.headers.authorization,
      body: text ? JSON.parse(text) : undefined,
    };
    calls.push(call);
    if (req.url === "/api/tags") {
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({
          models: [
            { name: "controlled-local-model", model: "controlled-local-model" },
          ],
        }),
      );
      return;
    }
    if (req.url === "/v1/models") {
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({ data: [{ id: "controlled-compatible-model" }] }),
      );
      return;
    }
    if (req.url === "/api/chat") {
      res.setHeader("Content-Type", "application/x-ndjson");
      res.write(
        JSON.stringify({
          message: { content: "Local fixture " },
          done: false,
        }) + "\n",
      );
      setTimeout(
        () =>
          res.end(
            JSON.stringify({
              message: { content: "reply." },
              done: true,
              done_reason: "stop",
              prompt_eval_count: 9,
              eval_count: 4,
            }) + "\n",
          ),
        5,
      );
      return;
    }
    if (req.url === "/v1/chat/completions") {
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("x-ratelimit-remaining-requests", "47");
      res.write(
        'data: {"choices":[{"delta":{"content":"Compatible fixture reply."}}]}\r\n\r\n',
      );
      res.end(
        'data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":8,"completion_tokens":5}}\r\n\r\ndata: [DONE]\r\n\r\n',
      );
      return;
    }
    res.statusCode = 404;
    res.end("missing");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  servers.push(server);
  return {
    url: `http://127.0.0.1:${(server.address() as { port: number }).port}`,
    calls,
  };
}

describe("provider configuration and boundaries", () => {
  it("keeps existing ChatGPT defaults and raw model routing, with no paid fallback", async () => {
    const auth = authAdapter(),
      service = new ModelProviderService(await directory(), auth);
    expect((await service.list()).activeId).toBe("chatgpt");
    expect(await service.models()).toEqual(await auth.models());
    const text = await service.respond(
      request,
      () => {},
      new AbortController().signal,
    );
    expect(text).toBe("Subscription fixture text");
    const usage = await service.usage();
    expect(usage.planRemaining.available).toBe(false);
    expect(usage.planRemaining.explanation).toContain("does not expose");
    expect(usage.manageUsageUrl).toBe("https://chatgpt.com/settings/usage");
    expect(usage.observed).toMatchObject({
      completedRequests: 1,
      inputTokens: 11,
      outputTokens: 7,
      tokenReportedRequests: 1,
    });
    expect(JSON.stringify(usage)).not.toContain(request.input[0].content);
  });
  it.each([
    "http://public.example/v1",
    "file:///C:/Windows",
    "https://key:secret@example.test/v1",
    "https://example.test/v1?api_key=secret",
    "https://example.test/v1#token",
  ])("rejects unsafe remote configuration %s", (value) => {
    expect(() => providerEndpoint(value, "openai-compatible")).toThrow();
  });
  it("only permits loopback for Ollama and supports explicit local compatible servers", () => {
    expect(() => providerEndpoint("https://public.example", "ollama")).toThrow(
      "loopback",
    );
    expect(providerEndpoint("http://[::1]:11434/", "ollama").loopback).toBe(
      true,
    );
    expect(
      providerEndpoint("http://localhost:1234/v1/", "openai-compatible").url,
    ).toBe("http://localhost:1234/v1");
  });
  it("requires external consent before saving and never copies ChatGPT credentials", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(),
      service = new ModelProviderService(await directory(), authAdapter(), {
        fetch,
      });
    await expect(
      service.saveProfile({
        label: "External",
        kind: "openai-compatible",
        baseUrl: "https://provider.example/v1",
        apiKey: "fixture-secret",
      }),
    ).rejects.toThrow("consent");
    expect(fetch).not.toHaveBeenCalled();
    await service.saveProfile({
      label: "External",
      kind: "openai-compatible",
      baseUrl: "https://provider.example/v1",
      externalConsent: true,
    });
    const profile = (await service.list()).profiles[1];
    await service.select(profile.id);
    await expect(service.models()).rejects.toThrow("API key");
    expect(fetch).not.toHaveBeenCalled();
  });
  it("protects keys, returns no secret, and excludes connections from learning-data backups", async () => {
    const dir = await directory(),
      service = new ModelProviderService(dir, authAdapter());
    const result = await service.saveProfile({
      label: "Fixture server",
      kind: "openai-compatible",
      baseUrl: "https://provider.example/v1",
      externalConsent: true,
      apiKey: "not-a-real-provider-key",
    });
    const profile = result.profiles[1];
    expect(profile.hasKey).toBe(true);
    expect(JSON.stringify(result)).not.toContain("not-a-real-provider-key");
    expect(
      await readFile(join(dir, "model-providers.json"), "utf8"),
    ).not.toContain("not-a-real-provider-key");
    expect(
      (
        await readFile(
          join(dir, "provider-credentials", profile.id + ".encrypted"),
          "utf8",
        )
      ).startsWith("protected:"),
    ).toBe(true);
    const restarted = new ModelProviderService(dir, authAdapter());
    expect((await restarted.list()).profiles[1].hasKey).toBe(true);
    await restarted.remove(profile.id);
    expect((await restarted.list()).profiles).toHaveLength(1);
    await expect(
      readFile(join(dir, "provider-credentials", profile.id + ".encrypted")),
    ).rejects.toThrow();
  });
  it("never transfers a stored key to an edited provider address without a replacement or explicit removal", async () => {
    const transport = vi.fn<typeof fetch>(),
      dir = await directory(),
      service = new ModelProviderService(dir, authAdapter(), {
        fetch: transport,
      });
    const listing = await service.saveProfile({
      label: "First origin",
      kind: "openai-compatible",
      baseUrl: "https://first.example/v1",
      externalConsent: true,
      apiKey: "FAKE_FIRST_ORIGIN_KEY",
    });
    const profile = listing.profiles[1];
    await expect(
      service.saveProfile({
        id: profile.id,
        label: "Second origin",
        kind: "openai-compatible",
        baseUrl: "https://second.example/v1",
        externalConsent: true,
      }),
    ).rejects.toThrow("never transferred");
    expect((await service.list()).profiles[1].baseUrl).toBe(
      "https://first.example/v1",
    );
    expect(transport).not.toHaveBeenCalled();
    const changed = await service.saveProfile({
      id: profile.id,
      label: "Second origin",
      kind: "openai-compatible",
      baseUrl: "https://second.example/v1",
      externalConsent: true,
      clearKey: true,
    });
    expect(changed.profiles[1].baseUrl).toBe("https://second.example/v1");
    expect(changed.profiles[1].hasKey).toBe(false);
    await service.select(profile.id);
    await expect(service.models()).rejects.toThrow("API key");
    expect(transport).not.toHaveBeenCalled();
  });
  it("binds encrypted credentials to profile, protocol and exact endpoint even if config files are mismatched", async () => {
    const dir = await directory(),
      transport = vi.fn<typeof fetch>(),
      service = new ModelProviderService(dir, authAdapter(), {
        fetch: transport,
      });
    const listing = await service.saveProfile({
      label: "Bound key",
      kind: "openai-compatible",
      baseUrl: "https://first.example/v1",
      externalConsent: true,
      apiKey: "FAKE_BOUND_KEY",
    });
    const file = join(dir, "model-providers.json"),
      index = JSON.parse(await readFile(file, "utf8"));
    index.activeId = listing.profiles[1].id;
    index.profiles[0].baseUrl = "https://second.example/v1";
    await writeFile(file, JSON.stringify(index));
    const restarted = new ModelProviderService(dir, authAdapter(), {
      fetch: transport,
    });
    await expect(restarted.models()).rejects.toThrow("Re-enter");
    expect(transport).not.toHaveBeenCalled();
    const protectedText = await readFile(
      join(dir, "provider-credentials", listing.profiles[1].id + ".encrypted"),
      "utf8",
    );
    const binding = JSON.parse(protectedText.slice("protected:".length));
    expect(binding).toMatchObject({
      version: 1,
      profileId: listing.profiles[1].id,
      kind: "openai-compatible",
      baseUrl: "https://first.example/v1",
    });
  });
  it("refuses plaintext fallback when protected Windows storage is unavailable", async () => {
    const dir = await directory(),
      service = new ModelProviderService(dir, authAdapter());
    vi.mocked(safeStorage.isEncryptionAvailable).mockReturnValue(false);
    await expect(
      service.saveProfile({
        label: "Fixture",
        kind: "openai-compatible",
        baseUrl: "https://provider.example/v1",
        apiKey: "private-key",
        externalConsent: true,
      }),
    ).rejects.toThrow("No plaintext");
    expect((await service.list()).profiles).toHaveLength(1);
  });
  it("preserves malformed configuration rather than silently resetting it", async () => {
    const dir = await directory(),
      file = join(dir, "model-providers.json");
    await writeFile(file, '{"version":1,"activeId":"missing","profiles":[]}');
    await expect(
      new ModelProviderService(dir, authAdapter()).list(),
    ).rejects.toThrow("not been replaced");
    expect(await readFile(file, "utf8")).toContain('"missing"');
  });
});

describe("validated active-provider changes", () => {
  const connection = {
    label: "Active connection",
    kind: "openai-compatible" as const,
    baseUrl: "http://127.0.0.1:1234/v1",
    apiKey: "FAKE_ORIGINAL_KEY",
  };
  it("keeps requests running when an active edit fails validation or encryption", async () => {
    const dir = await directory(),
      beforeActiveChange = vi.fn(),
      service = new ModelProviderService(dir, authAdapter(), {
        beforeActiveChange,
      });
    const listing = await service.saveProfile(connection),
      id = listing.profiles[1].id;
    await service.select(id);
    beforeActiveChange.mockClear();
    const originalConfig = await readFile(join(dir, "model-providers.json")),
      originalKey = await readFile(
        join(dir, "provider-credentials", id + ".encrypted"),
      );
    await expect(
      service.saveProfile({ ...connection, id, label: " " }),
    ).rejects.toThrow();
    await expect(
      service.saveProfile({
        ...connection,
        id,
        baseUrl: "http://127.0.0.1:5678/v1",
        apiKey: "",
      }),
    ).rejects.toThrow("never transferred");
    await expect(service.select("missing-profile")).rejects.toThrow("Unknown");
    vi.mocked(safeStorage.isEncryptionAvailable).mockReturnValueOnce(false);
    await expect(
      service.saveProfile({ ...connection, id, apiKey: "FAKE_NEW_KEY" }),
    ).rejects.toThrow("No plaintext");
    vi.mocked(safeStorage.encryptString).mockImplementationOnce(() => {
      throw new Error("Controlled encryption failure");
    });
    await expect(
      service.saveProfile({ ...connection, id, apiKey: "FAKE_NEW_KEY" }),
    ).rejects.toThrow("Controlled encryption failure");
    expect(beforeActiveChange).not.toHaveBeenCalled();
    expect(await readFile(join(dir, "model-providers.json"))).toEqual(
      originalConfig,
    );
    expect(
      await readFile(join(dir, "provider-credentials", id + ".encrypted")),
    ).toEqual(originalKey);
  });
  it("does not interrupt requests for labels, unchanged keys, or inactive-provider edits", async () => {
    const beforeActiveChange = vi.fn(),
      service = new ModelProviderService(await directory(), authAdapter(), {
        beforeActiveChange,
      });
    const listing = await service.saveProfile(connection),
      id = listing.profiles[1].id;
    expect(beforeActiveChange).not.toHaveBeenCalled();
    await service.select(id);
    beforeActiveChange.mockClear();
    await service.saveProfile({
      ...connection,
      id,
      label: "Renamed connection",
      baseUrl: connection.baseUrl + "/",
      apiKey: "",
    });
    await service.saveProfile({ ...connection, id });
    const added = await service.saveProfile({
        label: "Inactive connection",
        kind: "ollama",
        baseUrl: "http://localhost:11434",
      }),
      inactive = added.profiles.find(
        (profile) => profile.label === "Inactive connection",
      )!;
    await service.saveProfile({
      ...inactive,
      baseUrl: "http://localhost:11435",
    });
    expect(beforeActiveChange).not.toHaveBeenCalled();
    await service.select(inactive.id);
    beforeActiveChange.mockClear();
    await service.saveProfile({
      ...inactive,
      baseUrl: "http://localhost:11435",
      clearKey: true,
    });
    expect(beforeActiveChange).not.toHaveBeenCalled();
  });
  it.each([
    {
      change: "endpoint",
      patch: { baseUrl: "http://127.0.0.1:5678/v1", apiKey: "FAKE_NEW_KEY" },
    },
    {
      change: "protocol",
      patch: { kind: "ollama", apiKey: "", clearKey: true },
    },
    { change: "key", patch: { apiKey: "FAKE_NEW_KEY" } },
    { change: "key removal", patch: { apiKey: "", clearKey: true } },
  ])(
    "cancels before committing an active $change change, after preparing credentials",
    async ({ patch }) => {
      const dir = await directory(),
        beforeActiveChange = vi.fn(),
        service = new ModelProviderService(dir, authAdapter(), {
          beforeActiveChange,
        });
      const listing = await service.saveProfile(connection),
        id = listing.profiles[1].id,
        configPath = join(dir, "model-providers.json"),
        keyPath = join(dir, "provider-credentials", id + ".encrypted");
      await service.select(id);
      beforeActiveChange.mockClear();
      vi.mocked(safeStorage.encryptString).mockClear();
      const originalConfig = await readFile(configPath, "utf8"),
        originalKey = await readFile(keyPath);
      beforeActiveChange.mockImplementation(() => {
        expect(readFileSync(configPath, "utf8")).toBe(originalConfig);
        expect(readFileSync(keyPath)).toEqual(originalKey);
        if (patch.apiKey)
          expect(safeStorage.encryptString).toHaveBeenCalledTimes(1);
      });
      const saved = await service.saveProfile({ ...connection, id, ...patch });
      expect(beforeActiveChange).toHaveBeenCalledTimes(1);
      expect(saved.profiles.find((profile) => profile.id === id)).toMatchObject(
        {
          kind: patch.kind || connection.kind,
          baseUrl: patch.baseUrl || connection.baseUrl,
          hasKey: !patch.clearKey,
        },
      );
    },
  );
  it("cancels once for each validated provider switch, before updating its active ID", async () => {
    const dir = await directory(),
      observed: string[] = [],
      service = new ModelProviderService(dir, authAdapter(), {
        beforeActiveChange: () =>
          observed.push(
            JSON.parse(readFileSync(join(dir, "model-providers.json"), "utf8"))
              .activeId,
          ),
      });
    const listing = await service.saveProfile(connection),
      id = listing.profiles[1].id;
    await service.select("chatgpt");
    await expect(service.select("missing-profile")).rejects.toThrow("Unknown");
    expect(observed).toEqual([]);
    await service.select(id);
    await service.select(id);
    await service.select("chatgpt");
    expect(observed).toEqual(["chatgpt", id]);
  });
});

describe("actual local HTTP adapters without installing a model", () => {
  it("discovers local Ollama models and streams real NDJSON through its configured endpoint", async () => {
    const fixture = await httpFixture(),
      auth = authAdapter(),
      service = new ModelProviderService(await directory(), auth);
    const saved = await service.saveProfile({
      label: "Explicit HTTP fixture, not a model",
      kind: "ollama",
      baseUrl: fixture.url,
    });
    const id = saved.profiles[1].id;
    await service.select(id);
    const models = await service.models();
    expect(models).toHaveLength(1);
    expect(models[0].id).toContain(`provider:${id}:controlled-local-model`);
    expect(models[0].reasoningLevels).toEqual([]);
    const deltas: string[] = [];
    expect(
      await service.respond(
        { ...request, model: models[0].id },
        (text) => deltas.push(text),
        new AbortController().signal,
      ),
    ).toBe("Local fixture reply.");
    expect(deltas).toEqual(["Local fixture ", "reply."]);
    expect(fixture.calls[1].body).toMatchObject({
      model: "controlled-local-model",
      stream: true,
      messages: [
        { role: "system", content: request.instructions },
        ...request.input,
      ],
    });
    expect(fixture.calls.every((call) => !call.authorization)).toBe(true);
    expect(auth.respond).not.toHaveBeenCalled();
    expect((await service.usage()).observed).toMatchObject({
      completedRequests: 1,
      inputTokens: 9,
      outputTokens: 4,
    });
  });
  it("supports compatible local HTTP SSE, numeric provider headers and restart without API credentials", async () => {
    const fixture = await httpFixture(),
      dir = await directory(),
      auth = authAdapter(),
      service = new ModelProviderService(dir, auth);
    const saved = await service.saveProfile({
      label: "Compatible fixture",
      kind: "openai-compatible",
      baseUrl: fixture.url + "/v1",
    });
    await service.select(saved.profiles[1].id);
    const [model] = await service.models();
    const deltas: string[] = [];
    await expect(
      service.respond(
        { ...request, model: model.id },
        (value) => deltas.push(value),
        new AbortController().signal,
      ),
    ).resolves.toBe("Compatible fixture reply.");
    expect(deltas.join("")).toBe("Compatible fixture reply.");
    expect((await service.usage()).rateWindow?.requestsRemaining).toBe(47);
    const restarted = new ModelProviderService(dir, auth);
    expect((await restarted.list()).activeId).toBe(saved.profiles[1].id);
    expect((await restarted.usage()).observed.outputTokens).toBe(5);
    await service.select("chatgpt");
    await service.respond(request, () => {}, new AbortController().signal);
    expect(auth.respond).toHaveBeenCalledTimes(1);
  });
  it("never silently switches to the selected local provider for an old raw ChatGPT model", async () => {
    const fixture = await httpFixture(),
      auth = authAdapter(),
      service = new ModelProviderService(await directory(), auth);
    const saved = await service.saveProfile({
      label: "Local",
      kind: "ollama",
      baseUrl: fixture.url,
    });
    await service.select(saved.profiles[1].id);
    await expect(
      service.respond(request, () => {}, new AbortController().signal),
    ).rejects.toThrow("another provider");
    expect(auth.respond).not.toHaveBeenCalled();
    expect(fixture.calls).toHaveLength(0);
  });
  it("rejects unavailable effort or deleted provider model without issuing inference or fallback", async () => {
    const fixture = await httpFixture(),
      auth = authAdapter(),
      service = new ModelProviderService(await directory(), auth);
    const saved = await service.saveProfile({
      label: "Local",
      kind: "ollama",
      baseUrl: fixture.url,
    });
    await service.select(saved.profiles[1].id);
    const [model] = await service.models();
    await expect(
      service.respond(
        { ...request, model: model.id, reasoning: "xhigh" },
        () => {},
        new AbortController().signal,
      ),
    ).rejects.toThrow("not advertised");
    expect(fixture.calls).toHaveLength(1);
    await expect(service.remove(saved.profiles[1].id)).rejects.toThrow(
      "another active provider",
    );
    await service.select("chatgpt");
    await service.remove(saved.profiles[1].id);
    await expect(
      service.respond(
        { ...request, model: model.id },
        () => {},
        new AbortController().signal,
      ),
    ).rejects.toThrow("another provider");
    expect(auth.respond).not.toHaveBeenCalled();
  });
});

describe("explicit remote credentials and redirect safety", () => {
  it("passes only the configured key with redirect refusal, never OAuth credentials or library state", async () => {
    const seen: { url: string; init?: RequestInit }[] = [];
    const transport: typeof fetch = async (input, init) => {
      seen.push({ url: String(input), init });
      if (String(input).endsWith("/models"))
        return Response.json({ data: [{ id: "remote-fixture-model" }] });
      return fromBytes(
        'data: {"choices":[{"delta":{"content":"A configured remote fixture reply."},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',
      );
    };
    const auth = authAdapter(),
      service = new ModelProviderService(await directory(), auth, {
        fetch: transport,
      });
    const listing = await service.saveProfile({
      label: "Remote fixture",
      kind: "openai-compatible",
      baseUrl: "https://provider.example/v1",
      apiKey: "FAKE_CONFIGURED_KEY",
      externalConsent: true,
    });
    await service.select(listing.profiles[1].id);
    const [model] = await service.models();
    await service.respond(
      { ...request, model: model.id },
      () => {},
      new AbortController().signal,
    );
    expect(seen).toHaveLength(2);
    expect(
      seen.every(
        ({ init }) => init?.redirect === "error" && init.credentials === "omit",
      ),
    ).toBe(true);
    expect(
      seen.every(
        ({ init }) =>
          new Headers(init?.headers).get("Authorization") ===
          "Bearer FAKE_CONFIGURED_KEY",
      ),
    ).toBe(true);
    expect(auth.respond).not.toHaveBeenCalled();
    expect(JSON.stringify(await service.list())).not.toContain(
      "FAKE_CONFIGURED_KEY",
    );
  });
  it("does not follow even a local HTTP redirect carrying the configured key", async () => {
    let redirectedHits = 0;
    const target = createServer((_req, res) => {
      redirectedHits++;
      res.end("not reached");
    });
    await new Promise<void>((resolve) =>
      target.listen(0, "127.0.0.1", resolve),
    );
    servers.push(target);
    const redirect = createServer((_req, res) => {
      res.statusCode = 302;
      res.setHeader(
        "Location",
        `http://127.0.0.1:${(target.address() as { port: number }).port}/leak`,
      );
      res.end();
    });
    await new Promise<void>((resolve) =>
      redirect.listen(0, "127.0.0.1", resolve),
    );
    servers.push(redirect);
    const service = new ModelProviderService(await directory(), authAdapter());
    const listing = await service.saveProfile({
      label: "Redirect refusal fixture",
      kind: "openai-compatible",
      baseUrl: `http://127.0.0.1:${(redirect.address() as { port: number }).port}/v1`,
      apiKey: "FAKE_REDIRECT_KEY",
    });
    await service.select(listing.profiles[1].id);
    await expect(service.models()).rejects.toThrow();
    expect(redirectedHits).toBe(0);
  });
});

describe("provider stream safety and observed usage", () => {
  it("decodes CRLF SSE and fragmented Unicode, ignores private thinking, and reports actual numeric counts", async () => {
    const response = fromBytes(
      'data: {"choices":[{"delta":{"reasoning_content":"HIDDEN_THINKING","content":"RNA α"}}]}\r\n\r\ndata: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":4,"completion_tokens":6}}\r\n\r\ndata: [DONE]\r\n\r\n',
      "text/event-stream",
      1,
    );
    let usage: ProviderUsageSample | undefined;
    const deltas: string[] = [];
    expect(
      await consumeProviderStream(
        response,
        "openai-compatible",
        (text) => deltas.push(text),
        new AbortController().signal,
        (value) => {
          usage = value;
        },
      ),
    ).toBe("RNA α");
    expect(deltas.join("")).not.toContain("HIDDEN");
    expect(usage).toMatchObject({ inputTokens: 4, outputTokens: 6 });
  });
  it("requires terminal completion and retains already delivered text on errors", async () => {
    const deltas: string[] = [];
    await expect(
      consumeProviderStream(
        fromBytes(
          'data: {"choices":[{"delta":{"content":"Partial visible content"}}]}\n\n',
        ),
        "openai-compatible",
        (value) => deltas.push(value),
        new AbortController().signal,
      ),
    ).rejects.toThrow("before completion");
    expect(deltas.join("")).toBe("Partial visible content");
    await expect(
      consumeProviderStream(
        fromBytes(
          'data: {"choices":[{"delta":{"content":"Partial"},"finish_reason":"length"}]}\n\n',
        ),
        "openai-compatible",
        () => {},
        new AbortController().signal,
      ),
    ).rejects.toThrow("before completing");
  });
  it("finishes at the provider terminal event without waiting for a lingering HTTP connection", async () => {
    let canceled = false;
    const response = new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(
            new TextEncoder().encode(
              'data: {"choices":[{"delta":{"content":"A completed reply"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',
            ),
          );
        },
        cancel() {
          canceled = true;
        },
      }),
      { headers: { "Content-Type": "text/event-stream" } },
    );
    await expect(
      consumeProviderStream(
        response,
        "openai-compatible",
        () => {},
        new AbortController().signal,
      ),
    ).resolves.toBe("A completed reply");
    expect(canceled).toBe(true);
  });
  it("supports cancellation while a provider stalls and keeps the partial output", async () => {
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    const signal = new AbortController(),
      deltas: string[] = [];
    const response = new Response(
      new ReadableStream<Uint8Array>({
        start(value) {
          controller = value;
        },
      }),
    );
    const pending = consumeProviderStream(
      response,
      "ollama",
      (value) => {
        deltas.push(value);
        signal.abort();
      },
      signal.signal,
    );
    controller.enqueue(
      new TextEncoder().encode(
        '{"message":{"content":"Saved partial"},"done":false}\n',
      ),
    );
    await expect(pending).rejects.toThrow();
    expect(deltas).toEqual(["Saved partial"]);
  });
  it("extracts only numeric token usage from the existing subscription SSE without plan estimates", async () => {
    let sample: ProviderUsageSample | undefined;
    const response = fromBytes(
      'data: {"type":"response.output_text.delta","delta":"A valid response"}\n\ndata: {"type":"response.completed","response":{"usage":{"input_tokens":20,"output_tokens":12,"total_tokens":32,"PRIVATE_KEY":"secret"}}}\n\n',
    );
    await consumeResponseStream(
      response,
      () => {},
      new AbortController().signal,
      (value) => {
        sample = value;
      },
    );
    expect(sample).toMatchObject({
      inputTokens: 20,
      outputTokens: 12,
      totalTokens: 32,
    });
    expect(JSON.stringify(sample)).not.toContain("PRIVATE");
    expect(JSON.stringify(sample)).not.toContain("secret");
  });
});
