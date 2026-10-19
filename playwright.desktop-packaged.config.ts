import { defineConfig } from "@playwright/test"
import desktop from "./playwright.desktop.config"

if (!process.env.VIBESHAPE_PACKAGED_APP)
  throw new Error("Set VIBESHAPE_PACKAGED_APP to the actual macOS VibeShape.app bundle.")

export default defineConfig({ ...desktop, testMatch: "application.spec.ts" })
