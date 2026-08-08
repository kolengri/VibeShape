import { spawnSync } from "node:child_process"
import { assertSuccessfulOcctProcess } from "./occt-process"

export function assertLocalPersistenceEnvironment(environment: Record<string, string | undefined>) {
  if (environment.CI) {
    throw new Error("Persistence evidence is local-only and must not run in CI.")
  }
}

function runPersistenceEvidence() {
  assertLocalPersistenceEnvironment(process.env)
  const bunCommand = process.env.VIBESHAPE_BUN_BIN || "bun"
  const result = spawnSync(
    bunCommand,
    ["x", "playwright", "test", "--config", "playwright.persistence.config.ts"],
    { env: process.env, stdio: "inherit" },
  )
  assertSuccessfulOcctProcess(result, "Local-first persistence evidence")
}

if (import.meta.main) {
  try {
    runPersistenceEvidence()
  } catch (error: unknown) {
    console.error(error instanceof Error ? error.message : "Unknown persistence evidence failure.")
    process.exitCode = 1
  }
}
