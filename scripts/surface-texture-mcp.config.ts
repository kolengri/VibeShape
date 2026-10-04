import { resolve } from "node:path"
import { defineConfig } from "@playwright/test"
import base from "../playwright.config"

export default defineConfig({
  ...base,
  testDir: resolve(import.meta.dirname, "../tests/e2e"),
  outputDir: resolve(import.meta.dirname, "../.artifacts/surface-texture-mcp/browser"),
  testMatch: ["local-mcp-surface-texture.spec.ts", "surface-texture.spec.ts"],
  fullyParallel: false,
  workers: 1,
  use: { ...base.use, baseURL: "http://127.0.0.1:44117" },
  webServer: {
    cwd: resolve(import.meta.dirname, ".."),
    command: "bun run --cwd apps/web dev -- --host 127.0.0.1 --port 44117 --strictPort",
    url: "http://127.0.0.1:44117",
    reuseExistingServer: false,
  },
})
