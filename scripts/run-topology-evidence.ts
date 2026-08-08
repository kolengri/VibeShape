import { spawnSync } from "node:child_process"
import { assertSuccessfulOcctProcess } from "./occt-process"

export function assertLocalTopologyEnvironment(environment: Record<string, string | undefined>) {
  if (environment.CI) {
    throw new Error("Stable topology evidence is local-only and must not run in CI.")
  }
}

function runTopologyEvidence() {
  assertLocalTopologyEnvironment(process.env)

  const bunCommand = process.env.VIBESHAPE_BUN_BIN || "bun"
  const result = spawnSync(
    bunCommand,
    ["x", "playwright", "test", "--config", "playwright.topology.config.ts"],
    { env: process.env, stdio: "inherit" },
  )

  assertSuccessfulOcctProcess(result, "Stable topology evidence")
}

if (import.meta.main) {
  try {
    runTopologyEvidence()
  } catch (error: unknown) {
    console.error(error instanceof Error ? error.message : "Unknown stable topology failure.")
    process.exitCode = 1
  }
}
