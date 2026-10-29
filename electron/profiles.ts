import { readFile, writeFile, mkdir, rename } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { AuthManager } from "./auth";
type Profile = { id: string; label: string; legacy?: boolean };
export class AuthProfiles {
  private profiles: Profile[] = [];
  private active = "primary";
  private managers = new Map<string, AuthManager>();
  private loaded = false;
  private loading?: Promise<void>;
  constructor(
    private options: {
      directory: string;
      openExternal: (url: string) => Promise<void>;
      fetch?: typeof globalThis.fetch;
    },
  ) {}
  private async load() {
    if (this.loaded) return;
    if (!this.loading)
      this.loading = this.loadIndex().finally(() => {
        this.loading = undefined;
      });
    await this.loading;
  }
  private async loadIndex() {
    await mkdir(this.options.directory, { recursive: true });
    try {
      const raw = JSON.parse(
        await readFile(join(this.options.directory, "profiles.json"), "utf8"),
      );
      if (!Array.isArray(raw.profiles) || raw.profiles.length > 30)
        throw new Error("Invalid profile index");
      this.profiles = raw.profiles
        .filter(
          (p: any) =>
            p && /^[\w-]{1,80}$/.test(p.id) && typeof p.label === "string",
        )
        .map((p: any) => ({
          id: p.id,
          label: p.label.slice(0, 100),
          legacy: p.legacy === true,
        }));
      this.active = this.profiles.some((p) => p.id === raw.active)
        ? raw.active
        : this.profiles[0]?.id;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT")
        throw new Error(
          "The account profile index could not be read. No credentials have been replaced.",
        );
    }
    if (!this.profiles.length) {
      this.profiles = [
        { id: "primary", label: "Primary account", legacy: true },
      ];
      this.active = "primary";
      await this.save();
    }
    this.loaded = true;
  }
  private async save() {
    const target = join(this.options.directory, "profiles.json"),
      temporary = target + "." + randomUUID() + ".tmp";
    await writeFile(
      temporary,
      JSON.stringify({ active: this.active, profiles: this.profiles }),
      "utf8",
    );
    await rename(temporary, target);
  }
  private async manager() {
    await this.load();
    let manager = this.managers.get(this.active);
    if (!manager) {
      const p = this.profiles.find((p) => p.id === this.active)!;
      manager = new AuthManager({
        credentialPath: p.legacy
          ? join(this.options.directory, "connection.encrypted")
          : join(
              this.options.directory,
              "accounts",
              p.id,
              "connection.encrypted",
            ),
        openExternal: this.options.openExternal,
        fetch: this.options.fetch,
      });
      this.managers.set(p.id, manager);
    }
    return manager;
  }
  async status() {
    const status = await (await this.manager()).status();
    return { ...status, profileId: this.active };
  }
  async list() {
    await this.load();
    return {
      active: this.active,
      profiles: this.profiles.map(({ id, label }) => ({ id, label })),
    };
  }
  async create(label: string) {
    await this.load();
    if (this.profiles.length >= 30)
      throw new Error("Maximum 30 account profiles.");
    const id = randomUUID();
    this.profiles.push({
      id,
      label: label.trim().slice(0, 100) || "ChatGPT account",
    });
    this.active = id;
    await this.save();
    return this.status();
  }
  async select(id: string) {
    await this.load();
    if (!this.profiles.some((p) => p.id === id))
      throw new Error("Unknown account profile.");
    this.active = id;
    await this.save();
    return this.status();
  }
  async rename(id: string, label: string) {
    await this.load();
    if (!label.trim()) throw new Error("Enter an account label.");
    this.profiles = this.profiles.map((p) =>
      p.id === id ? { ...p, label: label.trim().slice(0, 100) } : p,
    );
    await this.save();
    return this.list();
  }
  async connect() {
    return (await this.manager()).connect();
  }
  async disconnect() {
    return (await this.manager()).disconnect();
  }
  async models() {
    return (await this.manager()).models();
  }
  async respond(...args: Parameters<AuthManager["respond"]>) {
    return (await this.manager()).respond(...args);
  }
}
