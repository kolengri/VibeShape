import { defineConfig, devices } from "@playwright/test"
import { assertLocalPersistenceEnvironment } from "./scripts/run-persistence-evidence"

assertLocalPersistenceEnvironment(process.env)

export default defineConfig({
  testDir: "./tests/persistence",
  outputDir: ".artifacts/playwright/persistence-test-results",
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  timeout: 60_000,
  workers: 1,
  reporter: [
    ["list"],
    ["html", { open: "never", outputFolder: ".artifacts/playwright/persistence-report" }],
  ],
  use: {
    baseURL: "http://127.0.0.1:4173",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  projects: [
    { name: "chromium-persistence", use: { ...devices["Desktop Chrome"] } },
    { name: "firefox-persistence", use: { ...devices["Desktop Firefox"] } },
    { name: "webkit-persistence", use: { ...devices["Desktop Safari"] } },
  ],
  webServer: {
    command: "bun run --cwd apps/web dev:e2e",
    url: "http://127.0.0.1:4173",
    reuseExistingServer: false,
  },
})
