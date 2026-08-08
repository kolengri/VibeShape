import { defineConfig, devices } from "@playwright/test"
import { assertLocalPerformanceEnvironment } from "./scripts/run-occt-performance-evidence"

assertLocalPerformanceEnvironment(process.env)

export default defineConfig({
  testDir: "./tests/performance",
  outputDir: ".artifacts/playwright/performance-test-results",
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  timeout: 10 * 60_000,
  workers: 1,
  reporter: [
    ["list"],
    ["html", { open: "never", outputFolder: ".artifacts/playwright/performance-report" }],
  ],
  use: {
    baseURL: "http://127.0.0.1:4173",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium-performance",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: "bun run --cwd apps/web dev:e2e -- --mode controlled-occt",
    url: "http://127.0.0.1:4173",
    reuseExistingServer: false,
  },
})
