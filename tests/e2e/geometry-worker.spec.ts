import { createHash } from "node:crypto"
import { mkdirSync, writeFileSync } from "node:fs"
import {
  GEOMETRY_PROTOCOL_VERSION,
  GEOMETRY_MEMORY_STAGES,
  type GeometryLifecycleOperation,
  type GeometryWorkerResponse,
  geometryLifecycleOperationSchema,
} from "../../packages/protocol/src"
import {
  createKernelSpikeParameters,
  kernelSpikeExpectedInvariants,
} from "../../packages/test-models/src"
import { OCCT_BUILD_INPUTS } from "../../scripts/occt-build-config"
import { expect, test } from "./fixtures"

type KernelResponse = Extract<GeometryWorkerResponse, { type: "kernelSpikeCompleted" }>
type HealthResponse = Extract<GeometryWorkerResponse, { type: "health" }>
type DisposalResponse = Extract<GeometryWorkerResponse, { type: "documentDisposed" }>

interface GeometrySpikeHarnessState {
  result: KernelResponse | null
  results: KernelResponse[]
  health: HealthResponse | null
  disposal: DisposalResponse | null
  restart: {
    beforeTermination: HealthResponse
    afterInitialization: HealthResponse
    result: KernelResponse
    disposal: DisposalResponse
  } | null
  progress: string[]
  error: string | null
}

type RestartEvidence = NonNullable<GeometrySpikeHarnessState["restart"]>

test.setTimeout(120_000)

const controlledOcctMode = process.env.VIBESHAPE_CONTROLLED_OCCT === "1"
const controlledOcctSourceRevision = OCCT_BUILD_INPUTS.sources.occt.revision
const controlledOcctPostWarmupDriftCeilingBytes = 64 * 1024
const controlledOcctLifecycleGrowthCeilingBytes = 8 * 1024
const expectedProgress = [
  "creating-primitives",
  "boolean-cut",
  "fillet",
  "validation",
  "tessellation",
  "step-export",
  "step-import",
  "stl-export",
  "lifecycle-check",
  "complete",
]

function expectVectorClose(actual: number[], expected: number[], precision = 5) {
  expect(actual).toHaveLength(expected.length)

  for (const [index, expectedCoordinate] of expected.entries()) {
    expect(actual[index]).toBeCloseTo(expectedCoordinate, precision)
  }
}

function readBoundedEnvironmentInteger(name: string, fallback: number, maximum: number) {
  const value = Number(process.env[name] ?? fallback)

  if (!Number.isSafeInteger(value)) {
    throw new Error(`${name} must be an integer.`)
  }

  if (value < 1 || value > maximum) {
    throw new Error(`${name} must be between 1 and ${maximum}.`)
  }

  return value
}

function readLifecycleOperations(fallback: GeometryLifecycleOperation) {
  const values = (process.env.VIBESHAPE_GEOMETRY_LIFECYCLE_OPERATIONS ?? fallback).split(",")
  const operations = values.map((value) => geometryLifecycleOperationSchema.parse(value.trim()))

  if (new Set(operations).size !== operations.length) {
    throw new Error("VIBESHAPE_GEOMETRY_LIFECYCLE_OPERATIONS must not contain duplicates.")
  }

  return operations
}

function readBooleanEnvironment(name: string, fallback: boolean) {
  const value = process.env[name]

  if (value === undefined) {
    return fallback
  }

  if (value !== "0" && value !== "1") {
    throw new Error(`${name} must be 0 or 1.`)
  }

  return value === "1"
}

function requireResult<Result>(result: Result | null): Result {
  expect(result).not.toBeNull()

  if (result === null) {
    throw new Error("The geometry worker did not publish its completed result.")
  }

  return result
}

function hasBalancedOwnership(result: {
  lifecycle: { ownedShapesBefore: number; ownedShapesAfter: number }
}) {
  return result.lifecycle.ownedShapesAfter === result.lifecycle.ownedShapesBefore
}

function requireAllocatorSnapshot(result: KernelResponse, stage: string) {
  const snapshot = result.memory.snapshots.find((candidate) => candidate.stage === stage)
  expect(snapshot).toBeDefined()
  expect(snapshot?.allocator).not.toBeNull()

  if (!snapshot?.allocator) {
    throw new Error(`Controlled OCCT evidence omitted allocator metrics at ${stage}.`)
  }

  return snapshot.allocator
}

function createExpectedEngine() {
  return {
    adapter: "replicad",
    adapterVersion: controlledOcctMode ? "spike-controlled-1" : "spike-2",
    replicadVersion: "0.23.1",
    opencascadePackageVersion: controlledOcctMode
      ? `controlled-${controlledOcctSourceRevision.slice(0, 12)}`
      : "0.23.0",
    opencascadeSourceRevision: controlledOcctMode ? controlledOcctSourceRevision : null,
  }
}

function expectHistoryStatsConsistent(stats: {
  sourceCount: number
  modifiedSourceCount: number
  modifiedRelationCount: number
  generatedSourceCount: number
  generatedRelationCount: number
  deletedSourceCount: number
}) {
  expect(stats.sourceCount).toBeGreaterThan(0)
  expect(stats.modifiedSourceCount).toBeLessThanOrEqual(stats.sourceCount)
  expect(stats.modifiedRelationCount).toBeGreaterThanOrEqual(stats.modifiedSourceCount)
  expect(stats.generatedSourceCount).toBeLessThanOrEqual(stats.sourceCount)
  expect(stats.generatedRelationCount).toBeGreaterThanOrEqual(stats.generatedSourceCount)
  expect(stats.deletedSourceCount).toBeLessThanOrEqual(stats.sourceCount)
}

function expectOperationHistory(result: KernelResponse) {
  for (const stats of Object.values(result.history.booleanCut)) {
    expectHistoryStatsConsistent(stats)
  }

  for (const stats of Object.values(result.history.fillet)) {
    expectHistoryStatsConsistent(stats)
  }

  expect(result.history.booleanCut.edges.modifiedRelationCount).toBeGreaterThan(0)
  expect(result.history.booleanCut.edges.generatedRelationCount).toBeGreaterThan(0)
  expect(result.history.booleanCut.edges.deletedSourceCount).toBeGreaterThan(0)
  expect(result.history.booleanCut.faces.modifiedRelationCount).toBeGreaterThan(0)
  expect(result.history.booleanCut.faces.generatedRelationCount).toBeGreaterThan(0)
  expect(result.history.booleanCut.faces.deletedSourceCount).toBeGreaterThan(0)
  expect(result.history.booleanCut.solids.modifiedRelationCount).toBeGreaterThan(0)
  expect(result.history.booleanCut.solids.deletedSourceCount).toBeGreaterThan(0)
  expect(result.history.fillet.edges.generatedRelationCount).toBeGreaterThan(0)
  expect(result.history.fillet.faces.modifiedRelationCount).toBeGreaterThan(0)
}

function expectGeometryResult(
  result: KernelResponse,
  expectedEngine: ReturnType<typeof createExpectedEngine>,
) {
  expect(result.engine).toMatchObject(expectedEngine)
  expect(result.engine.wasmBytes).toBeGreaterThan(1_000_000)
  expect(result.shape.valid).toBe(true)
  expect(result.shape.solidCount).toBe(1)
  expect(result.shape.volume).toBeGreaterThan(kernelSpikeExpectedInvariants.minimumVolume)
  expect(result.shape.volume).toBeLessThan(kernelSpikeExpectedInvariants.maximumVolume)
  expect(result.shape.faceCount).toBeGreaterThanOrEqual(
    kernelSpikeExpectedInvariants.minimumFaceCount,
  )
  expect(result.shape.edgeCount).toBeGreaterThanOrEqual(
    kernelSpikeExpectedInvariants.minimumEdgeCount,
  )
  expectVectorClose(result.shape.bounds.min, [-30, -20, 0])
  expectVectorClose(result.shape.bounds.max, [30, 20, 20])
  expect(result.mesh.positions.length).toBeGreaterThan(0)
  expect(result.mesh.normals.length).toBe(result.mesh.positions.length)
  expect(result.mesh.indices.length).toBeGreaterThan(0)
  expect(result.mesh.indices.length % 3).toBe(0)
  expect(result.mesh.triangleFaceIds.length).toBe(result.mesh.indices.length / 3)
  expect(Math.max(...result.mesh.indices)).toBeLessThan(result.mesh.positions.length / 3)
  expect(result.exchange.stepBytes).toBeGreaterThan(kernelSpikeExpectedInvariants.minimumStepBytes)
  expect(result.exchange.stepFile).toBeInstanceOf(Uint8Array)
  expect(result.exchange.stepFile.byteLength).toBe(result.exchange.stepBytes)
  expect(result.exchange.stlBytes).toBeGreaterThanOrEqual(
    kernelSpikeExpectedInvariants.minimumBinaryStlBytes,
  )
  expect(result.exchange.importedShape).toMatchObject({ valid: true, solidCount: 1 })
  expect(result.exchange.relativeVolumeError).toBeLessThanOrEqual(
    kernelSpikeExpectedInvariants.maximumRelativeStepVolumeError,
  )
  expectOperationHistory(result)
}

function expectLifecycleEvidence(
  spike: GeometrySpikeHarnessState,
  result: KernelResponse,
  lifecycleIterations: number,
  lifecycleBatches: number,
  lifecycleOperation: GeometryLifecycleOperation,
  purgeAfterLifecycle: boolean,
) {
  expect(result.lifecycle.operation).toBe(lifecycleOperation)
  expect(result.lifecycle.iterations).toBe(lifecycleIterations)
  expect(result.lifecycle.ownedShapesAfter).toBe(result.lifecycle.ownedShapesBefore)
  expect(spike.results).toHaveLength(lifecycleBatches)
  expect(spike.results.every(hasBalancedOwnership)).toBe(true)
  expect(spike.results.every((batch) => batch.lifecycle.operation === lifecycleOperation)).toBe(
    true,
  )
  expect(
    spike.results.every(
      (batch) => batch.lifecycle.allocatorPurge.requested === purgeAfterLifecycle,
    ),
  ).toBe(true)
  expect(spike.progress).toEqual(
    Array.from({ length: lifecycleBatches }, () => expectedProgress).flat(),
  )
  expect(spike.health).toMatchObject({ initialized: true, ownedShapeCount: 0 })
  expect(spike.disposal).toMatchObject({ ownedShapeCount: 0 })
}

function expectMemoryEvidence(spike: GeometrySpikeHarnessState, result: KernelResponse) {
  expect(result.memory.snapshots.map((snapshot) => snapshot.stage)).toEqual(GEOMETRY_MEMORY_STAGES)
  expect(result.memory.snapshots.every((snapshot) => snapshot.heapCapacityBytes > 0)).toBe(true)
  expect(result.memory.source).toBe(
    controlledOcctMode ? "allocator-instrumented" : "heap-capacity-only",
  )

  if (!controlledOcctMode) {
    expect(result.memory.snapshots.every((snapshot) => snapshot.allocator === null)).toBe(true)
    return null
  }

  expect(result.memory.snapshots.every((snapshot) => snapshot.allocator !== null)).toBe(true)
  const firstResult = spike.results[0] ?? result
  const firstInitialized = requireAllocatorSnapshot(firstResult, "initialized")
  const firstDisposed = requireAllocatorSnapshot(firstResult, "shapes-disposed")
  const lastDisposed = requireAllocatorSnapshot(result, "shapes-disposed")
  const retainedDriftBytes = lastDisposed.allocatedBytes - firstDisposed.allocatedBytes
  const lifecycleGrowthBytes = spike.results.map((batch) => {
    const beforeLifecycle = requireAllocatorSnapshot(batch, "stl-exported")
    const afterLifecycle = requireAllocatorSnapshot(batch, "lifecycle-completed")
    return afterLifecycle.allocatedBytes - beforeLifecycle.allocatedBytes
  })

  expect(retainedDriftBytes).toBeLessThanOrEqual(controlledOcctPostWarmupDriftCeilingBytes)
  expect(
    lifecycleGrowthBytes.every(
      (growthBytes) => growthBytes <= controlledOcctLifecycleGrowthCeilingBytes,
    ),
  ).toBe(true)

  return {
    firstInitialized,
    firstDisposed,
    lastDisposed,
    retainedDriftBytes,
    postWarmupDriftCeilingBytes: controlledOcctPostWarmupDriftCeilingBytes,
    lifecycleGrowthBytes,
    lifecycleGrowthCeilingBytes: controlledOcctLifecycleGrowthCeilingBytes,
  }
}

function expectRestartEvidence(
  restart: RestartEvidence,
  result: KernelResponse,
  expectedEngine: ReturnType<typeof createExpectedEngine>,
  allocatorEvidence: ReturnType<typeof expectMemoryEvidence>,
  lifecycleOperation: GeometryLifecycleOperation,
  purgeAfterLifecycle: boolean,
) {
  expect(restart.beforeTermination).toMatchObject({ initialized: true, ownedShapeCount: 0 })
  expect(restart.afterInitialization).toMatchObject({ initialized: true, ownedShapeCount: 0 })
  expect(restart.afterInitialization.wasmHeapBytes).toBeLessThanOrEqual(
    restart.beforeTermination.wasmHeapBytes,
  )
  expect(restart.result.shape).toMatchObject({ valid: true, solidCount: 1 })
  expect(restart.result.shape.volume).toBeCloseTo(result.shape.volume, 6)
  expect(restart.result.engine).toMatchObject(expectedEngine)
  expect(restart.result.memory.source).toBe(
    controlledOcctMode ? "allocator-instrumented" : "heap-capacity-only",
  )

  if (controlledOcctMode) {
    const restartedAllocator = requireAllocatorSnapshot(restart.result, "initialized")
    expect(restartedAllocator.allocatedBytes).toBeLessThanOrEqual(1024 * 1024)
    expect(restartedAllocator).toEqual(allocatorEvidence?.firstInitialized)
  }

  expect(restart.result.lifecycle).toMatchObject({
    operation: lifecycleOperation,
    iterations: 1,
    ownedShapesBefore: 2,
    ownedShapesAfter: 2,
    allocatorPurge: { requested: purgeAfterLifecycle },
  })
  expect(restart.disposal).toMatchObject({ ownedShapeCount: 0 })
}

function createEvidence(
  spike: GeometrySpikeHarnessState,
  result: KernelResponse,
  restart: RestartEvidence,
  allocator: ReturnType<typeof expectMemoryEvidence>,
) {
  return {
    engine: result.engine,
    shape: result.shape,
    history: result.history,
    mesh: {
      vertexCount: result.mesh.positions.length / 3,
      triangleCount: result.mesh.indices.length / 3,
    },
    exchange: createExchangeEvidence(result),
    lifecycle: spike.results.map((batch) => batch.lifecycle),
    memory: spike.results.map((batch) => batch.memory),
    timings: result.timings,
    health: spike.health,
    disposal: spike.disposal,
    allocator,
    restart: {
      beforeTermination: restart.beforeTermination,
      afterInitialization: restart.afterInitialization,
      result: {
        engine: restart.result.engine,
        shape: restart.result.shape,
        exchange: createExchangeEvidence(restart.result),
        lifecycle: restart.result.lifecycle,
        memory: restart.result.memory,
        timings: restart.result.timings,
      },
      disposal: restart.disposal,
    },
  }
}

function createExchangeEvidence(result: KernelResponse) {
  return {
    stepBytes: result.exchange.stepBytes,
    stlBytes: result.exchange.stlBytes,
    importedShape: result.exchange.importedShape,
    relativeVolumeError: result.exchange.relativeVolumeError,
  }
}

function writeStepInteroperabilityFixture(result: KernelResponse) {
  const directory = ".artifacts/occt-build/step-interoperability"
  const stepFile = "vibeshape-kernel-fixture.step"
  const stepPath = `${directory}/${stepFile}`
  const producerReport = {
    schemaVersion: 1,
    protocolVersion: GEOMETRY_PROTOCOL_VERSION,
    producer: result.engine,
    shape: result.shape,
    step: {
      file: stepFile,
      bytes: result.exchange.stepFile.byteLength,
      sha256: createHash("sha256").update(result.exchange.stepFile).digest("hex"),
    },
  }

  mkdirSync(directory, { recursive: true })
  writeFileSync(stepPath, result.exchange.stepFile)
  writeFileSync(`${directory}/producer-report.json`, `${JSON.stringify(producerReport, null, 2)}\n`)
}

const defaultParameters = createKernelSpikeParameters()
const lifecycleIterations = readBoundedEnvironmentInteger(
  "VIBESHAPE_GEOMETRY_LIFECYCLE_ITERATIONS",
  defaultParameters.lifecycleIterations,
  1_000,
)
const lifecycleBatches = readBoundedEnvironmentInteger(
  "VIBESHAPE_GEOMETRY_LIFECYCLE_BATCHES",
  1,
  10,
)
const lifecycleOperations = readLifecycleOperations(defaultParameters.lifecycleOperation)
const purgeAfterLifecycle = readBooleanEnvironment(
  "VIBESHAPE_GEOMETRY_PURGE_AFTER_LIFECYCLE",
  defaultParameters.purgeAfterLifecycle,
)
const stepInteroperabilityMode = readBooleanEnvironment("VIBESHAPE_STEP_INTEROPERABILITY", false)

for (const lifecycleOperation of lifecycleOperations) {
  const scenarioName = `${lifecycleOperation}${purgeAfterLifecycle ? ", allocator purge" : ""}`
  const evidenceName = `${lifecycleOperation}${purgeAfterLifecycle ? "-purged" : ""}`

  test(`executes the OCCT modeling and exchange spike inside a Web Worker (${scenarioName})`, async ({
    page,
  }, testInfo) => {
    await page.goto(
      `/spikes/geometry-worker.html?lifecycleIterations=${String(lifecycleIterations)}&lifecycleBatches=${String(lifecycleBatches)}&lifecycleOperation=${lifecycleOperation}&purgeAfterLifecycle=${String(purgeAfterLifecycle)}`,
    )

    const status = page.getByRole("status")
    await expect(status).not.toHaveAttribute("data-state", "running", { timeout: 120_000 })
    await expect(status).toHaveAttribute("data-state", "passed")

    const spike = await page.evaluate<GeometrySpikeHarnessState>(() =>
      Reflect.get(globalThis, "__VIBESHAPE_GEOMETRY_SPIKE__"),
    )
    const result = requireResult(spike.result)
    expect(spike.error).toBeNull()

    const expectedEngine = createExpectedEngine()
    expectGeometryResult(result, expectedEngine)

    if (stepInteroperabilityMode) {
      writeStepInteroperabilityFixture(result)
    }

    expectLifecycleEvidence(
      spike,
      result,
      lifecycleIterations,
      lifecycleBatches,
      lifecycleOperation,
      purgeAfterLifecycle,
    )
    const controlledAllocatorEvidence = expectMemoryEvidence(spike, result)
    const restart = requireResult(spike.restart)
    expectRestartEvidence(
      restart,
      result,
      expectedEngine,
      controlledAllocatorEvidence,
      lifecycleOperation,
      purgeAfterLifecycle,
    )

    const evidenceJson = JSON.stringify(
      createEvidence(spike, result, restart, controlledAllocatorEvidence),
      null,
      2,
    )

    if (controlledOcctMode) {
      mkdirSync(".artifacts/occt-build", { recursive: true })
      writeFileSync(
        `.artifacts/occt-build/geometry-worker-evidence-${evidenceName}.json`,
        `${evidenceJson}\n`,
      )
    }

    await testInfo.attach("geometry-worker-evidence", {
      body: evidenceJson,
      contentType: "application/json",
    })
  })
}
