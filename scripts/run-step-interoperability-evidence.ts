import { spawnSync } from "node:child_process"
import { mkdirSync, rmSync } from "node:fs"
import { resolve } from "node:path"
import { assertSuccessfulOcctProcess } from "./occt-process"
import {
  assertLocalStepInteroperabilityEnvironment,
  readStepInteroperabilityReport,
  readStepProducerReport,
  resolveFreeCadCommand,
} from "./step-interoperability"

function runStepProducer(repositoryRoot: string) {
  const bunCommand = process.env.VIBESHAPE_BUN_BIN || "bun"
  const result = spawnSync(
    bunCommand,
    ["run", "test:e2e", "--", "--project=chromium", "tests/e2e/geometry-worker.spec.ts"],
    {
      cwd: repositoryRoot,
      env: {
        ...process.env,
        VIBESHAPE_CONTROLLED_OCCT: "1",
        VIBESHAPE_GEOMETRY_LIFECYCLE_BATCHES: "1",
        VIBESHAPE_GEOMETRY_LIFECYCLE_ITERATIONS: "1",
        VIBESHAPE_GEOMETRY_LIFECYCLE_OPERATIONS: "boolean-cut",
        VIBESHAPE_STEP_INTEROPERABILITY: "1",
      },
      stdio: "inherit",
    },
  )
  assertSuccessfulOcctProcess(result, "Controlled STEP fixture export")
}

function runFreeCadValidator(options: {
  artifactDirectory: string
  freeCadCommand: string
  repositoryRoot: string
}) {
  const stepPath = resolve(options.artifactDirectory, "vibeshape-kernel-fixture.step")
  const producerReportPath = resolve(options.artifactDirectory, "producer-report.json")
  const freeCadReportPath = resolve(options.artifactDirectory, "freecad-report.json")
  const userConfigPath = resolve(options.artifactDirectory, "freecad-user.cfg")
  const validatorPath = resolve(options.repositoryRoot, "scripts/verify-step-with-freecad.py")
  readStepProducerReport(producerReportPath)

  const result = spawnSync(options.freeCadCommand, ["--user-cfg", userConfigPath, validatorPath], {
    cwd: options.repositoryRoot,
    env: {
      ...process.env,
      VIBESHAPE_STEP_INPUT: stepPath,
      VIBESHAPE_STEP_PRODUCER_REPORT: producerReportPath,
      VIBESHAPE_STEP_FREECAD_REPORT: freeCadReportPath,
    },
    stdio: "inherit",
  })
  assertSuccessfulOcctProcess(result, "Independent FreeCAD STEP validation")
  return readStepInteroperabilityReport(freeCadReportPath)
}

function runStepInteroperabilityEvidence() {
  assertLocalStepInteroperabilityEnvironment(process.env)
  const repositoryRoot = resolve(import.meta.dir, "..")
  const artifactDirectory = resolve(repositoryRoot, ".artifacts/occt-build/step-interoperability")
  const freeCadCommand = resolveFreeCadCommand(process.env)
  rmSync(artifactDirectory, { force: true, recursive: true })
  mkdirSync(artifactDirectory, { recursive: true })
  runStepProducer(repositoryRoot)
  const report = runFreeCadValidator({ artifactDirectory, freeCadCommand, repositoryRoot })

  console.log(
    `Independent STEP evidence passed with ${report.reader.name} ${report.reader.version}.`,
  )
}

if (import.meta.main) {
  try {
    runStepInteroperabilityEvidence()
  } catch (error: unknown) {
    console.error(error instanceof Error ? error.message : "Unknown STEP interoperability failure.")
    process.exitCode = 1
  }
}
