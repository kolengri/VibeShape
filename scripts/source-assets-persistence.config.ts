import { resolve } from "node:path"
import { defineConfig, devices } from "@playwright/test"

const root = resolve(import.meta.dirname, "..")
export default defineConfig({
  testDir: resolve(root, "tests/e2e"),
  testMatch: "source-assets-persistence.spec.ts",
  outputDir: resolve(root, ".artifacts/source-assets/browser"),
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  reporter: "list",
  use: { baseURL: "http://127.0.0.1:44831", trace: "retain-on-failure" },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
  ],
  webServer: {
    cwd: root,
    command: "bun run --cwd apps/web dev -- --host 127.0.0.1 --port 44831 --strictPort",
    url: "http://127.0.0.1:44831",
    reuseExistingServer: false,
  },
})
