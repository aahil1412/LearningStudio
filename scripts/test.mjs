import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { mkdirSync } from "node:fs";
mkdirSync(resolve(".tools"), { recursive: true });
const executable =
  process.platform === "win32"
    ? resolve("node_modules/electron/dist/electron.exe")
    : process.platform === "darwin"
      ? resolve(
          "node_modules/electron/dist/Electron.app/Contents/MacOS/Electron",
        )
      : resolve("node_modules/electron/dist/electron");
const result = spawnSync(
  executable,
  [resolve("node_modules/vitest/vitest.mjs"), "run", ...process.argv.slice(2)],
  { stdio: "inherit", env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" } },
);
if (result.error) throw result.error;
process.exit(result.status ?? 1);
