import { defineConfig, devices } from "@playwright/test"

const controlledOcctMode = process.env.VIBESHAPE_CONTROLLED_OCCT === "1"

export default defineConfig({
  testDir: "./tests/e2e",
  outputDir: ".artifacts/playwright/test-results",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : "50%",
  reporter: [
    [process.env.CI ? "github" : "list"],
    ["html", { open: "never", outputFolder: ".artifacts/playwright/report" }],
  ],
  use: {
    baseURL: "http://127.0.0.1:4173",
    screenshot: "only-on-failure",
    trace: "on-first-retry",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "firefox",
      use: { ...devices["Desktop Firefox"] },
    },
    {
      name: "webkit",
      use: { ...devices["Desktop Safari"] },
    },
  ],
  webServer: {
    command: controlledOcctMode
      ? "bun run --cwd apps/web dev:e2e -- --mode controlled-occt"
      : "bun run --cwd apps/web dev:e2e",
    url: "http://127.0.0.1:4173",
    reuseExistingServer: !process.env.CI,
  },
})
