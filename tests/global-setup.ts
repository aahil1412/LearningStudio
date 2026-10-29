import { mkdir } from "node:fs/promises";

export default async function setupTestDirectories() {
  await mkdir(".tools", { recursive: true });
}
