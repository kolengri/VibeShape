import { defineConfig, devices } from "@playwright/test"

export default defineConfig({
  testDir: "./tests/site",
  outputDir: "artifacts/presentation-site/test-results",
  forbidOnly: Boolean(process.env.CI),
  workers: 1,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:4180",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "bun run preview:site",
    url: "http://127.0.0.1:4180",
    reuseExistingServer: !process.env.CI,
  },
})
