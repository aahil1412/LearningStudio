import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
export default defineConfig({
  base: "./",
  plugins: [react()],
  build: { chunkSizeWarningLimit: 1600 },
  test: { include: ["tests/**/*.test.ts"], environment: "node" },
});
