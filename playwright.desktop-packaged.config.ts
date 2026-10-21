import { defineConfig } from "@playwright/test"
import desktop from "./playwright.desktop.config"

if (!process.env.VIBESHAPE_PACKAGED_APP)
  throw new Error(
    "Set VIBESHAPE_PACKAGED_APP to the actual VibeShape.app bundle or extracted Windows application directory.",
  )

export default defineConfig({
  ...desktop,
  testMatch: process.platform === "win32" ? "windows.spec.ts" : "application.spec.ts",
})
