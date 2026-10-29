import { build, Platform, Arch } from "electron-builder";
import { readFile } from "node:fs/promises";
const publisher = process.env.STUDIO_PUBLISHER_NAME;
const feed = process.env.STUDIO_UPDATE_FEED;
if (!process.env.CSC_LINK && !process.env.WIN_CSC_LINK)
  throw new Error(
    "Provide your certificate explicitly through CSC_LINK or WIN_CSC_LINK. Existing certificate stores are not scanned by this script.",
  );
if (!publisher || !feed)
  throw new Error(
    "Set STUDIO_PUBLISHER_NAME to the certificate publisher and STUDIO_UPDATE_FEED to your HTTPS release-feed URL.",
  );
const url = new URL(feed);
if (url.protocol !== "https:" || url.username || url.password)
  throw new Error(
    "The release feed must use HTTPS without embedded credentials.",
  );
const pkg = JSON.parse(await readFile("package.json", "utf8"));
await build({
  targets: Platform.WINDOWS.createTarget("nsis", Arch.x64),
  publish: "never",
  config: {
    ...pkg.build,
    forceCodeSigning: true,
    win: { ...pkg.build.win, signExecutable: true, publisherName: publisher },
    publish: { provider: "generic", url: url.href },
  },
});
process.stdout.write(
  "Signed release prepared locally. Upload the installer, blockmap, and latest.yml to your release feed when you choose to publish.\n",
);
