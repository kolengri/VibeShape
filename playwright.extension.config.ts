import { defineConfig, devices } from "@playwright/test"
import { assertLocalExtensionEnvironment } from "./scripts/run-extension-evidence"

assertLocalExtensionEnvironment(process.env)

export default defineConfig({
  testDir: "./tests/extensions",
  outputDir: ".artifacts/playwright/extension-test-results",
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  timeout: 60_000,
  workers: 1,
  reporter: [
    ["list"],
    ["html", { open: "never", outputFolder: ".artifacts/playwright/extension-report" }],
  ],
  use: {
    baseURL: "http://127.0.0.1:4173",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  projects: [
    { name: "chromium-extension", use: { ...devices["Desktop Chrome"] } },
    { name: "firefox-extension", use: { ...devices["Desktop Firefox"] } },
    { name: "webkit-extension", use: { ...devices["Desktop Safari"] } },
  ],
  webServer: {
    command: "bun run --cwd apps/web dev:e2e",
    url: "http://127.0.0.1:4173",
    reuseExistingServer: false,
  },
})
