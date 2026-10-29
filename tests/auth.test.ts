import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
const verification = vi.hoisted(() => ({ jwks: undefined as unknown }));
vi.mock("jose", async (importOriginal) => {
  const original = await importOriginal<typeof import("jose")>();
  return {
    ...original,
    createRemoteJWKSet: vi.fn(() =>
      original.createLocalJWKSet(
        verification.jwks as Parameters<typeof original.createLocalJWKSet>[0],
      ),
    ),
  };
});
import { exportJWK, generateKeyPair, SignJWT } from "jose";
vi.mock("electron", () => ({
  safeStorage: {
    isEncryptionAvailable: vi.fn(() => true),
    encryptString: vi.fn((value: string) => Buffer.from(`protected:${value}`)),
    decryptString: vi.fn((value: Buffer) => {
      if (!value.toString().startsWith("protected:"))
        throw new Error("Not encrypted");
      return value.toString().slice(10);
    }),
  },
}));
import { safeStorage } from "electron";
import {
  AuthManager,
  consumeResponseStream,
  parseModelCatalog,
} from "../electron/auth";

const temporary: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  await Promise.all(
    temporary
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});
function sse(events: unknown[], chunkSize = 17): Response {
  const encoded = new TextEncoder().encode(
    events.map((event) => `data: ${JSON.stringify(event)}\r\n\r\n`).join(""),
  );
  return new Response(
    new ReadableStream({
      start(controller) {
        for (let i = 0; i < encoded.length; i += chunkSize)
          controller.enqueue(encoded.slice(i, i + chunkSize));
        controller.close();
      },
    }),
    { headers: { "Content-Type": "text/event-stream" } },
  );
}
async function pathForCredentials(): Promise<string> {
  const dir = await mkdtemp(join(process.cwd(), ".auth-test-"));
  temporary.push(dir);
  return join(dir, "auth.enc");
}
describe("subscription catalog and streaming contract", () => {
  it("keeps account catalog order and only exposes advertised reasoning support", () => {
    expect(
      parseModelCatalog({
        models: [
          {
            slug: "a",
            display_name: "A",
            visibility: "list",
            supported_reasoning_levels: [{ effort: "low" }, { effort: "high" }],
          },
          { slug: "b", display_name: "B", visibility: "hidden" },
          { slug: "c", display_name: "C", visibility: "list" },
        ],
      }),
    ).toEqual([
      { id: "a", name: "A", reasoningLevels: ["low", "high"] },
      { id: "c", name: "C", reasoningLevels: [] },
    ]);
    expect(() => parseModelCatalog({ data: [] })).toThrow("malformed");
  });
  it("parses split UTF-8 SSE frames and waits for completed inference", async () => {
    const deltas: string[] = [];
    const result = await consumeResponseStream(
      sse(
        [
          { type: "response.output_text.delta", delta: "A rigorous " },
          { type: "response.output_text.delta", delta: "∫ explanation." },
          { type: "response.completed", response: {} },
        ],
        1,
      ),
      (delta) => deltas.push(delta),
      new AbortController().signal,
    );
    expect(result).toBe("A rigorous ∫ explanation.");
    expect(deltas).toHaveLength(2);
  });
  it("does not report streamed partial output as success after a late provider failure", async () => {
    const deltas: string[] = [];
    await expect(
      consumeResponseStream(
        sse([
          { type: "response.output_text.delta", delta: "Partial lesson" },
          {
            type: "response.failed",
            response: {
              error: { code: "subscription_sharing_usage_limit_exceeded" },
            },
          },
        ]),
        (delta) => deltas.push(delta),
        new AbortController().signal,
      ),
    ).rejects.toThrow("usage limit");
    expect(deltas.join("")).toBe("Partial lesson");
  });
  it("rejects interrupted, malformed and empty streams without losing earlier deltas", async () => {
    await expect(
      consumeResponseStream(
        sse([{ type: "response.output_text.delta", delta: "partial" }]),
        () => {},
        new AbortController().signal,
      ),
    ).rejects.toThrow("before the model completed");
    await expect(
      consumeResponseStream(
        new Response("data: broken\n\n"),
        () => {},
        new AbortController().signal,
      ),
    ).rejects.toThrow("malformed");
    await expect(
      consumeResponseStream(
        sse([{ type: "response.completed" }]),
        () => {},
        new AbortController().signal,
      ),
    ).rejects.toThrow("without an explanation");
  });
  it("preserves abort semantics", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      consumeResponseStream(sse([]), () => {}, controller.signal),
    ).rejects.toThrow();
  });
});

describe("protected connection persistence", () => {
  it("persists a stable host across application restarts without creating a connected account", async () => {
    const path = await pathForCredentials();
    expect(
      (
        await new AuthManager({
          credentialPath: path,
          openExternal: async () => {},
        }).status()
      ).connected,
    ).toBe(false);
    const first = JSON.parse(
      await readFile(`${path}.registration.json`, "utf8"),
    );
    await new AuthManager({
      credentialPath: path,
      openExternal: async () => {},
    }).status();
    expect(
      JSON.parse(await readFile(`${path}.registration.json`, "utf8")).hostId,
    ).toBe(first.hostId);
  });
  it("fails closed when Windows encryption is unavailable", async () => {
    const path = await pathForCredentials();
    vi.mocked(safeStorage.isEncryptionAvailable).mockReturnValueOnce(false);
    await expect(
      new AuthManager({
        credentialPath: path,
        openExternal: async () => {},
      }).connect(),
    ).rejects.toThrow("encryption");
  });
  it("serializes rotating refreshes and rediscovers models with the same protected account", async () => {
    const path = await pathForCredentials();
    await writeFile(
      path,
      safeStorage.encryptString(
        JSON.stringify({
          clientId: "test-client",
          subject: "test-sub",
          account: "Synthetic account",
          accessToken: "expired-synthetic",
          refreshToken: "synthetic-refresh",
          idToken: "synthetic-id",
          scopes: ["chatgpt.tokens.use.direct"],
          expiresAt: 1,
        }),
      ),
    );
    let refreshes = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        if (url.includes("openid-configuration"))
          return Response.json({
            issuer: "https://auth.openai.com",
            authorization_endpoint:
              "https://auth.openai.com/api/accounts/authorize",
            token_endpoint: "https://auth.openai.com/api/accounts/oauth/token",
            jwks_uri: "https://auth.openai.com/.well-known/jwks.json",
          });
        if (url.includes("oauth/token")) {
          refreshes++;
          return Response.json({
            access_token: "renewed-synthetic",
            refresh_token: "rotated-synthetic",
            expires_in: 3600,
          });
        }
        return Response.json({
          models: [
            {
              slug: "available-model",
              display_name: "Available model",
              visibility: "list",
            },
          ],
        });
      }),
    );
    const auth = new AuthManager({
      credentialPath: path,
      openExternal: async () => {},
    });
    const catalogs = await Promise.all([auth.models(), auth.models()]);
    expect(refreshes).toBe(1);
    expect(catalogs[0][0].id).toBe("available-model");
    const saved = JSON.parse(safeStorage.decryptString(await readFile(path)));
    expect(saved.refreshToken).toBe("rotated-synthetic");
    expect(
      (
        await new AuthManager({
          credentialPath: path,
          openExternal: async () => {},
        }).status()
      ).connected,
    ).toBe(true);
    await expect(
      auth.respond(
        {
          model: "available-model",
          reasoning: "high",
          instructions: "Teach",
          input: [{ role: "user", content: "Explain" }],
        },
        () => {},
        new AbortController().signal,
      ),
    ).rejects.toThrow("not advertised");
  });
});

describe("public OAuth callback and identity validation", () => {
  const localFetch = globalThis.fetch;
  let signingKey: CryptoKey;
  beforeAll(async () => {
    const pair = await generateKeyPair("RS256");
    signingKey = pair.privateKey;
    verification.jwks = {
      keys: [
        {
          ...(await exportJWK(pair.publicKey)),
          kid: "synthetic-test-key",
          alg: "RS256",
        },
      ],
    };
  });
  async function connectFixture(
    options: {
      issuer?: string;
      audience?: string;
      wrongNonce?: boolean;
      scope?: string;
      invalidStateFirst?: boolean;
    } = {},
  ) {
    const path = await pathForCredentials();
    let nonce = "";
    let tokenExchanges = 0;
    let invalidStatus = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        if (url.includes("openid-configuration"))
          return Response.json({
            issuer: "https://auth.openai.com",
            authorization_endpoint:
              "https://auth.openai.com/api/accounts/authorize",
            token_endpoint: "https://auth.openai.com/api/accounts/oauth/token",
            jwks_uri: "https://auth.openai.com/.well-known/jwks.json",
          });
        if (!url.includes("/oauth/token"))
          throw new Error("Unexpected outbound OAuth endpoint");
        tokenExchanges++;
        const idToken = await new SignJWT({
          nonce: options.wrongNonce ? "wrong-nonce" : nonce,
          email: "synthetic@example.invalid",
        })
          .setProtectedHeader({ alg: "RS256", kid: "synthetic-test-key" })
          .setIssuer(options.issuer ?? "https://auth.openai.com")
          .setAudience(options.audience ?? "issued-synthetic-client")
          .setSubject("synthetic-learner")
          .setIssuedAt()
          .setExpirationTime("5m")
          .sign(signingKey);
        return Response.json({
          id_token: idToken,
          access_token: "synthetic-access",
          refresh_token: "synthetic-refresh",
          scope:
            options.scope ?? "openid profile email chatgpt.tokens.use.direct",
          expires_in: 3600,
        });
      }),
    );
    const auth = new AuthManager({
      credentialPath: path,
      openExternal: async (url) => {
        const authorize = new URL(url);
        nonce = authorize.searchParams.get("nonce")!;
        expect(authorize.origin).toBe("https://auth.openai.com");
        expect(authorize.searchParams.get("client_id")).toBe(
          "dynamic_agent_client",
        );
        expect(authorize.searchParams.get("code_challenge_method")).toBe(
          "S256",
        );
        const callback = new URL(authorize.searchParams.get("redirect_uri")!);
        expect(callback.hostname).toBe("127.0.0.1");
        expect(callback.pathname).toBe("/auth/callback");
        callback.searchParams.set("state", "incorrect-state");
        callback.searchParams.set("client_id", "issued-synthetic-client");
        callback.searchParams.set("code", "synthetic-code");
        if (options.invalidStateFirst) {
          invalidStatus = (await localFetch(callback)).status;
          expect(tokenExchanges).toBe(0);
        }
        callback.searchParams.set(
          "state",
          authorize.searchParams.get("state")!,
        );
        expect((await localFetch(callback)).status).toBe(200);
      },
    });
    return { auth, path, counts: () => ({ tokenExchanges, invalidStatus }) };
  }
  it("rejects an invalid state without consuming the valid callback, then verifies a real signed JWT", async () => {
    const fixture = await connectFixture({ invalidStateFirst: true });
    expect(await fixture.auth.connect()).toMatchObject({
      connected: true,
      account: "synthetic@example.invalid",
    });
    expect(fixture.counts()).toEqual({ tokenExchanges: 1, invalidStatus: 400 });
    expect(
      (await readFile(fixture.path)).toString().startsWith("protected:"),
    ).toBe(true);
  });
  it.each([
    { issuer: "https://untrusted.invalid" },
    { audience: "other-client" },
    { wrongNonce: true },
  ])(
    "rejects mismatched issuer, audience or nonce before saving credentials (%j)",
    async (options) => {
      const fixture = await connectFixture(options);
      await expect(fixture.auth.connect()).rejects.toThrow(
        "could not be verified",
      );
      expect((await fixture.auth.status()).connected).toBe(false);
      await expect(readFile(fixture.path)).rejects.toMatchObject({
        code: "ENOENT",
      });
    },
  );
  it("retains validated identity without enabling inference when plan scope was not granted", async () => {
    const fixture = await connectFixture({ scope: "openid profile email" });
    expect(await fixture.auth.connect()).toMatchObject({
      connected: false,
      account: "synthetic@example.invalid",
      error: expect.stringContaining("not granted"),
    });
    await expect(fixture.auth.models()).rejects.toThrow("not enabled");
  });
});
