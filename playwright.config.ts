import { defineConfig, devices } from "@playwright/test"

const controlledOcctMode = process.env.VIBESHAPE_CONTROLLED_OCCT === "1"
const reuseExistingServer = !process.env.CI && !controlledOcctMode
// Local checkouts share 127.0.0.1:4173 by default; set VIBESHAPE_E2E_PORT to run beside another one.
const portOverride = process.env.VIBESHAPE_E2E_PORT
const port = portOverride === undefined ? 4173 : Number(portOverride)
if (!Number.isInteger(port) || port < 1 || port > 65_535) {
  throw new Error(
    `VIBESHAPE_E2E_PORT must be a TCP port, received ${JSON.stringify(portOverride)}.`,
  )
}
const baseURL = `http://127.0.0.1:${port}`
// The dev:e2e script ends with Vite, whose last --port flag wins over the script default.
const devServerArgs = [
  ...(controlledOcctMode ? ["--mode", "controlled-occt"] : []),
  ...(portOverride === undefined ? [] : ["--port", String(port)]),
]

export default defineConfig({
  testDir: "./tests/e2e",
  outputDir: ".artifacts/playwright/test-results",
  // A reused server may belong to another checkout; verify it before any test trusts it.
  ...(reuseExistingServer ? { globalSetup: "./tests/e2e/verify-dev-server-checkout.ts" } : {}),
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : "50%",
  reporter: [
    [process.env.CI ? "github" : "list"],
    ["html", { open: "never", outputFolder: ".artifacts/playwright/report" }],
  ],
  use: {
    baseURL,
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
    command: [
      "bun run --cwd apps/web dev:e2e",
      ...(devServerArgs.length > 0 ? ["--", ...devServerArgs] : []),
    ].join(" "),
    url: baseURL,
    reuseExistingServer,
  },
})
