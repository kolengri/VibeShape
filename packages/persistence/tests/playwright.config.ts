import { resolve } from "node:path"
import persistenceConfig from "../playwright.config"

export default {
  ...persistenceConfig,
  testMatch: "transcript-store.spec.ts",
  outputDir: resolve(import.meta.dirname, "../../../artifacts/transcript-archives/browser"),
}
