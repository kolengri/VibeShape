import {
  type FeatureContentEnvironment,
  GEOMETRY_MEMORY_STAGES,
  GEOMETRY_PROTOCOL_VERSION,
  type GeometryEngineMetadata,
  type GeometryProgressStage,
  type GeometryWorkerRequest,
  type GeometryWorkerResponse,
  geometryWorkerRequestSchema,
  type KernelSpikeEngineResult,
  type KernelSpikeParameters,
  serializeFeatureContentIdentity,
  type TopologySpikeParameters,
} from "@vibeshape/protocol"
import { createKernelSpikeParameters } from "@vibeshape/test-models"
import { describe, expect, it } from "vitest"
import type {
  FeatureEvaluationInput,
  FeatureEvaluationResult,
  GeometryKernelEngine,
} from "./engine"
import { type GeometryWorkerEndpoint, GeometryWorkerRuntime } from "./runtime"

const featureContentEnvironment: FeatureContentEnvironment = {
  schemaVersion: 0,
  hostApiVersion: "0.1.0",
  geometry: {
    adapterId: "org.vibeshape.geometry.replicad",
    adapterVersion: "spike-2",
    kernelId: "org.opencascade.occt",
    kernelVersion: "0.23.0",
    kernelSourceRevision: null,
  },
  modelingTolerancePolicyVersion: 1,
  provider: { kind: "built-in" },
}

const boxFeatureType = {
  moduleId: "org.vibeshape.core.part-design",
  moduleVersion: "0.1.0",
  typeId: "org.vibeshape.feature.part-design.box",
  schemaVersion: 1,
} as const

const engineMetadata: GeometryEngineMetadata = {
  adapter: "replicad",
  adapterVersion: "spike-2",
  replicadVersion: "0.23.1",
  opencascadePackageVersion: "0.23.0",
  opencascadeSourceRevision: null,
  wasmBytes: 1,
  initializedInMs: 1,
  featureContentEnvironment,
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
    history: {
      booleanCut: {
        vertices: createHistoryStats(),
        edges: createHistoryStats(),
        faces: createHistoryStats(),
        solids: createHistoryStats(),
      },
      fillet: {
        vertices: createHistoryStats(),
        edges: createHistoryStats(),
        faces: createHistoryStats(),
      },
    },
    topologyCandidates: [],
    mesh: {
      positions: new Float32Array([0, 0, 0]),
      normals: new Float32Array([0, 0, 1]),
      indices: new Uint32Array([0, 0, 0]),
      triangleFaceIds: new Uint32Array([1]),
    },
    exchange: {
      stepBytes: 1,
      stepFile: new Uint8Array([1]),
      stlBytes: 84,
      importedShape: shape,
      relativeVolumeError: 0,
    },
    lifecycle: {
      operation: "boolean-cut",
      iterations: 1,
      ownedShapesBefore: 0,
      ownedShapesAfter: 0,
      wasmHeapBytesBefore: 1,
      wasmHeapBytesAfter: 1,
      wasmHeapGrowthBytes: 0,
      allocatorPurge: { requested: false, releasedBlocks: 0 },
    },
    memory: {
      source: "heap-capacity-only",
      snapshots: GEOMETRY_MEMORY_STAGES.map((stage) => ({
        stage,
        heapCapacityBytes: 1,
        allocator: null,
      })),
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

function createHistoryStats() {
  return {
    sourceCount: 1,
    modifiedSourceCount: 0,
    modifiedRelationCount: 0,
    generatedSourceCount: 0,
    generatedRelationCount: 0,
    deletedSourceCount: 0,
  }
}

class FakeEngine implements GeometryKernelEngine {
  initialized = false
  runCount = 0
  featureRunCount = 0
  disposalError: Error | null = null
  featureFailure: Extract<FeatureEvaluationResult, { ok: false }> | null = null

  async initialize() {
    this.initialized = true
    return engineMetadata
  }

  isInitialized() {
    return this.initialized
  }

  getFeatureContentEnvironment() {
    return this.initialized ? featureContentEnvironment : null
  }

  async evaluateFeature(
    _input: FeatureEvaluationInput,
    reportProgress: (stage: GeometryProgressStage, fraction: number) => void,
  ): Promise<FeatureEvaluationResult> {
    this.featureRunCount += 1
    reportProgress("feature-validation", 0.1)
    if (this.featureFailure) return this.featureFailure
    reportProgress("feature-evaluation", 0.35)
    reportProgress("feature-tessellation", 0.7)
    reportProgress("complete", 1)
    const result = createKernelResult()
    return {
      ok: true,
      result: {
        engine: result.engine,
        shape: result.shape,
        topologyCandidates: result.topologyCandidates,
        mesh: result.mesh,
        cache: { brepHit: false },
        timings: { evaluationMs: 1, tessellationMs: 1, totalMs: 2 },
      },
    }
  }

  async exportDocument() {
    return { file: new Uint8Array([1]), bodyCount: 1 }
  }

  async exportPrintMeshes() {
    return { meshes: [] }
  }

  async runKernelSpike(
    _parameters: KernelSpikeParameters,
    reportProgress: (stage: GeometryProgressStage, fraction: number) => void,
  ) {
    this.runCount += 1
    reportProgress("creating-primitives", 0.1)
    return createKernelResult()
  }

  async runTopologySpike(_parameters: TopologySpikeParameters) {
    this.runCount += 1
    const result = createKernelResult()
    return {
      engine: result.engine,
      shape: result.shape,
      topologyCandidates: result.topologyCandidates,
    }
  }

  getHealth() {
    return { initialized: this.initialized, ownedShapeCount: 0, wasmHeapBytes: 1 }
  }

  synchronizeDocumentFeatures(
    _documentId: string,
    retainedFeatures: readonly { featureId: string; contentHash: string }[],
  ) {
    return retainedFeatures.length
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

function createTopologyRunRequest(requestId: string): GeometryWorkerRequest {
  return {
    ...createEnvelope(requestId),
    type: "runTopologySpike",
    parameters: {
      boxSize: [60, 40, 20],
      holeCount: 2,
      holeRadius: 6,
      holeSpacing: 10,
      holeCenter: [0, 0],
      filletRadius: 1.5,
    },
  }
}

function boxContent(environment: FeatureContentEnvironment = featureContentEnvironment) {
  return {
    schemaVersion: 0,
    feature: {
      schemaVersion: 0,
      type: boxFeatureType,
      parameters: { width: 20, depth: 30, height: 25.4, centered: true },
      inputs: [],
      references: [],
    },
    environment,
  } as const
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("")
}

async function createFeatureRunRequest(
  requestId: string,
  options: {
    content?: ReturnType<typeof boxContent>
    contentHash?: string
    generation?: number
  } = {},
) {
  const content = options.content ?? boxContent()
  return geometryWorkerRequestSchema.parse({
    ...createEnvelope(requestId, options.generation),
    type: "evaluateFeature",
    featureId: "0195b5ac-b220-7a2c-8c33-67a36a7f3101",
    content,
    contentHash: options.contentHash ?? (await sha256(serializeFeatureContentIdentity(content))),
    dependencies: [],
    mesh: { chordTolerance: 0.05, angularTolerance: 0.1 },
  })
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

    await runtime.handle({
      ...createEnvelope("invalid"),
      type: "healthCheck",
      protocolVersion: GEOMETRY_PROTOCOL_VERSION + 1,
    })

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

  it("initializes, reports progress, and transfers mesh and STEP buffers", async () => {
    const { messages, runtime, transfers } = createHarness()

    await runtime.handle({ ...createEnvelope("initialize"), type: "initializeEngine" })
    await runtime.handle(createRunRequest("run"))

    expect(messages.map((message) => message.type)).toEqual([
      "progress",
      "initialized",
      "progress",
      "kernelSpikeCompleted",
    ])
    expect(transfers.at(-1)).toHaveLength(5)
    expect(transfers.at(-1)?.every((transfer) => transfer instanceof ArrayBuffer)).toBe(true)
  })

  it("runs the topology corpus command without transferable native payloads", async () => {
    const { messages, runtime, transfers } = createHarness()

    await runtime.handle({ ...createEnvelope("initialize"), type: "initializeEngine" })
    await runtime.handle(createTopologyRunRequest("topology"))

    expect(messages.at(-1)).toMatchObject({ type: "topologySpikeCompleted" })
    expect(transfers.at(-1)).toHaveLength(0)
  })

  it("verifies and evaluates canonical primitive feature content with transferable meshes", async () => {
    const { engine, messages, runtime, transfers } = createHarness()

    await runtime.handle({ ...createEnvelope("initialize"), type: "initializeEngine" })
    await runtime.handle(await createFeatureRunRequest("feature"))

    expect(engine.featureRunCount).toBe(1)
    expect(messages.map(({ type }) => type)).toEqual([
      "progress",
      "initialized",
      "progress",
      "progress",
      "progress",
      "progress",
      "featureEvaluated",
    ])
    expect(messages.at(-1)).toMatchObject({
      type: "featureEvaluated",
      featureId: "0195b5ac-b220-7a2c-8c33-67a36a7f3101",
      cache: { brepHit: false },
    })
    expect(transfers.at(-1)).toHaveLength(4)
  })

  it("rejects mismatched feature environments and hashes before engine execution", async () => {
    const { engine, messages, runtime } = createHarness()
    await runtime.handle({ ...createEnvelope("initialize"), type: "initializeEngine" })

    await runtime.handle(
      await createFeatureRunRequest("wrong-environment", {
        content: boxContent({
          ...featureContentEnvironment,
          geometry: { ...featureContentEnvironment.geometry, adapterVersion: "other-build" },
        }),
      }),
    )
    expect(messages.at(-1)).toMatchObject({
      type: "failure",
      diagnostic: { code: "feature-content-environment-mismatch" },
    })

    await runtime.handle(
      await createFeatureRunRequest("wrong-hash", { contentHash: "f".repeat(64) }),
    )
    expect(messages.at(-1)).toMatchObject({
      type: "failure",
      diagnostic: { code: "feature-content-hash-mismatch" },
    })
    expect(engine.featureRunCount).toBe(0)
  })

  it("maps primitive evaluator failures to stable worker diagnostics", async () => {
    const { engine, messages, runtime } = createHarness()
    engine.featureFailure = {
      ok: false,
      diagnostic: {
        code: "unsupported-feature-type",
        message: "The feature type is unsupported.",
      },
    }
    await runtime.handle({ ...createEnvelope("initialize"), type: "initializeEngine" })
    await runtime.handle(await createFeatureRunRequest("feature"))

    expect(messages.at(-1)).toMatchObject({
      type: "failure",
      diagnostic: { code: "unsupported-feature-type", stage: "feature-validation" },
    })
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
