import { defineConfig, devices } from "@playwright/test"

if (!process.env.VIBESHAPE_DISTRIBUTION_ROOT)
  throw new Error("Set VIBESHAPE_DISTRIBUTION_ROOT to an extracted local distribution.")

export default defineConfig({
  testDir: "./tests/distribution",
  outputDir: ".artifacts/distribution-evidence/browser",
  fullyParallel: true,
  workers: 3,
  retries: 0,
  expect: { timeout: 30_000 },
  reporter: "list",
  use: { screenshot: "only-on-failure", trace: "retain-on-failure" },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
  ],
})
