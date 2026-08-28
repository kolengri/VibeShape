import { existsSync, mkdirSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { pathToFileURL } from "node:url"
import {
  type FlatSketchSystemInput,
  type NativeSketchSolverModule,
  type SketchSolveResult,
  SketchSolverSession,
} from "../packages/sketch-solver/src"
import { assertLocalSolveSpaceBuild, SOLVESPACE_BUILD_INPUTS } from "./solvespace-build-config"
import {
  createConstraintCoverageFixtures,
  createDegenerateLineFixture,
  createLineFixture,
  createPointAlignmentConflictFixture,
} from "./solvespace-fixtures"

interface SolveSpaceFactoryModule {
  default(options?: { locateFile?: (file: string) => string }): Promise<NativeSketchSolverModule>
}

const repositoryRoot = resolve(import.meta.dir, "..")
const artifactRoot = join(repositoryRoot, ".artifacts", "solvespace-build")
const outputRoot = join(artifactRoot, "output")
const modulePath = join(outputRoot, SOLVESPACE_BUILD_INPUTS.outputModule)

function requireCondition(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message)
  }
}

async function loadNativeModule() {
  if (!existsSync(modulePath)) {
    throw new Error("Run `bun run solvespace:build` before collecting solver evidence.")
  }

  const imported = (await import(pathToFileURL(modulePath).href)) as SolveSpaceFactoryModule
  return imported.default({ locateFile: (file) => join(outputRoot, file) })
}

function distance(values: Float64Array) {
  const firstX = values[7] as number
  const firstY = values[8] as number
  const secondX = values[9] as number
  const secondY = values[10] as number
  return Math.hypot(secondX - firstX, secondY - firstY)
}

function percentile(values: readonly number[], quantile: number) {
  const sorted = [...values].sort((left, right) => left - right)
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * quantile))] ?? Number.NaN
}

function perturbSystem(system: FlatSketchSystemInput, seed: number): FlatSketchSystemInput {
  const parameterValues = new Float64Array(system.parameterValues)
  let state = seed >>> 0
  for (let index = 0; index < parameterValues.length; index += 1) {
    const group = system.parameterMetadata[index * 2 + 1]
    if (group !== 2) {
      continue
    }
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0
    parameterValues[index] = (parameterValues[index] ?? 0) + (state / 0xffff_ffff - 0.5) * 0.1
  }
  return { ...system, parameterValues }
}

const successfulStatuses = new Set(["fully-constrained", "under-constrained"])

function requireSuccessfulSolve(result: SketchSolveResult, fixtureName: string) {
  requireCondition(
    successfulStatuses.has(result.status),
    `${fixtureName} failed with ${result.status}.`,
  )
  requireCondition(result.maximumResidual <= 1e-7, `${fixtureName} residual exceeded tolerance.`)
}

function solveNative(module: NativeSketchSolverModule, system: FlatSketchSystemInput) {
  return module.solveFlatSystem(
    system.parameterMetadata,
    system.parameterValues,
    system.entityRecords,
    system.constraintRecords,
    system.constraintValues,
    system.draggedParameters,
    system.solveGroup,
    system.calculateFailedConstraints ?? true,
  )
}

function runAbiRejectionEvidence(module: NativeSketchSolverModule) {
  const base = createLineFixture("under").system
  const duplicateMetadata = new Uint32Array(base.parameterMetadata)
  duplicateMetadata[2] = duplicateMetadata[0] as number
  const unknownEntityType = new Uint32Array(base.entityRecords)
  unknownEntityType[2] = 42

  const results = {
    duplicateHandle: solveNative(module, { ...base, parameterMetadata: duplicateMetadata })
      .abiStatus,
    unknownEntityType: solveNative(module, { ...base, entityRecords: unknownEntityType }).abiStatus,
    unknownReference: solveNative(module, {
      ...base,
      draggedParameters: new Uint32Array([99_999]),
    }).abiStatus,
  }
  requireCondition(results.duplicateHandle === -5, "Native ABI accepted a duplicate handle.")
  requireCondition(results.unknownEntityType === -6, "Native ABI accepted an unknown entity type.")
  requireCondition(results.unknownReference === -4, "Native ABI accepted an unknown reference.")
  return results
}

function runStatusEvidence(session: SketchSolverSession) {
  const under = session.solve(createLineFixture("under").system)
  requireCondition(
    under.status === "under-constrained",
    "Under-constrained fixture was misclassified.",
  )

  const fully = session.solve(createLineFixture("fully").system)
  requireCondition(
    fully.status === "fully-constrained",
    "Fully constrained fixture was misclassified.",
  )
  requireCondition(fully.maximumResidual <= 1e-7, "Fully constrained residual exceeded tolerance.")
  requireCondition(Math.abs(distance(fully.parameterValues) - 30) <= 1e-7, "Distance drifted.")

  const over = session.solve(createLineFixture("over").system)
  requireCondition(
    over.status === "over-constrained",
    "Over-constrained fixture was misclassified.",
  )
  requireCondition(over.failedConstraintHandles.length > 0, "Conflict set was empty.")
  return { fully, over, under }
}

function runPointAlignmentConflictEvidence(session: SketchSolverSession) {
  const fixture = createPointAlignmentConflictFixture()
  const result = session.solve(fixture.system)
  requireCondition(result.status === "over-constrained", "Point alignment conflict was not found.")
  requireCondition(
    result.failedConstraintHandles.includes(fixture.alignmentConstraintHandle),
    "Point alignment handle was missing from the conflict set.",
  )
  return result
}

function runCoverageEvidence(session: SketchSolverSession) {
  const fixtures = createConstraintCoverageFixtures()
  const results = fixtures.map((fixture) => {
    const result = session.solve(fixture.system)
    requireSuccessfulSolve(result, fixture.name)
    return {
      name: fixture.name,
      constraintTypes: fixture.constraintTypes,
      status: result.status,
      maximumResidual: result.maximumResidual,
    }
  })
  return { fixtures, results }
}

function runConstraintPerturbations(
  session: SketchSolverSession,
  fixtures: ReturnType<typeof createConstraintCoverageFixtures>,
) {
  let maximumResidual = 0
  for (const fixture of fixtures) {
    for (let index = 0; index < 100; index += 1) {
      const result = session.solve(perturbSystem(fixture.system, index + 1))
      requireSuccessfulSolve(result, `${fixture.name} perturbation ${index}`)
      maximumResidual = Math.max(maximumResidual, result.maximumResidual)
    }
  }
  requireCondition(maximumResidual > 0, "Residual capture did not observe a solved equation error.")
  return maximumResidual
}

function runCanonicalLinePerturbations(session: SketchSolverSession) {
  let maximumResidual = 0
  for (let index = 0; index < 100; index += 1) {
    const perturbation = ((index * 37) % 101) / 10 - 5
    const result = session.solve(createLineFixture("fully", perturbation).system)
    requireCondition(result.status === "fully-constrained", `Perturbation ${index} did not solve.`)
    requireCondition(Math.abs(distance(result.parameterValues) - 30) <= 1e-7, "Distance drifted.")
    maximumResidual = Math.max(maximumResidual, result.maximumResidual)
  }
  return maximumResidual
}

function runLifecycleEvidence(
  nativeModule: NativeSketchSolverModule,
  session: SketchSolverSession,
) {
  const heapBeforeBytes = nativeModule.getHeapCapacityBytes()
  const solveTimes: number[] = []
  for (let index = 0; index < 1_000; index += 1) {
    const cycle = new SketchSolverSession(nativeModule)
    const solveStartedAt = performance.now()
    const result = cycle.solve(createLineFixture("fully", (index % 17) / 100).system)
    solveTimes.push(performance.now() - solveStartedAt)
    requireCondition(result.status === "fully-constrained", `Lifecycle cycle ${index} failed.`)
    cycle.dispose()
  }
  const heapAfterBytes = nativeModule.getHeapCapacityBytes()
  requireCondition(
    heapAfterBytes <= heapBeforeBytes * 2,
    `WASM heap grew unexpectedly from ${heapBeforeBytes} to ${heapAfterBytes} bytes.`,
  )
  session.dispose()
  return { heapAfterBytes, heapBeforeBytes, solveTimes }
}

async function main() {
  assertLocalSolveSpaceBuild()
  const initializationStartedAt = performance.now()
  const nativeModule = await loadNativeModule()
  const initializationMs = performance.now() - initializationStartedAt
  const session = new SketchSolverSession(nativeModule)
  const startedAt = performance.now()
  const abiRejections = runAbiRejectionEvidence(nativeModule)

  const { fully, over, under } = runStatusEvidence(session)
  const pointAlignmentConflict = runPointAlignmentConflictEvidence(session)
  const { fixtures: coverageFixtures, results: constraintCoverage } = runCoverageEvidence(session)
  const largestConstraintPerturbationResidual = runConstraintPerturbations(
    session,
    coverageFixtures,
  )

  const degenerate = session.solve(createDegenerateLineFixture())
  requireCondition(
    new Set(["failed", "under-constrained"]).has(degenerate.status),
    `Degenerate line returned the unexpected status ${degenerate.status}.`,
  )

  const largestPerturbationResidual = runCanonicalLinePerturbations(session)
  const { heapAfterBytes, heapBeforeBytes, solveTimes } = runLifecycleEvidence(
    nativeModule,
    session,
  )

  const report = {
    schemaVersion: 1,
    sourceRevision: SOLVESPACE_BUILD_INPUTS.sources.solvespace.revision,
    initializationMs,
    durationMs: Number((performance.now() - startedAt).toFixed(3)),
    abiRejections,
    statusClassification: {
      fullyConstrained: fully.status,
      underConstrained: under.status,
      overConstrained: over.status,
      conflictSet: [...over.failedConstraintHandles],
      pointAlignmentConflictSet: [...pointAlignmentConflict.failedConstraintHandles],
    },
    constraintCoverage,
    degenerateGeometry: {
      status: degenerate.status,
      maximumResidual: degenerate.maximumResidual,
    },
    perturbations: {
      canonicalLineCount: 100,
      canonicalLineMaximumResidual: largestPerturbationResidual,
      constraintCorpusCases: coverageFixtures.length,
      constraintCorpusCount: coverageFixtures.length * 100,
      constraintCorpusMaximumResidual: largestConstraintPerturbationResidual,
    },
    lifecycle: {
      cycles: 1_000,
      heapBeforeBytes,
      heapAfterBytes,
      solveP50Ms: percentile(solveTimes, 0.5),
      solveP95Ms: percentile(solveTimes, 0.95),
      solveMaximumMs: Math.max(...solveTimes),
    },
  }
  mkdirSync(artifactRoot, { recursive: true })
  writeFileSync(join(artifactRoot, "evidence-report.json"), `${JSON.stringify(report, null, 2)}\n`)
  console.log(JSON.stringify(report, null, 2))
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Unknown SolveSpace evidence failure.")
  process.exitCode = 1
})
