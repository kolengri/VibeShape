import { defineConfig, devices } from "@playwright/test"

const baseURL = process.env.VIBESHAPE_PUBLIC_URL
if (!baseURL || new URL(baseURL).protocol !== "https:")
  throw new Error("Set VIBESHAPE_PUBLIC_URL to the deployed HTTPS editor URL.")

export default defineConfig({
  testDir: "./tests/public",
  outputDir: ".artifacts/public-browser",
  forbidOnly: true,
  workers: 1,
  retries: 0,
  timeout: 180_000,
  expect: { timeout: 30_000 },
  reporter: "list",
  use: { baseURL, trace: "retain-on-failure", screenshot: "only-on-failure" },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
  ],
})
