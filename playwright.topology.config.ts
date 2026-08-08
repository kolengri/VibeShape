import { defineConfig, devices } from "@playwright/test"
import { assertLocalTopologyEnvironment } from "./scripts/run-topology-evidence"

assertLocalTopologyEnvironment(process.env)

export default defineConfig({
  testDir: "./tests/topology",
  outputDir: ".artifacts/playwright/topology-test-results",
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  timeout: 10 * 60_000,
  workers: 1,
  reporter: [
    ["list"],
    ["html", { open: "never", outputFolder: ".artifacts/playwright/topology-report" }],
  ],
  use: {
    baseURL: "http://127.0.0.1:4173",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium-topology",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: "bun run --cwd apps/web dev:e2e",
    url: "http://127.0.0.1:4173",
    reuseExistingServer: false,
  },
})
