import { spawnSync } from "node:child_process"
import { assertSuccessfulOcctProcess } from "./occt-process"

export const OCCT_PERFORMANCE_ENVIRONMENT = {
  VIBESHAPE_CONTROLLED_OCCT: "1",
  VIBESHAPE_OCCT_PERFORMANCE_PAGE_RUNS: "10",
} as const

export function createOcctPerformanceEnvironment(
  environment: Record<string, string | undefined>,
  overrides: Record<string, string> = {},
) {
  return {
    ...environment,
    ...OCCT_PERFORMANCE_ENVIRONMENT,
    ...overrides,
  }
}

export function assertLocalPerformanceEnvironment(environment: Record<string, string | undefined>) {
  if (environment.CI) {
    throw new Error("OCCT performance evidence is local-only and must not run in CI.")
  }
}

function runPerformanceEvidence() {
  assertLocalPerformanceEnvironment(process.env)

  const bunCommand = process.env.VIBESHAPE_BUN_BIN || "bun"
  const result = spawnSync(
    bunCommand,
    ["x", "playwright", "test", "--config", "playwright.performance.config.ts"],
    {
      env: createOcctPerformanceEnvironment(process.env),
      stdio: "inherit",
    },
  )

  assertSuccessfulOcctProcess(result, "Controlled OCCT performance evidence")
}

if (import.meta.main) {
  try {
    runPerformanceEvidence()
  } catch (error: unknown) {
    console.error(error instanceof Error ? error.message : "Unknown OCCT performance failure.")
    process.exitCode = 1
  }
}
