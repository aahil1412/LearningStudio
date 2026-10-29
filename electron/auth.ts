import type { ProviderUsageSample } from "../src/providerTypes";
import { safeStorage } from "electron";
import {
  createHash,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import { createServer, type Server } from "node:http";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { createRemoteJWKSet, jwtVerify, customFetch } from "jose";

export interface ModelInfo {
  id: string;
  name: string;
  reasoningLevels: string[];
}
export interface AuthStatus {
  connected: boolean;
  connecting?: boolean;
  account?: string;
  error?: string;
}
type Json = Record<string, unknown>;
interface Registration {
  clientId?: string;
  subject?: string;
  account?: string;
}
interface HostRegistration {
  hostId: string;
  registration?: Registration;
}
interface Credentials {
  clientId: string;
  subject: string;
  account: string;
  accessToken: string;
  refreshToken?: string;
  idToken: string;
  scopes: string[];
  expiresAt: number;
}
interface Discovery {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
  revocation_endpoint?: string;
}
const RESOURCE = "https://api.openai.com/v1";
const ISSUER = "https://auth.openai.com";
const SCOPES =
  "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct";
const PLAN_SCOPE = "chatgpt.tokens.use.direct";
const TERMINAL_REFRESH_ERRORS = new Set([
  "invalid_grant",
  "invalid_refresh_token",
  "token_expired",
  "refresh_token_expired",
  "refresh_token_invalidated",
  "refresh_token_reused",
]);
const REASONING_LEVELS = new Set([
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
  "ultra",
]);

function object(value: unknown): Json {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Json)
    : {};
}
function string(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
function random(): string {
  return randomBytes(32).toString("base64url");
}
function equal(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
function endpoint(value: unknown): string {
  const url = new URL(String(value));
  if (url.origin !== ISSUER || url.protocol !== "https:")
    throw new Error("OpenAI discovery returned an untrusted endpoint.");
  return url.href;
}
function abortSignal(signal?: AbortSignal, milliseconds = 30_000): AbortSignal {
  return signal
    ? AbortSignal.any([signal, AbortSignal.timeout(milliseconds)])
    : AbortSignal.timeout(milliseconds);
}
function errorCode(body: unknown): string | undefined {
  const raw = object(body);
  const err = object(raw.error);
  const code = string(err.code) ?? string(raw.error);
  return code && /^[a-zA-Z0-9_.-]{1,120}$/.test(code) ? code : undefined;
}
class ProviderError extends Error {
  constructor(
    public code: string | undefined,
    public statusCode: number,
    requestId?: string,
  ) {
    const explanation =
      code === "subscription_sharing_usage_limit_exceeded"
        ? "ChatGPT plan or app usage limit reached. Open Manage usage to review the applicable limit."
        : code === "subscription_sharing_user_not_eligible"
          ? "ChatGPT plan usage is unavailable for this account or workspace."
          : code === "subscription_sharing_unsupported_capability"
            ? "The selected account or model does not support this request capability."
            : "OpenAI could not complete this request. Your lesson is preserved; try again or reconnect if needed.";
    const safeId = requestId?.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 100);
    super(
      `${explanation} (HTTP ${statusCode}${code ? `; ${code}` : ""}${safeId ? `; request ${safeId}` : ""})`,
    );
    this.name = "ProviderError";
  }
}
async function jsonResponse(response: Response): Promise<Json> {
  let data: unknown;
  try {
    data = JSON.parse((await response.text()).slice(0, 2_000_000));
  } catch {
    data = {};
  }
  if (!response.ok)
    throw new ProviderError(
      errorCode(data),
      response.status,
      response.headers.get("x-request-id") ?? undefined,
    );
  return object(data);
}

/** Catalog choices are account-specific. An empty effort list means provider default. */
export function parseModelCatalog(value: unknown): ModelInfo[] {
  const models = object(value).models;
  if (!Array.isArray(models))
    throw new Error(
      "The ChatGPT model catalog was malformed. Refresh models or reconnect.",
    );
  return models.flatMap((item) => {
    const model = object(item);
    const id = string(model.slug);
    const name = string(model.display_name);
    if (model.visibility !== "list" || !id || !name) return [];
    const levels =
      model.supported_reasoning_levels ??
      model.supported_reasoning_efforts ??
      model.reasoning_levels;
    const reasoningLevels = Array.isArray(levels)
      ? [
          ...new Set(
            levels
              .map((level) =>
                typeof level === "string"
                  ? level
                  : (string(object(level).effort) ??
                    string(object(level).reasoning_effort)),
              )
              .filter(
                (level): level is string =>
                  !!level && REASONING_LEVELS.has(level),
              ),
          ),
        ]
      : [];
    return [{ id, name, reasoningLevels }];
  });
}

/** SSE is data, never executable code; deltas remain partial until a terminal success. */
export async function consumeResponseStream(
  response: Response,
  onDelta: (text: string) => void,
  signal: AbortSignal,
  onUsage?: (usage: ProviderUsageSample) => void,
): Promise<string> {
  if (!response.ok) {
    await jsonResponse(response);
    throw new Error("Request failed.");
  }
  if (!response.body)
    throw new Error(
      "OpenAI returned no response stream. Your lesson is preserved.",
    );
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
  let completed = false;
  let received = 0;
  const handle = (frame: string) => {
    const data = frame
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n");
    if (!data || data === "[DONE]") return;
    let event: Json;
    try {
      event = object(JSON.parse(data));
    } catch {
      throw new Error(
        "OpenAI sent a malformed streaming event. Partial text was preserved.",
      );
    }
    if (
      event.type === "response.output_text.delta" &&
      typeof event.delta === "string"
    ) {
      text += event.delta;
      onDelta(event.delta);
    } else if (event.type === "response.failed" || event.type === "error") {
      const inner = object(event.response);
      throw new ProviderError(
        errorCode(inner.error ? inner : { error: event }),
        502,
        response.headers.get("x-request-id") ?? undefined,
      );
    } else if (event.type === "response.incomplete") {
      throw new Error(
        "The model stopped before completing its response. Partial work is saved; retry when ready.",
      );
    } else if (event.type === "response.completed") {
      completed = true;
      if (onUsage) {
        const usage = object(object(event.response).usage);
        const numeric = (value: unknown) =>
          typeof value === "number" && Number.isSafeInteger(value) && value >= 0
            ? value
            : undefined;
        const header = (name: string) => {
          const value = response.headers.get(name);
          return value && /^\d{1,12}$/.test(value)
            ? numeric(Number(value))
            : undefined;
        };
        const reset = (name: string) => {
          const value = response.headers.get(name);
          return value && /^[\d.hms ]{1,60}$/.test(value) ? value : undefined;
        };
        try {
          onUsage({
            inputTokens: numeric(usage.input_tokens),
            outputTokens: numeric(usage.output_tokens),
            totalTokens: numeric(usage.total_tokens),
            rateWindow: {
              requestsRemaining: header("x-ratelimit-remaining-requests"),
              tokensRemaining: header("x-ratelimit-remaining-tokens"),
              requestsLimit: header("x-ratelimit-limit-requests"),
              tokensLimit: header("x-ratelimit-limit-tokens"),
              requestsReset: reset("x-ratelimit-reset-requests"),
              tokensReset: reset("x-ratelimit-reset-tokens"),
            },
          });
        } catch {
          /* Usage observation cannot interrupt an otherwise valid reply. */
        }
      }
      if (!text) {
        const output = object(event.response).output;
        if (Array.isArray(output))
          for (const item of output) {
            const content = object(item).content;
            if (Array.isArray(content))
              for (const part of content) {
                const fragment = object(part);
                if (
                  fragment.type === "output_text" &&
                  typeof fragment.text === "string"
                ) {
                  text += fragment.text;
                  onDelta(fragment.text);
                }
              }
          }
      }
    }
  };
  const abort = () => {
    void reader.cancel().catch(() => {});
  };
  signal.addEventListener("abort", abort, { once: true });
  try {
    while (true) {
      signal.throwIfAborted();
      const chunk = await reader.read();
      if (chunk.done) break;
      received += chunk.value.byteLength;
      if (received > 12_000_000)
        throw new Error(
          "The response exceeded the local size limit. Partial work is saved.",
        );
      buffer += decoder.decode(chunk.value, { stream: true });
      let match: RegExpExecArray | null;
      while ((match = /\r?\n\r?\n/.exec(buffer))) {
        handle(buffer.slice(0, match.index));
        buffer = buffer.slice(match.index + match[0].length);
      }
      if (buffer.length > 2_000_000)
        throw new Error("A streaming event exceeded the local size limit.");
    }
    signal.throwIfAborted();
    buffer += decoder.decode();
    if (buffer.trim()) handle(buffer);
    if (!completed)
      throw new Error(
        "The connection ended before the model completed. Partial work is saved; retry when ready.",
      );
    if (!text.trim())
      throw new Error(
        "The model completed without an explanation. Your session is preserved; try again.",
      );
    return text;
  } finally {
    signal.removeEventListener("abort", abort);
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export class AuthManager {
  private credentials?: Credentials;
  private host?: HostRegistration;
  private discovery?: Discovery;
  private loaded = false;
  private loadPromise?: Promise<void>;
  private refreshPromise?: Promise<string>;
  private connectController?: AbortController;
  private lastError?: string;
  private catalog: ModelInfo[] = [];
  private generation = 0;
  private activeRequests = new Set<AbortController>();
  constructor(
    private options: {
      credentialPath: string;
      openExternal: (url: string) => Promise<void>;
      fetch?: typeof globalThis.fetch;
    },
  ) {}

  private requestFetch(input: string | URL, options?: RequestInit) {
    return (this.options.fetch || fetch)(input, {
      ...options,
      credentials: "omit",
    });
  }
  private jwks(uri: string) {
    return createRemoteJWKSet(
      new URL(uri),
      this.options.fetch ? { [customFetch]: this.options.fetch } : undefined,
    );
  }

  private get registrationPath(): string {
    return `${this.options.credentialPath}.registration.json`;
  }
  private async atomicWrite(
    path: string,
    data: string | Buffer,
  ): Promise<void> {
    await mkdir(dirname(path), { recursive: true });
    const temporary = `${path}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, data, { mode: 0o600 });
      await rename(temporary, path);
    } finally {
      await rm(temporary, { force: true }).catch(() => {});
    }
  }
  private async saveHost(): Promise<void> {
    await this.atomicWrite(this.registrationPath, JSON.stringify(this.host));
  }
  private async saveCredentials(
    value: Credentials,
    expectedGeneration = this.generation,
  ): Promise<void> {
    if (expectedGeneration !== this.generation)
      throw new Error("The connection changed during this request.");
    if (!safeStorage.isEncryptionAvailable())
      throw new Error(
        "Windows credential encryption is unavailable. Sign-in is disabled until protected storage is available.",
      );
    await this.atomicWrite(
      this.options.credentialPath,
      safeStorage.encryptString(JSON.stringify(value)),
    );
    if (expectedGeneration !== this.generation) {
      await rm(this.options.credentialPath, { force: true });
      throw new Error("The connection was closed.");
    }
    this.credentials = value;
  }
  private async load(): Promise<void> {
    if (this.loaded) return;
    if (!this.loadPromise)
      this.loadPromise = this.loadStorage().finally(() => {
        this.loadPromise = undefined;
      });
    await this.loadPromise;
  }
  private async loadStorage(): Promise<void> {
    try {
      const value = JSON.parse(
        await readFile(this.registrationPath, "utf8"),
      ) as HostRegistration;
      if (
        typeof value.hostId === "string" &&
        /^urn:uuid:[a-f0-9-]{36}$/i.test(value.hostId)
      )
        this.host = value;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT")
        this.lastError =
          "The saved connection registration could not be read. Reconnect to recover.";
    }
    if (!this.host) {
      this.host = { hostId: `urn:uuid:${randomUUID()}` };
      await this.saveHost();
    }
    try {
      const encrypted = await readFile(this.options.credentialPath);
      if (!safeStorage.isEncryptionAvailable())
        throw new Error("Protected credential storage is unavailable.");
      const value = JSON.parse(
        safeStorage.decryptString(encrypted),
      ) as Credentials;
      if (
        !value.clientId ||
        !value.subject ||
        typeof value.accessToken !== "string" ||
        !value.idToken ||
        !Array.isArray(value.scopes) ||
        !Number.isFinite(value.expiresAt)
      )
        throw new Error("Invalid credential record.");
      this.credentials = value;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT")
        this.lastError =
          "Saved credentials could not be unlocked. Reconnect using protected Windows storage.";
    }
    this.loaded = true;
  }
  async status(): Promise<AuthStatus> {
    await this.load();
    return {
      connected:
        !!this.credentials?.accessToken &&
        this.credentials.scopes.includes(PLAN_SCOPE),
      connecting: !!this.connectController,
      account: this.credentials?.account ?? this.host?.registration?.account,
      error:
        this.lastError ??
        (this.credentials && !this.credentials.scopes.includes(PLAN_SCOPE)
          ? "Identity connected. ChatGPT plan usage was not granted; reconnect to enable it."
          : undefined),
    };
  }
  private async discover(): Promise<Discovery> {
    if (!this.discovery) {
      const raw = await jsonResponse(
        await this.requestFetch(`${ISSUER}/.well-known/openid-configuration`, {
          signal: abortSignal(),
          redirect: "error",
        }),
      );
      if (raw.issuer !== ISSUER)
        throw new Error("OpenAI discovery issuer did not match.");
      this.discovery = {
        issuer: ISSUER,
        authorization_endpoint: endpoint(raw.authorization_endpoint),
        token_endpoint: endpoint(raw.token_endpoint),
        jwks_uri: endpoint(raw.jwks_uri),
        revocation_endpoint: raw.revocation_endpoint
          ? endpoint(raw.revocation_endpoint)
          : undefined,
      };
    }
    return this.discovery;
  }
  async connect(): Promise<AuthStatus> {
    await this.load();
    if (this.connectController)
      throw new Error(
        "A ChatGPT sign-in is already in progress. Finish it in your browser.",
      );
    if (!safeStorage.isEncryptionAvailable())
      throw new Error(
        "Windows credential encryption is unavailable; credentials will not be stored in plaintext.",
      );
    const controller = new AbortController();
    this.connectController = controller;
    const attemptGeneration = this.generation;
    const timeout = setTimeout(
      () =>
        controller.abort(
          new Error("Sign-in timed out. Start again when ready."),
        ),
      5 * 60_000,
    );
    let server: Server | undefined;
    try {
      const discovery = await this.discover();
      controller.signal.throwIfAborted();
      const verifier = random();
      const state = random();
      const nonce = random();
      const selected = this.host!.registration;
      const issued = selected?.clientId;
      let consumed = false;
      let resolveCallback!: (url: URL) => void;
      let rejectCallback!: (error: Error) => void;
      const callback = new Promise<URL>((resolve, reject) => {
        resolveCallback = resolve;
        rejectCallback = reject;
      });
      // Attach a rejection observer before browser launch so immediate abort is handled.
      void callback.catch(() => {});
      server = createServer((req, res) => {
        const url = new URL(req.url ?? "/", "http://127.0.0.1");
        if (req.method !== "GET" || url.pathname !== "/auth/callback") {
          res.writeHead(404);
          res.end();
          return;
        }
        if (!equal(url.searchParams.get("state") ?? "", state) || consumed) {
          res.writeHead(400);
          res.end("Invalid or expired sign-in attempt.");
          return;
        }
        consumed = true;
        res.writeHead(200, {
          "Content-Type": "text/plain; charset=utf-8",
          "Cache-Control": "no-store",
          "Content-Security-Policy": "default-src 'none'",
          "X-Content-Type-Options": "nosniff",
        });
        res.end(
          "Authorization received. Return to Learning Studio to see the connection result.",
        );
        resolveCallback(url);
      });
      await new Promise<void>((resolve, reject) => {
        server!.once("error", reject);
        server!.listen(0, "127.0.0.1", () => resolve());
      });
      const address = server.address();
      if (!address || typeof address === "string")
        throw new Error("Could not start the local sign-in callback.");
      const redirectUri = `http://127.0.0.1:${address.port}/auth/callback`;
      const authorize = new URL(discovery.authorization_endpoint);
      const params: Record<string, string> = {
        client_id: issued ?? "dynamic_agent_client",
        ext_agent_host_id: this.host!.hostId,
        response_type: "code",
        redirect_uri: redirectUri,
        scope: SCOPES,
        resource: RESOURCE,
        state,
        nonce,
        code_challenge_method: "S256",
        code_challenge: createHash("sha256")
          .update(verifier)
          .digest("base64url"),
      };
      if (!issued) params.agent_name_hint = "Learning Studio";
      else if (this.credentials?.idToken)
        params.id_token_hint = this.credentials.idToken;
      for (const [key, value] of Object.entries(params))
        authorize.searchParams.set(key, value);
      const onAbort = () =>
        rejectCallback(
          new Error("ChatGPT sign-in was cancelled or timed out."),
        );
      controller.signal.addEventListener("abort", onAbort, { once: true });
      if (controller.signal.aborted) onAbort();
      await this.options.openExternal(authorize.href);
      let result: URL;
      try {
        result = await callback;
      } finally {
        controller.signal.removeEventListener("abort", onAbort);
      }
      controller.signal.throwIfAborted();
      if (result.searchParams.has("error"))
        throw new Error(
          "ChatGPT authorization was declined or could not complete. You can try again.",
        );
      const clientId = result.searchParams.get("client_id") ?? issued;
      if (
        !clientId ||
        clientId === "dynamic_agent_client" ||
        (issued && clientId !== issued)
      )
        throw new Error(
          "The OAuth callback did not match the registered client.",
        );
      const code = result.searchParams.get("code");
      if (!code)
        throw new Error(
          "OpenAI returned no authorization code. Try signing in again.",
        );
      this.host!.registration = { ...selected, clientId };
      await this.saveHost();
      const tokens = await jsonResponse(
        await this.requestFetch(discovery.token_endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          signal: abortSignal(controller.signal),
          redirect: "error",
          body: new URLSearchParams({
            grant_type: "authorization_code",
            client_id: clientId,
            code,
            code_verifier: verifier,
            redirect_uri: redirectUri,
            resource: RESOURCE,
          }),
        }),
      );
      const idToken = string(tokens.id_token);
      if (!idToken)
        throw new Error(
          "The token response did not contain identity verification.",
        );
      const { payload } = await jwtVerify(
        idToken,
        this.jwks(discovery.jwks_uri),
        {
          issuer: discovery.issuer,
          audience: clientId,
          requiredClaims: ["sub", "exp", "iat"],
          clockTolerance: 5,
        },
      );
      if (!equal(String(payload.nonce ?? ""), nonce) || !payload.sub)
        throw new Error("OpenAI identity nonce did not match this sign-in.");
      if (selected?.subject && selected.subject !== payload.sub)
        throw new Error(
          "This sign-in belongs to a different account than the saved registration.",
        );
      const accessToken = string(tokens.access_token) ?? "";
      const grantedScopes = String(tokens.scope ?? "")
        .split(/\s+/)
        .filter(Boolean);
      if (grantedScopes.includes(PLAN_SCOPE) && !accessToken)
        throw new Error(
          "OpenAI granted plan usage but did not issue its required access token. Reconnect to recover.",
        );
      const account =
        string(payload.email) ?? string(payload.name) ?? "ChatGPT account";
      const value: Credentials = {
        clientId,
        subject: payload.sub,
        account,
        accessToken,
        refreshToken: string(tokens.refresh_token),
        idToken,
        scopes: grantedScopes,
        expiresAt: Date.now() + (Number(tokens.expires_in) || 3600) * 1000,
      };
      await this.saveCredentials(value, attemptGeneration);
      this.host!.registration = { clientId, subject: payload.sub, account };
      await this.saveHost();
      this.catalog = [];
      this.lastError = undefined;
    } catch (error) {
      this.lastError =
        error instanceof ProviderError
          ? error.message
          : error instanceof Error &&
              !/jwt|token|signature|nonce|claim/i.test(error.message) &&
              !/JWT|JOSE|JWKS|JWS/.test(error.name)
            ? error.message
            : "ChatGPT identity could not be verified. Please reconnect.";
      throw new Error(this.lastError);
    } finally {
      clearTimeout(timeout);
      server?.close();
      server?.closeAllConnections();
      this.connectController = undefined;
    }
    return this.status();
  }
  async disconnect(): Promise<void> {
    await this.load();
    this.generation++;
    this.connectController?.abort();
    for (const controller of this.activeRequests) controller.abort();
    const credentials = this.credentials;
    this.credentials = undefined;
    this.catalog = [];
    this.lastError = undefined;
    try {
      if (credentials?.refreshToken) {
        const discovery = await this.discover();
        if (!discovery.revocation_endpoint)
          throw new Error("No revocation endpoint.");
        const response = await this.requestFetch(
          discovery.revocation_endpoint,
          {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            signal: abortSignal(undefined, 10_000),
            redirect: "error",
            body: new URLSearchParams({
              token: credentials.refreshToken,
              token_type_hint: "refresh_token",
              client_id: credentials.clientId,
            }),
          },
        );
        if (!response.ok)
          throw new Error("Remote revocation did not complete.");
      }
    } catch {
      this.lastError =
        "Disconnected locally. Remote revocation was not confirmed; you can also disconnect this app in ChatGPT settings.";
    } finally {
      await rm(this.options.credentialPath, { force: true });
    }
  }
  private async accessToken(): Promise<string> {
    await this.load();
    const value = this.credentials;
    if (!value)
      throw new Error("Connect ChatGPT in Settings to request an AI lesson.");
    if (!value.scopes.includes(PLAN_SCOPE))
      throw new Error(
        "ChatGPT plan usage is not enabled. Reconnect and grant plan usage.",
      );
    if (value.expiresAt > Date.now() + 60_000) return value.accessToken;
    if (!this.refreshPromise)
      this.refreshPromise = this.refresh(value).finally(() => {
        this.refreshPromise = undefined;
      });
    return this.refreshPromise;
  }
  private async refresh(value: Credentials): Promise<string> {
    if (!value.refreshToken)
      throw new Error("Your ChatGPT session expired. Reconnect to continue.");
    const generation = this.generation;
    try {
      const discovery = await this.discover();
      const tokens = await jsonResponse(
        await this.requestFetch(discovery.token_endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          signal: abortSignal(),
          redirect: "error",
          body: new URLSearchParams({
            grant_type: "refresh_token",
            client_id: value.clientId,
            refresh_token: value.refreshToken,
            resource: RESOURCE,
          }),
        }),
      );
      const accessToken = string(tokens.access_token);
      if (!accessToken)
        throw new Error(
          "OpenAI token renewal returned no access token. Reconnect to recover.",
        );
      let idToken = value.idToken;
      if (string(tokens.id_token)) {
        const refreshedIdentity = await jwtVerify(
          String(tokens.id_token),
          this.jwks(discovery.jwks_uri),
          {
            issuer: discovery.issuer,
            audience: value.clientId,
            requiredClaims: ["sub", "exp", "iat"],
            clockTolerance: 5,
          },
        );
        if (refreshedIdentity.payload.sub !== value.subject)
          throw new Error(
            "The refreshed identity did not match the connected account. Reconnect to recover.",
          );
        idToken = String(tokens.id_token);
      }
      const next: Credentials = {
        ...value,
        accessToken,
        refreshToken: string(tokens.refresh_token) ?? value.refreshToken,
        idToken,
        scopes: tokens.scope
          ? String(tokens.scope).split(/\s+/).filter(Boolean)
          : value.scopes,
        expiresAt: Date.now() + (Number(tokens.expires_in) || 3600) * 1000,
      };
      await this.saveCredentials(next, generation);
      if (!next.scopes.includes(PLAN_SCOPE))
        throw new Error(
          "ChatGPT plan usage is no longer granted. Reconnect to enable it.",
        );
      return accessToken;
    } catch (error) {
      if (
        error instanceof ProviderError &&
        error.code &&
        TERMINAL_REFRESH_ERRORS.has(error.code) &&
        generation === this.generation
      ) {
        this.credentials = undefined;
        await rm(this.options.credentialPath, { force: true });
        this.lastError =
          "Your ChatGPT session is no longer valid. Reconnect to continue.";
        throw new Error(this.lastError);
      }
      throw error;
    }
  }
  async models(): Promise<ModelInfo[]> {
    const token = await this.accessToken();
    const data = await jsonResponse(
      await this.requestFetch(`${RESOURCE}/models`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: abortSignal(),
        redirect: "error",
      }),
    );
    this.catalog = parseModelCatalog(data);
    return this.catalog;
  }
  async respond(
    request: {
      model: string;
      reasoning?: string;
      instructions: string;
      input: Array<{ role: "user" | "assistant"; content: string }>;
    },
    onDelta: (text: string) => void,
    signal: AbortSignal,
    onUsage?: (usage: ProviderUsageSample) => void,
  ): Promise<string> {
    const requestController = new AbortController();
    this.activeRequests.add(requestController);
    const combined = AbortSignal.any([
      signal,
      requestController.signal,
      AbortSignal.timeout(15 * 60_000),
    ]);
    try {
      combined.throwIfAborted();
      const token = await this.accessToken();
      const models = this.catalog.length ? this.catalog : await this.models();
      const model = models.find((item) => item.id === request.model);
      if (!model)
        throw new Error(
          "This model is not in your current account catalog. Refresh models in Settings.",
        );
      if (
        request.reasoning &&
        !model.reasoningLevels.includes(request.reasoning)
      )
        throw new Error(
          "This reasoning level is not advertised by your selected model. Choose Provider default or refresh models.",
        );
      if (
        !Array.isArray(request.input) ||
        request.input.some(
          (item) =>
            !["user", "assistant"].includes(item.role) ||
            typeof item.content !== "string",
        )
      )
        throw new Error("The lesson history could not be sent safely.");
      combined.throwIfAborted();
      const response = await this.requestFetch(`${RESOURCE}/responses`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        signal: combined,
        redirect: "error",
        body: JSON.stringify({
          model: model.id,
          instructions: request.instructions,
          input: request.input,
          store: false,
          stream: true,
          ...(request.reasoning
            ? { reasoning: { effort: request.reasoning } }
            : {}),
        }),
      });
      return await consumeResponseStream(response, onDelta, combined, onUsage);
    } finally {
      this.activeRequests.delete(requestController);
    }
  }
}
