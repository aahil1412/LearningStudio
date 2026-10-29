import { app } from "electron";
import { autoUpdater } from "electron-updater";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
export class UpdateService {
  private busy = false;
  private state: {
    status: string;
    version?: string;
    error?: string;
    progress?: number;
  } = { status: "idle" };
  private configured = "";
  constructor() {
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = false;
    autoUpdater.allowPrerelease = false;
    autoUpdater.allowDowngrade = false;
    autoUpdater.on("update-available", (info) => {
      this.state = { status: "available", version: info.version };
    });
    autoUpdater.on("update-not-available", (info) => {
      this.state = { status: "current", version: info.version };
    });
    autoUpdater.on("download-progress", (p) => {
      this.state = {
        ...this.state,
        status: "downloading",
        progress: p.percent,
      };
    });
    autoUpdater.on("update-downloaded", (info) => {
      this.state = { status: "ready", version: info.version };
    });
    autoUpdater.on("error", (e) => {
      this.state = { status: "error", error: e.message.slice(0, 500) };
    });
  }
  status() {
    return this.state;
  }
  async check(feed: string) {
    if (!app.isPackaged)
      throw new Error(
        "Update installation is available in the packaged application.",
      );
    const url = new URL(feed);
    if (url.protocol !== "https:" || url.username || url.password || url.port)
      throw new Error(
        "Choose a trusted HTTPS update feed without credentials.",
      );
    if (this.busy) throw new Error("An update operation is already running.");
    this.busy = true;
    this.state = { status: "checking" };
    try {
      this.configured = url.href;
      autoUpdater.setFeedURL({ provider: "generic", url: url.href });
      const result = await autoUpdater.checkForUpdates();
      if (!result)
        throw new Error("The update provider returned no release information.");
      return this.state;
    } catch (error) {
      this.state = {
        status: "error",
        error: error instanceof Error ? error.message : "Update check failed",
      };
      throw error;
    } finally {
      this.busy = false;
    }
  }
  async download() {
    if (!this.configured || this.state.status !== "available")
      throw new Error("Check a trusted feed for an available update first.");
    const trust = await readFile(
      join(process.resourcesPath, "app-update.yml"),
      "utf8",
    ).catch(() => "");
    if (
      !/^publisherName:\s*\S/m.test(trust) ||
      /^verifyUpdateCodeSignature:\s*false/m.test(trust)
    )
      throw new Error(
        "A signed distribution with an embedded publisher identity is required for in-app update installation. Build with your code-signing certificate first.",
      );
    this.state = { ...this.state, status: "downloading" };
    await autoUpdater.downloadUpdate();
    return this.state;
  }
  install() {
    if (this.state.status !== "ready")
      throw new Error("Download and verify the update first.");
    autoUpdater.quitAndInstall(false, true);
  }
}
