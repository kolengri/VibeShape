import {
  GEOMETRY_PROTOCOL_VERSION,
  type GeometryEngineMetadata,
  type GeometryProgressStage,
  type GeometryWorkerRequest,
  type GeometryWorkerResponse,
  type KernelSpikeEngineResult,
  type KernelSpikeParameters,
} from "@vibeshape/protocol"
import { createKernelSpikeParameters } from "@vibeshape/test-models"
import { describe, expect, it } from "vitest"
import type { GeometryKernelEngine } from "./engine"
import { type GeometryWorkerEndpoint, GeometryWorkerRuntime } from "./runtime"

const engineMetadata: GeometryEngineMetadata = {
  adapter: "replicad",
  adapterVersion: "spike-1",
  replicadVersion: "0.23.1",
  opencascadePackageVersion: "0.23.0",
  opencascadeSourceRevision: null,
  wasmBytes: 1,
  initializedInMs: 1,
}

function createKernelResult(): KernelSpikeEngineResult {
  const shape = {
    valid: true,
    volume: 1,
    surfaceArea: 6,
    bounds: {
      min: [0, 0, 0] as [number, number, number],
      max: [1, 1, 1] as [number, number, number],
    },
    faceCount: 6,
    edgeCount: 12,
    solidCount: 1,
  }

  return {
    engine: engineMetadata,
    shape,
    mesh: {
      positions: new Float32Array([0, 0, 0]),
      normals: new Float32Array([0, 0, 1]),
      indices: new Uint32Array([0, 0, 0]),
      triangleFaceIds: new Uint32Array([1]),
    },
    exchange: {
      stepBytes: 1,
      stlBytes: 84,
      importedShape: shape,
      relativeVolumeError: 0,
    },
    lifecycle: {
      iterations: 1,
      ownedShapesBefore: 0,
      ownedShapesAfter: 0,
      wasmHeapBytesBefore: 1,
      wasmHeapBytesAfter: 1,
      wasmHeapGrowthBytes: 0,
    },
    timings: {
      createPrimitivesMs: 1,
      booleanCutMs: 1,
      filletMs: 1,
      validationMs: 1,
      tessellationMs: 1,
      stepExportMs: 1,
      stepImportMs: 1,
      stlExportMs: 1,
      lifecycleCheckMs: 1,
      totalMs: 9,
    },
  }
}

class FakeEngine implements GeometryKernelEngine {
  initialized = false
  runCount = 0
  disposalError: Error | null = null

  async initialize() {
    this.initialized = true
    return engineMetadata
  }

  isInitialized() {
    return this.initialized
  }

  async runKernelSpike(
    _parameters: KernelSpikeParameters,
    reportProgress: (stage: GeometryProgressStage, fraction: number) => void,
  ) {
    this.runCount += 1
    reportProgress("creating-primitives", 0.1)
    return createKernelResult()
  }

  getHealth() {
    return { initialized: this.initialized, ownedShapeCount: 0, wasmHeapBytes: 1 }
  }

  disposeDocument(_documentId: string) {
    if (this.disposalError) {
      throw this.disposalError
    }

    return 0
  }
}

function createEnvelope(requestId: string, generation = 1) {
  return {
    protocolVersion: GEOMETRY_PROTOCOL_VERSION,
    requestId,
    documentId: "document-1",
    revision: 0,
    generation,
  } as const
}

function createRunRequest(requestId: string, generation = 1): GeometryWorkerRequest {
  return {
    ...createEnvelope(requestId, generation),
    type: "runKernelSpike",
    parameters: createKernelSpikeParameters(),
  }
}

function createHarness() {
  const messages: GeometryWorkerResponse[] = []
  const transfers: Transferable[][] = []
  const endpoint: GeometryWorkerEndpoint = {
    postMessage(message, transfer = []) {
      messages.push(message)
      transfers.push(transfer)
    },
  }
  const engine = new FakeEngine()

  return { engine, messages, runtime: new GeometryWorkerRuntime(engine, endpoint), transfers }
}

describe("GeometryWorkerRuntime", () => {
  it("rejects invalid and unsupported requests at the worker boundary", async () => {
    const { messages, runtime } = createHarness()

    await runtime.handle({ ...createEnvelope("invalid"), type: "healthCheck", protocolVersion: 2 })

    expect(messages).toHaveLength(1)
    expect(messages[0]).toMatchObject({
      type: "failure",
      diagnostic: { code: "unsupported-protocol-version" },
    })
  })

  it("requires initialization before kernel work", async () => {
    const { engine, messages, runtime } = createHarness()

    await runtime.handle(createRunRequest("run-before-init"))

    expect(engine.runCount).toBe(0)
    expect(messages.at(-1)).toMatchObject({
      type: "failure",
      diagnostic: { code: "engine-not-initialized" },
    })
  })

  it("initializes, reports progress, and transfers mesh buffers", async () => {
    const { messages, runtime, transfers } = createHarness()

    await runtime.handle({ ...createEnvelope("initialize"), type: "initializeEngine" })
    await runtime.handle(createRunRequest("run"))

    expect(messages.map((message) => message.type)).toEqual([
      "progress",
      "initialized",
      "progress",
      "kernelSpikeCompleted",
    ])
    expect(transfers.at(-1)).toHaveLength(4)
    expect(transfers.at(-1)?.every((transfer) => transfer instanceof ArrayBuffer)).toBe(true)
  })

  it("does not run work that was cancelled before dispatch", async () => {
    const { engine, messages, runtime } = createHarness()
    await runtime.handle({ ...createEnvelope("initialize"), type: "initializeEngine" })

    await runtime.handle({
      ...createEnvelope("cancel"),
      type: "cancel",
      targetRequestId: "cancelled-run",
    })
    expect(messages.at(-1)).toMatchObject({
      requestId: "cancel",
      type: "cancellationAccepted",
      targetRequestId: "cancelled-run",
    })
    await runtime.handle(createRunRequest("cancelled-run"))

    expect(engine.runCount).toBe(0)
    expect(messages.at(-1)).toMatchObject({
      requestId: "cancelled-run",
      type: "requestCancelled",
      reason: "cancelled",
    })
  })

  it("drops a request older than the latest document generation", async () => {
    const { engine, messages, runtime } = createHarness()
    await runtime.handle({ ...createEnvelope("initialize"), type: "initializeEngine" })
    await runtime.handle(createRunRequest("new-run", 2))
    await runtime.handle(createRunRequest("stale-run", 1))

    expect(engine.runCount).toBe(1)
    expect(messages.at(-1)).toMatchObject({
      requestId: "stale-run",
      type: "requestCancelled",
      reason: "stale-generation",
    })
  })

  it("converts unexpected queued failures into typed diagnostics", async () => {
    const { engine, messages, runtime } = createHarness()
    engine.disposalError = new Error("Native disposal failed.")

    await expect(
      runtime.handle({ ...createEnvelope("dispose"), type: "disposeDocument" }),
    ).resolves.toBeUndefined()
    expect(messages.at(-1)).toMatchObject({
      requestId: "dispose",
      type: "failure",
      diagnostic: { code: "internal-error", message: "Native disposal failed." },
    })
  })
})
