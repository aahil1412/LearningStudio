import { spawn } from "node:child_process";
import { build } from "esbuild";
await import("./build-electron.mjs");
const vite = spawn(
  process.execPath,
  ["node_modules/vite/bin/vite.js", "--host", "127.0.0.1"],
  { stdio: "inherit" },
);
let ready = false;
for (let i = 0; i < 50; i++) {
  try {
    await fetch("http://127.0.0.1:5173");
    ready = true;
    break;
  } catch {
    await new Promise((r) => setTimeout(r, 200));
  }
}
if (!ready) throw new Error("Development server did not start");
const electron = spawn("node_modules/electron/dist/electron.exe", ["."], {
  stdio: "inherit",
  env: { ...process.env, STUDIO_DEV_URL: "http://127.0.0.1:5173" },
});
electron.on("exit", () => vite.kill());
process.on("SIGINT", () => {
  electron.kill();
  vite.kill();
});
