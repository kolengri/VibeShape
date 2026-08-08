import { spawnSync } from "node:child_process"
import { assertSuccessfulOcctProcess } from "./occt-process"

export function assertLocalExtensionEnvironment(environment: Record<string, string | undefined>) {
  if (environment.CI) {
    throw new Error("Extension evidence is local-only and must not run in CI.")
  }
}

function run(command: string, arguments_: string[], description: string) {
  const result = spawnSync(command, arguments_, { env: process.env, stdio: "inherit" })
  assertSuccessfulOcctProcess(result, description)
}

function runExtensionEvidence() {
  assertLocalExtensionEnvironment(process.env)
  const bunCommand = process.env.VIBESHAPE_BUN_BIN || "bun"
  run(
    bunCommand,
    ["x", "vitest", "run", "packages/extension-spike/src/extension-spike.test.ts"],
    "Extension package corpus",
  )
  run(
    bunCommand,
    ["x", "playwright", "test", "--config", "playwright.extension.config.ts"],
    "Extension browser evidence",
  )
}

if (import.meta.main) {
  try {
    runExtensionEvidence()
  } catch (error: unknown) {
    console.error(error instanceof Error ? error.message : "Unknown extension evidence failure.")
    process.exitCode = 1
  }
}
