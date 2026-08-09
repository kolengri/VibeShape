import {
  booleanFeatureType,
  boxFeatureType,
  createLengthQuantity,
  cylinderFeatureType,
  type FeatureId,
  type FeatureRecord,
  featureIdSchema,
} from "@vibeshape/domain"
import type {
  FeatureEvaluationInput,
  FeatureEvaluationResult,
  GeometryKernelEngine,
} from "@vibeshape/geometry-worker/engine"
import {
  DOCUMENT_PROTOCOL_VERSION,
  type DocumentWorkerRequest,
  type DocumentWorkerResponse,
  documentRebuildSnapshotSchema,
  documentWorkerResponseSchema,
  type FeatureContentEnvironment,
  featureEvaluationEngineResultSchema,
  type GeometryEngineMetadata,
  type GeometryProgressStage,
} from "@vibeshape/protocol"
import { describe, expect, it } from "vitest"
import { type DocumentWorkerEndpoint, DocumentWorkerRuntime } from "./runtime"

const documentIds = {
  primary: "0195b5ac-b213-7f2c-9c33-67a36a7f21ac",
  other: "0195b5ac-b213-7f2c-9c33-67a36a7f21ad",
} as const
const featureIds = {
  box: featureIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f3101"),
  cylinder: featureIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f3102"),
  boolean: featureIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f3103"),
} as const
const environment: FeatureContentEnvironment = {
  schemaVersion: 0,
  hostApiVersion: "0.1.0",
  geometry: {
    adapterId: "org.vibeshape.geometry.fake",
    adapterVersion: "test-build",
    kernelId: "org.opencascade.occt",
    kernelVersion: "7.9.2",
    kernelSourceRevision: null,
  },
  modelingTolerancePolicyVersion: 1,
  provider: { kind: "built-in" },
}
const engineMetadata: GeometryEngineMetadata = {
  adapter: "replicad",
  adapterVersion: "test-build",
  replicadVersion: "0.23.1",
  opencascadePackageVersion: "0.23.0",
  opencascadeSourceRevision: null,
  wasmBytes: 1,
  initializedInMs: 1,
  featureContentEnvironment: environment,
}

function box(): FeatureRecord {
  return {
    schemaVersion: 0,
    id: featureIds.box,
    type: boxFeatureType.type,
    parameters: {
      width: createLengthQuantity(20),
      depth: createLengthQuantity(30),
      height: createLengthQuantity(40),
      centered: false,
    },
    dependencies: [],
    references: [],
    suppressed: false,
  }
}

function cylinder(height = 60): FeatureRecord {
  return {
    schemaVersion: 0,
    id: featureIds.cylinder,
    type: cylinderFeatureType.type,
    parameters: {
      radius: createLengthQuantity(5),
      height: createLengthQuantity(height),
      centered: true,
    },
    dependencies: [],
    references: [],
    suppressed: false,
  }
}

function boolean(): FeatureRecord {
  return {
    schemaVersion: 0,
    id: featureIds.boolean,
    type: booleanFeatureType.type,
    parameters: { operation: "subtract" },
    dependencies: [featureIds.box, featureIds.cylinder],
    references: [],
    suppressed: false,
  }
}

function document(documentId: string, revision = 1, cylinderHeight = 60) {
  return documentRebuildSnapshotSchema.parse({
    schemaVersion: 0,
    id: documentId,
    revision,
    name: "Runtime test",
    features: [boolean(), cylinder(cylinderHeight), box()],
    createdAt: "2026-08-09T00:00:00.000Z",
    updatedAt: "2026-08-09T00:00:00.000Z",
  })
}

function geometry() {
  return featureEvaluationEngineResultSchema.parse({
    engine: engineMetadata,
    shape: {
      valid: true,
      volume: 1,
      surfaceArea: 6,
      bounds: { min: [0, 0, 0], max: [1, 1, 1] },
      faceCount: 6,
      edgeCount: 12,
      solidCount: 1,
    },
    topologyCandidates: [],
    mesh: {
      positions: new Float32Array([0, 0, 0]),
      normals: new Float32Array([0, 0, 1]),
      indices: new Uint32Array([0, 0, 0]),
      triangleFaceIds: new Uint32Array([1]),
    },
    cache: { brepHit: false },
    timings: { evaluationMs: 1, tessellationMs: 1, totalMs: 2 },
  })
}

class FakeEngine implements GeometryKernelEngine {
  readonly evaluatedFeatureIds: FeatureId[] = []
  readonly evaluatedInputs: FeatureEvaluationInput[] = []
  initialized = false
  disposedDocuments: string[] = []
  exportedFeatures: Array<{ featureId: string; contentHash: string }[]> = []

  async initialize() {
    this.initialized = true
    return engineMetadata
  }

  isInitialized() {
    return this.initialized
  }

  getFeatureContentEnvironment() {
    return this.initialized ? environment : null
  }

  async evaluateFeature(
    input: FeatureEvaluationInput,
    reportProgress: (stage: GeometryProgressStage, fraction: number) => void,
  ): Promise<FeatureEvaluationResult> {
    this.evaluatedFeatureIds.push(featureIdSchema.parse(input.featureId))
    this.evaluatedInputs.push(input)
    reportProgress("feature-validation", 0.1)
    reportProgress("feature-evaluation", 0.35)
    reportProgress("feature-tessellation", 0.7)
    reportProgress("complete", 1)
    return { ok: true, result: geometry() }
  }

  async exportDocument(input: Parameters<GeometryKernelEngine["exportDocument"]>[0]) {
    this.exportedFeatures.push([...input.features])
    return {
      file: input.format === "step" ? new Uint8Array([1, 2, 3]) : new Uint8Array([4, 5]),
      bodyCount: input.features.length,
    }
  }

  async runKernelSpike(): Promise<never> {
    throw new Error("Kernel spikes are not used by the document worker.")
  }

  async runTopologySpike(): Promise<never> {
    throw new Error("Topology spikes are not used by the document worker.")
  }

  getHealth() {
    return { initialized: this.initialized, ownedShapeCount: 3, wasmHeapBytes: 1 }
  }

  disposeDocument(documentId: string) {
    this.disposedDocuments.push(documentId)
    return 0
  }
}

function request(
  requestId: string,
  options: { documentId?: string; revision?: number; generation?: number; height?: number } = {},
): DocumentWorkerRequest {
  const documentId = options.documentId ?? documentIds.primary
  const revision = options.revision ?? 1
  return {
    protocolVersion: DOCUMENT_PROTOCOL_VERSION,
    requestId,
    documentId,
    revision,
    generation: options.generation ?? 1,
    type: "rebuildDocument",
    document: document(documentId, revision, options.height),
    mesh: { chordTolerance: 0.05, angularTolerance: 0.1 },
  }
}

function createHarness() {
  const messages: DocumentWorkerResponse[] = []
  const transfers: Transferable[][] = []
  const engine = new FakeEngine()
  const endpoint: DocumentWorkerEndpoint = {
    postMessage(message, transfer = []) {
      messages.push(message)
      transfers.push(transfer)
    },
  }
  return { engine, messages, transfers, runtime: new DocumentWorkerRuntime(engine, endpoint) }
}

function rebuilt(messages: readonly DocumentWorkerResponse[], requestId: string) {
  const response = messages.find(
    (message) => message.requestId === requestId && message.type === "documentRebuilt",
  )
  expect(response?.type).toBe("documentRebuilt")
  if (response?.type !== "documentRebuilt") throw new Error("Expected a rebuilt document response.")
  return response
}

describe("DocumentWorkerRuntime", () => {
  it("owns incremental rebuild state and transfers cloned mesh buffers", async () => {
    const { engine, messages, runtime, transfers } = createHarness()

    await runtime.handle(request("initial"))
    await runtime.handle(request("clean"))
    await runtime.handle(request("changed", { revision: 2, height: 20 }))

    expect(engine.evaluatedFeatureIds).toEqual([
      featureIds.cylinder,
      featureIds.box,
      featureIds.boolean,
      featureIds.cylinder,
      featureIds.boolean,
    ])
    const initial = rebuilt(messages, "initial")
    expect(initial.evaluation.evaluatedFeatureIds).toEqual([
      featureIds.cylinder,
      featureIds.box,
      featureIds.boolean,
    ])
    expect(
      documentWorkerResponseSchema.safeParse({
        ...initial,
        geometry: initial.geometry.map((record, index) =>
          index === 0 ? { ...record, contentHash: "f".repeat(64) } : record,
        ),
      }).success,
    ).toBe(false)
    expect(rebuilt(messages, "clean").evaluation.reusedFeatureIds).toEqual([
      featureIds.cylinder,
      featureIds.box,
      featureIds.boolean,
    ])
    expect(rebuilt(messages, "changed").evaluation.evaluatedFeatureIds).toEqual([
      featureIds.cylinder,
      featureIds.boolean,
    ])
    expect(
      transfers.filter((transfer) => transfer.length > 0).map((transfer) => transfer.length),
    ).toEqual([12, 12, 12])
  })

  it("evaluates document variables before incremental geometry scheduling", async () => {
    const { engine, messages, runtime } = createHarness()
    const variableId = "0195b5ac-b240-7a2c-8c33-67a36a7f21ac"
    const authoredBox: FeatureRecord = {
      ...box(),
      parameters: {
        ...box().parameters,
        width: createLengthQuantity(20, "mm", "#width"),
      },
    }
    const rebuildRequest = (requestId: string, revision: number, expression: string) => ({
      ...request(requestId, { revision }),
      document: documentRebuildSnapshotSchema.parse({
        ...document(documentIds.primary, revision),
        variables: [{ schemaVersion: 0, id: variableId, name: "width", expression }],
        features: [authoredBox],
      }),
    })

    await runtime.handle(rebuildRequest("variable-initial", 1, "20 mm"))
    await runtime.handle(rebuildRequest("variable-changed", 2, "24 mm"))
    await runtime.handle(rebuildRequest("variable-equivalent", 3, "12 * 2 mm"))

    expect(engine.evaluatedInputs).toHaveLength(2)
    expect(engine.evaluatedInputs.map(({ content }) => content.feature.parameters)).toEqual([
      { width: 20, depth: 30, height: 40, centered: false },
      { width: 24, depth: 30, height: 40, centered: false },
    ])
    expect(rebuilt(messages, "variable-equivalent").evaluation.reusedFeatureIds).toEqual([
      featureIds.box,
    ])
  })

  it("isolates document state and disposes native ownership", async () => {
    const { engine, messages, runtime } = createHarness()
    await runtime.handle(request("primary"))
    await runtime.handle(request("other", { documentId: documentIds.other }))
    await runtime.handle({
      protocolVersion: DOCUMENT_PROTOCOL_VERSION,
      requestId: "health",
      documentId: documentIds.primary,
      revision: 1,
      generation: 1,
      type: "healthCheck",
    })
    await runtime.handle({
      protocolVersion: DOCUMENT_PROTOCOL_VERSION,
      requestId: "dispose",
      documentId: documentIds.primary,
      revision: 1,
      generation: 1,
      type: "disposeDocument",
    })

    expect(messages.find(({ requestId }) => requestId === "health")).toMatchObject({
      type: "health",
      activeDocuments: 2,
    })
    expect(engine.disposedDocuments).toEqual([documentIds.primary])
    expect(messages.at(-1)).toMatchObject({ type: "documentDisposed", ownedShapeCount: 0 })
  })

  it("exports only successful terminal bodies and transfers the exact file", async () => {
    const { engine, messages, runtime, transfers } = createHarness()
    await runtime.handle(request("rebuild-for-export"))
    await runtime.handle({
      protocolVersion: DOCUMENT_PROTOCOL_VERSION,
      requestId: "export-step",
      documentId: documentIds.primary,
      revision: 1,
      generation: 1,
      type: "exportDocument",
      format: "step",
    })

    const booleanRecord = rebuilt(messages, "rebuild-for-export").evaluation.records.find(
      ({ featureId }) => featureId === featureIds.boolean,
    )
    expect(booleanRecord?.status).toBe("succeeded")
    if (booleanRecord?.status !== "succeeded") throw new Error("Expected successful Boolean.")
    expect(engine.exportedFeatures).toEqual([
      [{ featureId: featureIds.boolean, contentHash: booleanRecord.contentHash }],
    ])
    expect(messages.at(-1)).toMatchObject({
      type: "documentExported",
      format: "step",
      file: new Uint8Array([1, 2, 3]),
      bodyCount: 1,
    })
    expect(transfers.at(-1)).toEqual([expect.any(ArrayBuffer)])
    const exportedTransfer = transfers.at(-1)?.[0]
    if (!(exportedTransfer instanceof ArrayBuffer)) throw new Error("Expected export transfer.")
    expect(exportedTransfer.byteLength).toBe(3)
  })

  it("rejects stale and empty export revisions without invoking the engine", async () => {
    const { engine, messages, runtime } = createHarness()
    await runtime.handle(request("rebuild-before-stale-export"))
    await runtime.handle({
      protocolVersion: DOCUMENT_PROTOCOL_VERSION,
      requestId: "stale-export",
      documentId: documentIds.primary,
      revision: 2,
      generation: 1,
      type: "exportDocument",
      format: "stl",
    })
    await runtime.handle({
      ...request("empty-rebuild", { documentId: documentIds.other }),
      document: documentRebuildSnapshotSchema.parse({
        ...document(documentIds.other),
        features: [],
      }),
    })
    await runtime.handle({
      protocolVersion: DOCUMENT_PROTOCOL_VERSION,
      requestId: "empty-export",
      documentId: documentIds.other,
      revision: 1,
      generation: 1,
      type: "exportDocument",
      format: "step",
    })

    expect(messages.find(({ requestId }) => requestId === "stale-export")).toMatchObject({
      type: "failure",
      diagnostic: { code: "export-state-unavailable", retryable: true },
    })
    expect(messages.find(({ requestId }) => requestId === "empty-export")).toMatchObject({
      type: "failure",
      diagnostic: { code: "no-exportable-bodies", retryable: false },
    })
    expect(engine.exportedFeatures).toEqual([])
  })

  it("drops queued stale generations before geometry evaluation", async () => {
    const { engine, messages, runtime } = createHarness()
    const stale = runtime.handle(request("stale", { generation: 1 }))
    const current = runtime.handle(request("current", { generation: 2 }))
    await Promise.all([stale, current])

    expect(messages.find(({ requestId }) => requestId === "stale")).toMatchObject({
      type: "failure",
      diagnostic: { code: "stale-generation" },
    })
    expect(rebuilt(messages, "current").evaluation.evaluatedFeatureIds).toHaveLength(3)
    expect(engine.evaluatedFeatureIds).toHaveLength(3)
  })

  it("preserves the generation watermark across queued disposal", async () => {
    const { engine, messages, runtime } = createHarness()
    const dispose = runtime.handle({
      protocolVersion: DOCUMENT_PROTOCOL_VERSION,
      requestId: "dispose-first",
      documentId: documentIds.primary,
      revision: 1,
      generation: 1,
      type: "disposeDocument",
    })
    const current = runtime.handle(request("after-dispose", { generation: 2 }))
    const stale = runtime.handle(request("stale-after-dispose", { generation: 1 }))
    await Promise.all([dispose, current, stale])

    expect(rebuilt(messages, "after-dispose").evaluation.evaluatedFeatureIds).toHaveLength(3)
    expect(messages.find(({ requestId }) => requestId === "stale-after-dispose")).toMatchObject({
      type: "failure",
      diagnostic: { code: "stale-generation" },
    })
    expect(engine.evaluatedFeatureIds).toHaveLength(3)
  })

  it("rejects unsupported protocol versions without invoking the engine", async () => {
    const { engine, messages, runtime } = createHarness()
    await runtime.handle({ ...request("invalid"), protocolVersion: 99 })

    expect(engine.initialized).toBe(false)
    expect(messages).toHaveLength(1)
    expect(messages[0]).toMatchObject({
      type: "failure",
      diagnostic: { code: "unsupported-protocol-version" },
    })

    await expect(
      runtime.handle({ ...request("invalid-document"), documentId: "not-a-document-id" }),
    ).resolves.toBeUndefined()
    expect(messages.at(-1)).toMatchObject({
      type: "failure",
      documentId: "00000000-0000-7000-8000-000000000000",
      diagnostic: { code: "invalid-request" },
    })
  })
})
