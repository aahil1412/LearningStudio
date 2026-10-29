import { build } from "esbuild";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
await mkdir("dist-export", { recursive: true });
const built = await build({
  metafile: true,
  entryPoints: ["src/export/runtime.tsx"],
  bundle: true,
  platform: "browser",
  format: "iife",
  target: "chrome120",
  outfile: "dist-export/runtime.js",
  minify: true,
  legalComments: "eof",
  loader: { ".woff2": "dataurl", ".woff": "dataurl", ".ttf": "dataurl" },
  plugins: [
    {
      name: "offline-toolkit-url",
      setup(builder) {
        builder.onResolve({ filter: /\?url$/ }, (args) => ({
          path: args.path,
          namespace: "offline-url",
        }));
        builder.onLoad({ filter: /.*/, namespace: "offline-url" }, () => ({
          contents: 'export default "embedded-toolkit-not-needed";',
          loader: "js",
        }));
      },
    },
  ],
  define: { "process.env.NODE_ENV": '"production"' },
});

// Include the full notices for the actual browser bundle, including font assets.
const packages = new Set();
for (const input of Object.keys(built.metafile.inputs)) {
  const offset = input.lastIndexOf("node_modules/");
  if (offset < 0) continue;
  const parts = input.slice(offset + "node_modules/".length).split("/");
  packages.add(
    join(
      input.slice(0, offset + "node_modules/".length),
      parts[0].startsWith("@") ? parts.slice(0, 2).join("/") : parts[0],
    ),
  );
}
const notices = [
  "Learning Studio portable textbook runtime\n" +
    (await readFile("LICENSE", "utf8")),
  "Inter variable typeface\n" +
    (await readFile("assets/fonts/Inter-OFL-1.1.txt", "utf8")),
];
for (const directory of [...packages].sort()) {
  const metadata = JSON.parse(
    await readFile(join(directory, "package.json"), "utf8"),
  );
  let license = "";
  for (const name of [
    "LICENSE",
    "LICENSE.md",
    "LICENSE.txt",
    "license",
    "license.md",
    "COPYING",
  ]) {
    try {
      license = await readFile(join(directory, name), "utf8");
      break;
    } catch {}
  }
  notices.push(
    metadata.name +
      " " +
      metadata.version +
      "\nDeclared license: " +
      String(metadata.license || "See package notices") +
      "\n" +
      license,
  );
}
await writeFile(
  "dist-export/NOTICES.txt",
  notices.join("\n\n----------------------------------------\n\n"),
);
