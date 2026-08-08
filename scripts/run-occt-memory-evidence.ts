import { spawnSync } from "node:child_process"

export const CONTROLLED_OCCT_EVIDENCE_RUNS = [
  {
    name: "allocator-instrumented geometry evidence",
    environment: {
      VIBESHAPE_GEOMETRY_LIFECYCLE_BATCHES: "5",
      VIBESHAPE_GEOMETRY_LIFECYCLE_ITERATIONS: "1000",
      VIBESHAPE_GEOMETRY_LIFECYCLE_OPERATIONS:
        "box,cylinder,boolean-cut,occt-box,occt-cylinder,occt-native-box,occt-native-cylinder",
    },
  },
  {
    name: "allocator purge control",
    environment: {
      VIBESHAPE_GEOMETRY_LIFECYCLE_BATCHES: "5",
      VIBESHAPE_GEOMETRY_LIFECYCLE_ITERATIONS: "1000",
      VIBESHAPE_GEOMETRY_LIFECYCLE_OPERATIONS:
        "occt-box,occt-cylinder,occt-native-box,occt-native-cylinder",
      VIBESHAPE_GEOMETRY_PURGE_AFTER_LIFECYCLE: "1",
    },
  },
] as const

export function createControlledOcctEnvironment(
  environment: Record<string, string | undefined>,
  overrides: Record<string, string>,
) {
  return {
    ...environment,
    VIBESHAPE_CONTROLLED_OCCT: "1",
    ...overrides,
  }
}

function runEvidenceMatrix() {
  const bunCommand = process.env.VIBESHAPE_BUN_BIN || "bun"

  for (const evidenceRun of CONTROLLED_OCCT_EVIDENCE_RUNS) {
    console.log(`Running controlled OCCT ${evidenceRun.name}.`)
    const result = spawnSync(
      bunCommand,
      ["run", "test:e2e", "--", "--project=chromium", "tests/e2e/geometry-worker.spec.ts"],
      {
        env: createControlledOcctEnvironment(process.env, evidenceRun.environment),
        stdio: "inherit",
      },
    )

    if (result.error) {
      throw new Error(`Bun failed to start: ${result.error.message}`)
    }

    if (result.status !== 0) {
      throw new Error(
        `Controlled OCCT ${evidenceRun.name} exited with status ${String(result.status)}.`,
      )
    }
  }
}

if (import.meta.main) {
  try {
    runEvidenceMatrix()
  } catch (error: unknown) {
    console.error(error instanceof Error ? error.message : "Unknown OCCT evidence failure.")
    process.exitCode = 1
  }
}
