import { defineConfig, devices } from "@playwright/test"
import { assertLocalThreeMfEnvironment } from "./scripts/three-mf-evidence"

assertLocalThreeMfEnvironment(process.env)

export default defineConfig({
  testDir: "./tests/formats",
  outputDir: ".artifacts/playwright/formats-test-results",
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  timeout: 60_000,
  workers: 1,
  reporter: [
    ["list"],
    ["html", { open: "never", outputFolder: ".artifacts/playwright/formats-report" }],
  ],
  use: {
    baseURL: "http://127.0.0.1:4173",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium-formats",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: "bun run --cwd apps/web dev:e2e",
    url: "http://127.0.0.1:4173",
    reuseExistingServer: false,
  },
})
