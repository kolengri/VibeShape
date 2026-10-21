import { resolve } from "node:path"
import { defineConfig, devices } from "@playwright/test"

const root = resolve(import.meta.dirname, "..")

export default defineConfig({
  testDir: resolve(root, "apps/web"),
  testMatch: "project-create-cold-start.spec.ts",
  outputDir: resolve(root, `artifacts/project-create-race/regression-${Date.now()}-${process.pid}`),
  workers: 1,
  retries: 0,
  reporter: "list",
  use: { trace: "retain-on-failure", screenshot: "only-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
})
