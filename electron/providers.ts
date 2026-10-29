import { safeStorage } from "electron";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import type { AuthProfiles } from "./profiles";
import type { ModelInfo, AuthStatus } from "../src/types";
import type {
  ModelProviderProfile,
  ProviderListing,
  ProviderSave,
  ProviderUsage,
  ProviderUsageSample,
} from "../src/providerTypes";

const PROFILE = z.object({
  id: z.string().regex(/^[\w-]{1,80}$/),
  label: z.string().trim().min(1).max(80),
  kind: z.enum(["ollama", "openai-compatible"]),
  baseUrl: z.string().min(1).max(500),
  externalConsent: z.boolean(),
});
const SAVE = PROFILE.omit({ id: true, externalConsent: true }).extend({
  id: z
    .string()
    .regex(/^[\w-]{1,80}$/)
    .optional(),
  apiKey: z.string().max(16384).optional(),
  clearKey: z.boolean().optional(),
  externalConsent: z.boolean().optional(),
});
const INDEX = z.object({
  version: z.literal(1),
  activeId: z.string().max(80),
  profiles: z.array(PROFILE).max(20),
});
const CHATGPT: ModelProviderProfile = {
  id: "chatgpt",
  label: "ChatGPT subscription",
  kind: "chatgpt",
  hasKey: false,
  externalConsent: false,
};
const MANAGE_USAGE = "https://chatgpt.com/settings/usage";
type Request = Parameters<AuthProfiles["respond"]>[0];
type AuthAdapter = Pick<AuthProfiles, "status" | "models" | "respond">;
type SavedProfile = z.infer<typeof PROFILE>;
type Observation = ProviderUsage["observed"] & {
  rateWindow?: ProviderUsage["rateWindow"];
  lastLimit?: ProviderUsage["lastLimit"];
};
const obj = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const numeric = (value: unknown) =>
  typeof value === "number" &&
  Number.isSafeInteger(value) &&
  value >= 0 &&
  value < 1e13
    ? value
    : undefined;
const safeCode = (value: unknown) =>
  typeof value === "string" && /^[\w.-]{1,120}$/.test(value)
    ? value
    : undefined;
export function providerEndpoint(input: string, kind: ProviderSave["kind"]) {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw new Error("Enter a complete provider URL.");
  }
  const loopback =
    url.hostname === "localhost" ||
    url.hostname === "[::1]" ||
    /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(url.hostname);
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !["http:", "https:"].includes(url.protocol)
  )
    throw new Error(
      "Use a provider URL without credentials, query parameters, or fragments.",
    );
  if (kind === "ollama" && !loopback)
    throw new Error(
      "Local Ollama connections must use localhost or a loopback address.",
    );
  if (url.protocol !== "https:" && !loopback)
    throw new Error(
      "Remote providers require HTTPS. HTTP is supported only on loopback.",
    );
  url.pathname = url.pathname.replace(/\/+$/, "");
  return { url: url.href.replace(/\/+$/, ""), loopback };
}
export function providerModelId(profileId: string, raw: string) {
  return `provider:${profileId}:${raw}`;
}
function decodeModel(id: string) {
  const match = /^provider:([\w-]{1,80}):(.{1,140})$/.exec(id);
  if (!match && id.startsWith("provider:"))
    throw new Error(
      "This provider model identifier is invalid. Refresh models.",
    );
  return match ? { profileId: match[1], model: match[2] } : null;
}
const newObservation = (): Observation => ({
  since: new Date().toISOString(),
  completedRequests: 0,
  failedRequests: 0,
  tokenReportedRequests: 0,
  inputTokens: 0,
  outputTokens: 0,
});
class ProviderRequestError extends Error {
  constructor(
    public statusCode: number,
    public code?: string,
  ) {
    super(
      `The configured provider could not complete the request (HTTP ${statusCode}${code ? `; ${code}` : ""}). Your lesson is preserved.`,
    );
  }
}
async function bodyObject(response: Response) {
  const text = await response.text();
  if (text.length > 2_000_000)
    throw new Error("Provider metadata exceeded the supported size.");
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    if (response.ok)
      throw new Error("The provider returned malformed metadata.");
    data = {};
  }
  if (!response.ok)
    throw new ProviderRequestError(
      response.status,
      safeCode(obj(obj(data).error).code),
    );
  return obj(data);
}
function responseRates(response: Response): ProviderUsageSample["rateWindow"] {
  const get = (key: string) => {
    const value = response.headers.get(key);
    return value && /^\d{1,12}$/.test(value)
      ? numeric(Number(value))
      : undefined;
  };
  const reset = (key: string) => {
    const value = response.headers.get(key);
    return value && /^[\d.hms ]{1,60}$/.test(value) ? value : undefined;
  };
  return {
    requestsRemaining: get("x-ratelimit-remaining-requests"),
    tokensRemaining: get("x-ratelimit-remaining-tokens"),
    requestsLimit: get("x-ratelimit-limit-requests"),
    tokensLimit: get("x-ratelimit-limit-tokens"),
    requestsReset: reset("x-ratelimit-reset-requests"),
    tokensReset: reset("x-ratelimit-reset-tokens"),
  };
}
/** Trusted parsers consume transport data only; private thinking fields are ignored. */
export async function consumeProviderStream(
  response: Response,
  kind: ProviderSave["kind"],
  onDelta: (text: string) => void,
  signal: AbortSignal,
  onUsage?: (usage: ProviderUsageSample) => void,
): Promise<string> {
  if (!response.ok) {
    await bodyObject(response);
    throw new Error("Provider request failed.");
  }
  if (!response.body)
    throw new Error("The provider returned no response body.");
  const reader = response.body.getReader(),
    decoder = new TextDecoder();
  let buffer = "",
    text = "",
    received = 0,
    complete = false,
    terminal = false,
    usage: ProviderUsageSample = { rateWindow: responseRates(response) };
  const add = (value: unknown) => {
    if (typeof value === "string") {
      text += value;
      onDelta(value);
    }
  };
  const handle = (raw: string) => {
    if (terminal || !raw.trim()) return;
    if (kind === "openai-compatible" && raw.trim() === "[DONE]") {
      complete = true;
      terminal = true;
      return;
    }
    let value: unknown;
    try {
      value = JSON.parse(raw);
    } catch {
      throw new Error(
        "The provider sent malformed streaming data. Partial work is preserved.",
      );
    }
    const event = obj(value);
    if (event.error)
      throw new ProviderRequestError(502, safeCode(obj(event.error).code));
    if (kind === "ollama") {
      add(obj(event.message).content);
      if (event.done === true) {
        if (
          event.done_reason &&
          !["stop", "eos"].includes(String(event.done_reason))
        )
          throw new Error(
            "The local model stopped before completing. Partial work is preserved.",
          );
        complete = true;
        terminal = true;
        usage = {
          ...usage,
          inputTokens: numeric(event.prompt_eval_count),
          outputTokens: numeric(event.eval_count),
        };
      }
    } else {
      const choices = Array.isArray(event.choices) ? event.choices : [];
      for (const value of choices) {
        const choice = obj(value);
        add(obj(choice.delta).content ?? obj(choice.message).content);
        if (choice.finish_reason) {
          if (choice.finish_reason !== "stop")
            throw new Error(
              "The configured model stopped before completing. Partial work is preserved.",
            );
          complete = true;
        }
      }
      const counts = obj(event.usage);
      if (Object.keys(counts).length)
        usage = {
          ...usage,
          inputTokens: numeric(counts.prompt_tokens),
          outputTokens: numeric(counts.completion_tokens),
          totalTokens: numeric(counts.total_tokens),
        };
    }
  };
  const abort = () => {
    void reader.cancel().catch(() => {});
  };
  signal.addEventListener("abort", abort, { once: true });
  try {
    const jsonResponse =
      response.headers.get("content-type")?.includes("application/json") &&
      kind === "openai-compatible";
    while (true) {
      signal.throwIfAborted();
      const chunk = await reader.read();
      if (chunk.done) break;
      received += chunk.value.byteLength;
      if (received > 12_000_000)
        throw new Error(
          "The provider response exceeded the supported size. Partial work is preserved.",
        );
      buffer += decoder.decode(chunk.value, { stream: true });
      if (!jsonResponse) {
        let match: RegExpExecArray | null;
        while (
          (match = (kind === "ollama" ? /\r?\n/ : /\r?\n\r?\n/).exec(buffer))
        ) {
          const frame = buffer.slice(0, match.index).replace(/\r/g, "");
          buffer = buffer.slice(match.index + match[0].length);
          if (kind === "ollama") handle(frame);
          else {
            const raw = frame
              .split("\n")
              .filter((line) => line.startsWith("data:"))
              .map((line) => line.slice(5).trimStart())
              .join("\n");
            if (raw) handle(raw);
          }
        }
      }
      if (buffer.length > 2_000_000)
        throw new Error(
          "A provider streaming event exceeded the supported size.",
        );
      if (terminal) break;
    }
    signal.throwIfAborted();
    buffer += decoder.decode();
    if (buffer.trim()) {
      if (kind === "ollama" || jsonResponse) handle(buffer);
      else {
        const raw = buffer
          .replace(/\r/g, "")
          .split("\n")
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trimStart())
          .join("\n");
        if (raw) handle(raw);
      }
    }
    if (!complete)
      throw new Error(
        "The provider connection ended before completion. Partial work is preserved; retry explicitly.",
      );
    if (!text.trim())
      throw new Error(
        "The provider completed without an explanation. Try another available model.",
      );
    try {
      onUsage?.(usage);
    } catch {
      /* Usage cannot damage a completed lesson. */
    }
    return text;
  } finally {
    signal.removeEventListener("abort", abort);
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

/** Local configuration is separate from learning data, exports and OAuth storage. */
export class ModelProviderService {
  private loaded = false;
  private loading?: Promise<void>;
  private index: z.infer<typeof INDEX> = {
    version: 1,
    activeId: "chatgpt",
    profiles: [],
  };
  private queue: Promise<unknown> = Promise.resolve();
  private observations: Record<string, Observation> = {};
  private catalogs = new Map<string, ModelInfo[]>();
  constructor(
    private directory: string,
    private auth: AuthAdapter,
    private options: {
      fetch?: typeof globalThis.fetch;
      /** Runs synchronously after validation, before the active route changes. */
      beforeActiveChange?: () => void;
    } = {},
  ) {}
  private get configPath() {
    return join(this.directory, "model-providers.json");
  }
  private keyPath(id: string) {
    return join(this.directory, "provider-credentials", id + ".encrypted");
  }
  private async atomic(path: string, data: string | Buffer) {
    await mkdir(join(this.directory, "provider-credentials"), {
      recursive: true,
    });
    const temp = path + "." + randomUUID() + ".tmp";
    try {
      await writeFile(temp, data, { mode: 0o600 });
      await rename(temp, path);
    } finally {
      await rm(temp, { force: true }).catch(() => {});
    }
  }
  private serialize<T>(work: () => Promise<T>): Promise<T> {
    const next = this.queue.then(work);
    this.queue = next.catch(() => {});
    return next;
  }
  private async load() {
    if (this.loaded) return;
    if (!this.loading)
      this.loading = (async () => {
        try {
          const raw = JSON.parse(await readFile(this.configPath, "utf8"));
          this.index = INDEX.parse(raw);
          for (const p of this.index.profiles)
            providerEndpoint(p.baseUrl, p.kind);
          if (
            this.index.activeId !== "chatgpt" &&
            !this.index.profiles.some((p) => p.id === this.index.activeId)
          )
            throw new Error("Unknown active provider");
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT")
            throw new Error(
              "Provider configuration could not be read. It has not been replaced.",
            );
        }
        try {
          const raw = obj(
            JSON.parse(
              await readFile(
                join(this.directory, "provider-usage.json"),
                "utf8",
              ),
            ),
          );
          for (const [key, value] of Object.entries(raw).slice(0, 200)) {
            const item = obj(value);
            if (typeof item.since !== "string") continue;
            this.observations[key] = {
              since: item.since,
              completedRequests: numeric(item.completedRequests) || 0,
              failedRequests: numeric(item.failedRequests) || 0,
              tokenReportedRequests: numeric(item.tokenReportedRequests) || 0,
              inputTokens: numeric(item.inputTokens) || 0,
              outputTokens: numeric(item.outputTokens) || 0,
            };
          }
        } catch {
          /* Local counters are optional metadata, never credentials or lesson data. */
        }
        this.loaded = true;
      })().finally(() => {
        this.loading = undefined;
      });
    await this.loading;
  }
  private async hasKey(id: string) {
    try {
      return (await readFile(this.keyPath(id))).length > 0;
    } catch {
      return false;
    }
  }
  private async readKey(id: string) {
    try {
      const bytes = await readFile(this.keyPath(id));
      if (!safeStorage.isEncryptionAvailable())
        throw new Error("Protected Windows credential storage is unavailable.");
      const protectedValue = obj(JSON.parse(safeStorage.decryptString(bytes)));
      const profile = this.index.profiles.find((profile) => profile.id === id);
      if (
        !profile ||
        protectedValue.version !== 1 ||
        protectedValue.profileId !== id ||
        protectedValue.kind !== profile.kind ||
        protectedValue.baseUrl !== profile.baseUrl ||
        typeof protectedValue.key !== "string" ||
        protectedValue.key.length > 16384 ||
        /[\r\n\0]/.test(protectedValue.key)
      )
        throw new Error(
          "The stored provider key does not belong to this connection.",
        );
      return protectedValue.key;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return "";
      throw new Error(
        "This provider key could not be unlocked. Re-enter it in provider settings; no plaintext fallback is used.",
      );
    }
  }
  private async save() {
    await this.atomic(this.configPath, JSON.stringify(this.index));
  }
  async list(): Promise<ProviderListing> {
    await this.load();
    return {
      activeId: this.index.activeId,
      profiles: [
        CHATGPT,
        ...(await Promise.all(
          this.index.profiles.map(async (p) => ({
            ...p,
            hasKey: await this.hasKey(p.id),
          })),
        )),
      ],
    };
  }
  async saveProfile(input: unknown) {
    return this.serialize(async () => {
      await this.load();
      const value = SAVE.parse(input);
      if (value.id === "chatgpt")
        throw new Error("ChatGPT account settings are managed separately.");
      const address = providerEndpoint(value.baseUrl, value.kind);
      if (!address.loopback && value.externalConsent !== true)
        throw new Error(
          "Explicit external-provider billing and data consent is required.",
        );
      if (value.apiKey && /[\r\n\0]/.test(value.apiKey))
        throw new Error("Enter a valid provider key.");
      const prior = value.id
        ? this.index.profiles.find((p) => p.id === value.id)
        : undefined;
      if (value.id && !prior) throw new Error("Unknown provider profile.");
      if (
        prior &&
        (prior.baseUrl !== address.url || prior.kind !== value.kind) &&
        !value.apiKey?.trim() &&
        !value.clearKey &&
        (await this.hasKey(prior.id))
      )
        throw new Error(
          "The provider address changed. Enter a replacement key or explicitly remove the stored key; existing credentials are never transferred to another address.",
        );
      if (!prior && this.index.profiles.length >= 20)
        throw new Error("Maximum 20 model providers.");
      const id = prior?.id || randomUUID();
      const key = value.apiKey?.trim();
      let encryptedKey: Buffer | undefined;
      if (key) {
        if (!safeStorage.isEncryptionAvailable())
          throw new Error(
            "Protected Windows credential storage is unavailable. No plaintext key was saved.",
          );
        encryptedKey = safeStorage.encryptString(
          JSON.stringify({
            version: 1,
            profileId: id,
            kind: value.kind,
            baseUrl: address.url,
            key,
          }),
        );
      }
      const profile: SavedProfile = {
        id,
        label: value.label,
        kind: value.kind,
        baseUrl: address.url,
        externalConsent: !address.loopback && value.externalConsent === true,
      };
      const routeChanged = Boolean(
        prior &&
        (prior.baseUrl !== profile.baseUrl || prior.kind !== profile.kind),
      );
      if (prior && id === this.index.activeId) {
        // A replacement can repair an unreadable key; never reuse that key.
        const keyChanged = key
          ? key !== (await this.readKey(id).catch(() => null))
          : Boolean(value.clearKey && (await this.hasKey(id)));
        if (routeChanged || keyChanged) this.options.beforeActiveChange?.();
      }
      if (encryptedKey) await this.atomic(this.keyPath(id), encryptedKey);
      else if (value.clearKey) await rm(this.keyPath(id), { force: true });
      this.index.profiles = this.index.profiles
        .filter((p) => p.id !== id)
        .concat(profile);
      this.catalogs.delete(id);
      await this.save();
      return this.list();
    });
  }
  async select(id: string) {
    return this.serialize(async () => {
      await this.load();
      if (id !== "chatgpt" && !this.index.profiles.some((p) => p.id === id))
        throw new Error("Unknown provider profile.");
      if (id === this.index.activeId) return this.list();
      this.options.beforeActiveChange?.();
      this.index.activeId = id;
      await this.save();
      return this.list();
    });
  }
  async remove(id: string) {
    return this.serialize(async () => {
      await this.load();
      if (id === "chatgpt")
        throw new Error(
          "The ChatGPT provider cannot be deleted. Disconnect its account instead.",
        );
      if (!this.index.profiles.some((p) => p.id === id))
        throw new Error("Unknown provider profile.");
      if (this.index.activeId === id)
        throw new Error(
          "Choose another active provider before removing this connection. No automatic fallback was attempted.",
        );
      this.index.profiles = this.index.profiles.filter((p) => p.id !== id);
      this.catalogs.delete(id);
      await this.save();
      await rm(this.keyPath(id), { force: true });
      delete this.observations[id];
      return this.list();
    });
  }
  private async request(url: string, init: RequestInit) {
    return (this.options.fetch || fetch)(url, {
      ...init,
      credentials: "omit",
      redirect: "error",
    });
  }
  async models(profileId?: string): Promise<ModelInfo[]> {
    await this.load();
    const id = profileId || this.index.activeId;
    if (id === "chatgpt") return this.auth.models();
    const profile = this.index.profiles.find((p) => p.id === id);
    if (!profile)
      throw new Error(
        "The chosen provider no longer exists. Select a provider in Settings.",
      );
    const address = providerEndpoint(profile.baseUrl, profile.kind);
    if (!address.loopback && !profile.externalConsent)
      throw new Error(
        "Confirm external-provider billing and data consent before connecting.",
      );
    const key = await this.readKey(id);
    if (!address.loopback && !key)
      throw new Error(
        "Enter this provider's API key. ChatGPT credentials are never reused.",
      );
    const response = await this.request(
      profile.baseUrl + (profile.kind === "ollama" ? "/api/tags" : "/models"),
      {
        headers: key ? { Authorization: `Bearer ${key}` } : {},
        signal: AbortSignal.timeout(15000),
      },
    );
    const body = await bodyObject(response);
    const raw = profile.kind === "ollama" ? body.models : body.data;
    if (!Array.isArray(raw))
      throw new Error("The provider's model list was malformed.");
    const models: ModelInfo[] = raw.slice(0, 300).flatMap((value) => {
      const item = obj(value),
        rawId = profile.kind === "ollama" ? item.model || item.name : item.id;
      if (
        typeof rawId !== "string" ||
        !rawId.trim() ||
        rawId.length > 140 ||
        /[\r\n\0]/.test(rawId)
      )
        return [];
      const levels = item.supported_reasoning_efforts;
      return [
        {
          id: providerModelId(id, rawId),
          name: typeof item.name === "string" ? item.name.slice(0, 160) : rawId,
          reasoningLevels: Array.isArray(levels)
            ? levels.filter(
                (value): value is string =>
                  typeof value === "string" && /^[\w-]{1,30}$/.test(value),
              )
            : [],
        },
      ];
    });
    const unique = [
      ...new Map(models.map((model) => [model.id, model])).values(),
    ];
    this.catalogs.set(id, unique);
    return unique;
  }
  async status(): Promise<
    AuthStatus & {
      providerId: string;
      providerKind: string;
      providerLabel: string;
    }
  > {
    await this.load();
    const id = this.index.activeId;
    if (id === "chatgpt")
      return {
        ...(await this.auth.status()),
        providerId: id,
        providerKind: "chatgpt",
        providerLabel: CHATGPT.label,
      };
    const profile = this.index.profiles.find((p) => p.id === id)!;
    const address = providerEndpoint(profile.baseUrl, profile.kind);
    const ready =
      address.loopback ||
      Boolean(profile.externalConsent && (await this.hasKey(id)));
    return {
      connected: ready,
      account: profile.label,
      providerId: id,
      providerKind: profile.kind,
      providerLabel: profile.label,
      error: ready
        ? undefined
        : "Configure this provider's key and explicit external usage consent.",
    };
  }
  private async record(
    id: string,
    success: boolean,
    sample?: ProviderUsageSample,
    error?: unknown,
  ) {
    const observed = (this.observations[id] ??= newObservation());
    if (success) {
      observed.completedRequests++;
      if (
        sample?.inputTokens !== undefined ||
        sample?.outputTokens !== undefined
      ) {
        observed.tokenReportedRequests++;
        observed.inputTokens += sample.inputTokens || 0;
        observed.outputTokens += sample.outputTokens || 0;
      }
      if (
        sample?.rateWindow &&
        Object.values(sample.rateWindow).some((value) => value !== undefined)
      )
        observed.rateWindow = {
          ...sample.rateWindow,
          observedAt: new Date().toISOString(),
        };
      delete observed.lastLimit;
    } else {
      observed.failedRequests++;
      const code = safeCode(obj(error).code);
      if (
        code === "subscription_sharing_usage_limit_exceeded" ||
        code === "insufficient_quota" ||
        code === "rate_limit_exceeded"
      )
        observed.lastLimit = { reportedAt: new Date().toISOString(), code };
    }
    try {
      await this.serialize(() =>
        this.atomic(
          join(this.directory, "provider-usage.json"),
          JSON.stringify(this.observations),
        ),
      );
    } catch {
      /* Optional local counters never interrupt learning. */
    }
  }
  async usage(): Promise<ProviderUsage> {
    await this.load();
    const listing = await this.list(),
      profile = listing.profiles.find((p) => p.id === listing.activeId)!;
    let key = profile.id;
    if (profile.kind === "chatgpt") {
      const status = await this.auth.status();
      key = "chatgpt:" + (status.profileId || "primary");
    }
    const observed = this.observations[key] ?? newObservation(),
      { rateWindow, lastLimit, ...counts } = observed;
    const status = await this.status();
    return {
      providerId: profile.id,
      label: profile.label,
      kind: profile.kind,
      connected: status.connected,
      planRemaining: {
        available: false,
        explanation:
          profile.kind === "chatgpt"
            ? "OpenAI does not expose remaining ChatGPT plan allowance through this integration. Check your actual balance in ChatGPT Usage."
            : profile.kind === "ollama"
              ? "A local Ollama server has no ChatGPT subscription quota. Hardware capacity depends on the model you install."
              : "This compatible provider does not expose account balance through the model API. Its own billing dashboard is authoritative.",
      },
      manageUsageUrl: profile.kind === "chatgpt" ? MANAGE_USAGE : undefined,
      observed: counts,
      ...(rateWindow ? { rateWindow } : {}),
      ...(lastLimit ? { lastLimit } : {}),
    };
  }
  async respond(
    request: Request,
    onDelta: (text: string) => void,
    signal: AbortSignal,
  ): Promise<string> {
    await this.load();
    signal.throwIfAborted();
    const route = decodeModel(request.model);
    let id = route?.profileId || "chatgpt";
    if (id !== this.index.activeId)
      throw new Error(
        "This saved model belongs to another provider. Switch providers or choose an available model explicitly; no fallback was attempted.",
      );
    if (!route) {
      const status = await this.auth.status();
      id = "chatgpt:" + (status.profileId || "primary");
      let usage: ProviderUsageSample | undefined;
      try {
        const text = await this.auth.respond(
          request,
          onDelta,
          signal,
          (value) => {
            usage = value;
          },
        );
        await this.record(id, true, usage);
        return text;
      } catch (error) {
        await this.record(id, false, undefined, error);
        throw error;
      }
    }
    const profile = this.index.profiles.find((p) => p.id === route.profileId);
    if (!profile)
      throw new Error(
        "The provider for this saved model no longer exists. Choose another model explicitly.",
      );
    const address = providerEndpoint(profile.baseUrl, profile.kind);
    if (!address.loopback && !profile.externalConsent)
      throw new Error(
        "External-provider consent is required; no fallback was attempted.",
      );
    const models = this.catalogs.get(id) || (await this.models(id));
    const model = models.find((model) => model.id === request.model);
    if (!model)
      throw new Error(
        "The saved model is not in this provider's current catalog. Refresh models.",
      );
    if (request.reasoning && !model.reasoningLevels.includes(request.reasoning))
      throw new Error(
        "This reasoning level is not advertised by the provider. Choose Provider default.",
      );
    const key = await this.readKey(id);
    if (!address.loopback && !key)
      throw new Error(
        "This provider needs its own API key. ChatGPT credentials are never reused.",
      );
    let usage: ProviderUsageSample | undefined;
    try {
      const response = await this.request(
        profile.baseUrl +
          (profile.kind === "ollama" ? "/api/chat" : "/chat/completions"),
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(key ? { Authorization: `Bearer ${key}` } : {}),
          },
          signal: AbortSignal.any([signal, AbortSignal.timeout(15 * 60_000)]),
          body: JSON.stringify({
            model: route.model,
            messages: [
              { role: "system", content: request.instructions },
              ...request.input,
            ],
            stream: true,
            ...(request.reasoning
              ? profile.kind === "ollama"
                ? { think: request.reasoning }
                : { reasoning_effort: request.reasoning }
              : {}),
          }),
        },
      );
      const text = await consumeProviderStream(
        response,
        profile.kind,
        onDelta,
        signal,
        (value) => {
          usage = value;
        },
      );
      await this.record(id, true, usage);
      return text;
    } catch (error) {
      await this.record(id, false, undefined, error);
      throw error;
    }
  }
  async handle(action: string, payload?: unknown) {
    const data = obj(payload);
    switch (action) {
      case "providers:list":
        return this.list();
      case "providers:save":
        return this.saveProfile(payload);
      case "providers:select":
        return this.select(String(data.id));
      case "providers:delete":
        return this.remove(String(data.id));
      case "providers:models":
        return this.models(typeof data.id === "string" ? data.id : undefined);
      case "providers:status":
        return this.status();
      case "providers:usage":
        return this.usage();
      default:
        throw new Error("Unknown model provider action.");
    }
  }
}
