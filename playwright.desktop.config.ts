import { defineConfig } from "@playwright/test"

export default defineConfig({
  testDir: "./tests/desktop",
  outputDir: "artifacts/desktop-macos/browser",
  workers: 1,
  retries: 0,
  timeout: 120_000,
  expect: { timeout: 30_000 },
  reporter: "list",
})
