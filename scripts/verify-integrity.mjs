import { extractFile, listPackage } from "@electron/asar";
import { readFile, readdir, stat, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
const root = resolve("."),
  releaseRoot = resolve(process.env.STUDIO_RELEASE_DIR || "release"),
  archive = join(releaseRoot, "win-unpacked/resources/app.asar");
const files = [];
async function walk(path) {
  for (const entry of await readdir(path, { withFileTypes: true })) {
    const child = join(path, entry.name);
    if (entry.isDirectory()) await walk(child);
    else if (entry.isFile()) files.push(child);
  }
}
for (const directory of [
  "dist",
  "dist-electron",
  "dist-export",
  "assets/ocr",
  "assets/fonts",
])
  await walk(join(root, directory));
files.push(join(root, "assets/icon.png"), join(root, "LICENSE"));
for (const path of files) {
  const name = relative(root, path).replaceAll("\\", "/");
  assert.ok(
    (await readFile(path)).equals(extractFile(archive, relative(root, path))),
    `Packaged runtime mismatch: ${name}`,
  );
}
const entries = listPackage(archive).map((path) => path.replaceAll("\\", "/"));
assert.equal(
  entries.some((name) =>
    /^\/(?:references|\.tools|\.git|\.auth-test-)/.test(name),
  ),
  false,
);
assert.equal(
  entries.some((name) => /^\/[^/]+\.sqlite(?:$|-)/.test(name)),
  false,
);
const hash = async (path) =>
  createHash("sha256")
    .update(await readFile(path))
    .digest("hex");
const version = JSON.parse(await readFile("package.json", "utf8")).version;
const packagedMetadata = JSON.parse(
  extractFile(archive, "package.json").toString("utf8"),
);
assert.equal(packagedMetadata.version, version);
assert.equal(packagedMetadata.main, "dist-electron/main.cjs");
const installer = `Learning Studio Setup ${version}.exe`,
  executable = "win-unpacked/Learning Studio.exe";
const report = {
  version,
  verifiedAt: new Date().toISOString(),
  verifiedFiles: files.length,
  allPackagedRuntimeFilesMatch: true,
  installer: {
    file: installer,
    bytes: (await stat(join(releaseRoot, installer))).size,
    sha256: await hash(join(releaseRoot, installer)),
  },
  executable: {
    file: executable,
    sha256: await hash(join(releaseRoot, executable)),
  },
  signing: "Unsigned local release",
};
const reportPrefix = process.env.STUDIO_REPORT_PREFIX || "";
assert.match(reportPrefix, /^[a-zA-Z0-9-]*$/);
await writeFile(
  `docs/${reportPrefix}package-integrity.json`,
  JSON.stringify(report, null, 2),
);
process.stdout.write(
  `Verified ${files.length} packaged runtime files and installer SHA-256.\n`,
);
