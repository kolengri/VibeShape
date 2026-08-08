import { GEOMETRY_MEMORY_STAGES, type GeometryWorkerResponse } from "../../packages/protocol/src"
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

test.setTimeout(120_000)

const controlledOcctMode = process.env.VIBESHAPE_CONTROLLED_OCCT === "1"
const controlledOcctSourceRevision = OCCT_BUILD_INPUTS.sources.occt.revision

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

test("executes the OCCT modeling and exchange spike inside a Web Worker", async ({
  page,
}, testInfo) => {
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

  await page.goto(
    `/spikes/geometry-worker.html?lifecycleIterations=${String(lifecycleIterations)}&lifecycleBatches=${String(lifecycleBatches)}`,
  )

  const status = page.getByRole("status")
  await expect(status).toHaveAttribute("data-state", "passed", { timeout: 120_000 })

  const spike = await page.evaluate<GeometrySpikeHarnessState>(() =>
    Reflect.get(globalThis, "__VIBESHAPE_GEOMETRY_SPIKE__"),
  )
  const result = requireResult(spike.result)

  expect(spike.error).toBeNull()

  const expectedEngine = {
    adapter: "replicad",
    adapterVersion: controlledOcctMode ? "spike-controlled-1" : "spike-2",
    replicadVersion: "0.23.1",
    opencascadePackageVersion: controlledOcctMode
      ? `controlled-${controlledOcctSourceRevision.slice(0, 12)}`
      : "0.23.0",
    opencascadeSourceRevision: controlledOcctMode ? controlledOcctSourceRevision : null,
  }
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
  expect(result.exchange.stlBytes).toBeGreaterThanOrEqual(
    kernelSpikeExpectedInvariants.minimumBinaryStlBytes,
  )
  expect(result.exchange.importedShape.valid).toBe(true)
  expect(result.exchange.importedShape.solidCount).toBe(1)
  expect(result.exchange.relativeVolumeError).toBeLessThanOrEqual(
    kernelSpikeExpectedInvariants.maximumRelativeStepVolumeError,
  )

  expect(result.lifecycle.iterations).toBe(lifecycleIterations)
  expect(result.lifecycle.ownedShapesAfter).toBe(result.lifecycle.ownedShapesBefore)
  expect(spike.results).toHaveLength(lifecycleBatches)
  expect(spike.results.every(hasBalancedOwnership)).toBe(true)
  expect(result.memory.snapshots.map((snapshot) => snapshot.stage)).toEqual(GEOMETRY_MEMORY_STAGES)
  expect(result.memory.snapshots.every((snapshot) => snapshot.heapCapacityBytes > 0)).toBe(true)
  expect(result.memory.source).toBe(
    controlledOcctMode ? "allocator-instrumented" : "heap-capacity-only",
  )
  expect(
    result.memory.snapshots.every((snapshot) =>
      controlledOcctMode ? snapshot.allocator !== null : snapshot.allocator === null,
    ),
  ).toBe(true)
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
  expect(spike.progress).toEqual(
    Array.from({ length: lifecycleBatches }, () => expectedProgress).flat(),
  )
  expect(spike.health).toMatchObject({ initialized: true, ownedShapeCount: 0 })
  expect(spike.disposal).toMatchObject({ ownedShapeCount: 0 })
  const restart = requireResult(spike.restart)
  expect(restart.beforeTermination).toMatchObject({ initialized: true, ownedShapeCount: 0 })
  expect(restart.afterInitialization).toMatchObject({ initialized: true, ownedShapeCount: 0 })
  expect(restart.afterInitialization.wasmHeapBytes).toBeLessThanOrEqual(
    restart.beforeTermination.wasmHeapBytes,
  )
  expect(restart.result.shape.valid).toBe(true)
  expect(restart.result.shape.solidCount).toBe(1)
  expect(restart.result.shape.volume).toBeCloseTo(result.shape.volume, 6)
  expect(restart.result.engine).toMatchObject(expectedEngine)
  expect(restart.result.memory.source).toBe(
    controlledOcctMode ? "allocator-instrumented" : "heap-capacity-only",
  )
  expect(restart.result.lifecycle).toMatchObject({
    iterations: 1,
    ownedShapesBefore: 2,
    ownedShapesAfter: 2,
  })
  expect(restart.disposal).toMatchObject({ ownedShapeCount: 0 })

  const evidence = {
    engine: result.engine,
    shape: result.shape,
    mesh: {
      vertexCount: result.mesh.positions.length / 3,
      triangleCount: result.mesh.indices.length / 3,
    },
    exchange: result.exchange,
    lifecycle: spike.results.map((batch) => batch.lifecycle),
    memory: spike.results.map((batch) => batch.memory),
    timings: result.timings,
    health: spike.health,
    disposal: spike.disposal,
    restart,
  }
  await testInfo.attach("geometry-worker-evidence", {
    body: JSON.stringify(evidence, null, 2),
    contentType: "application/json",
  })
})
