import { describe, expect, it } from "bun:test"
import { documentSnapshotSchema } from "@vibeshape/domain"
import {
  DOCUMENT_PROTOCOL_VERSION,
  type DocumentWorkerRequest,
  type DocumentWorkerTerminalResponse,
  documentRebuildSnapshotSchema,
  sourceAssetMaterializationsSchema,
} from "@vibeshape/protocol"
import { DocumentWorkerRequestError } from "./client-core"
import { inspectMeshSource } from "./mesh-source-import"
import {
  type DocumentWorkerClientPort,
  DocumentWorkerSession,
  type DocumentWorkerSessionOptions,
} from "./session-core"

const documentId = "0195b5ac-b213-7f2c-9c33-67a36a7f21ac"
const sketchId = "0195b5ac-b220-7a2c-8c33-67a36a7f3201"
const sketchPointId = "0195b5ac-b220-7a2c-8c33-67a36a7f3202"

function document(revision: number) {
  return {
    schemaVersion: 0,
    id: documentId,
    revision,
    name: "Session recovery test",
    displayUnits: { length: "mm", angle: "deg" },
    variables: [
      {
        schemaVersion: 0,
        id: "0195b5ac-b240-7a2c-8c33-67a36a7f21ac",
        name: "width",
        expression: "24 mm",
      },
    ],
    sketches: [
      {
        schemaVersion: 0,
        id: sketchId,
        label: "Session profile",
        plane: "xy",
        entities: [
          {
            schemaVersion: 0,
            id: sketchPointId,
            type: "point",
            x: 0,
            y: 0,
            construction: false,
          },
        ],
        constraints: [],
      },
    ],
    features: [],
    createdAt: "2026-08-09T00:00:00.000Z",
    updatedAt: "2026-08-09T00:00:00.000Z",
  } as const
}

const mesh = { chordTolerance: 0.05, angularTolerance: 0.1 } as const

function envelope(request: DocumentWorkerRequest) {
  return {
    protocolVersion: DOCUMENT_PROTOCOL_VERSION,
    requestId: request.requestId,
    documentId: request.documentId,
    revision: request.revision,
    generation: request.generation,
  } as const
}

function successfulResponse(request: DocumentWorkerRequest): DocumentWorkerTerminalResponse {
  if (request.type === "rebuildDocument") {
    return {
      ...envelope(request),
      type: "documentRebuilt",
      evaluation: {
        records: [],
        dirtyFeatureIds: [],
        evaluatedFeatureIds: [],
        reusedFeatureIds: [],
      },
      geometry: [],
      sketches: [],
      modelReferenceEvidence: [],
    }
  }
  if (request.type === "healthCheck") {
    return {
      ...envelope(request),
      type: "health",
      initialized: true,
      activeDocuments: 1,
      ownedShapeCount: 0,
      wasmHeapBytes: 1,
    }
  }
  if (request.type === "exportDocument") {
    return {
      ...envelope(request),
      type: "documentExported",
      format: request.format,
      file: new Uint8Array([1, 2, 3]),
      bodyCount: 1,
    }
  }
  if (request.type === "solveSketch") {
    const point = request.draggedPoints[0] ?? { entityId: sketchPointId, x: 0, y: 0 }
    return {
      ...envelope(request),
      type: "sketchSolved",
      solution: {
        schemaVersion: 0,
        sketchId: request.sketchId,
        sourceRevision: request.revision,
        status: "under-constrained",
        degreesOfFreedom: 2,
        maximumResidual: 1e-10,
        points: [point],
        circles: [],
        failedConstraintIds: [],
        profileResult: { schemaVersion: 0, profiles: [], loops: [], diagnostics: [] },
        heapCapacityBytes: 16 * 1024 * 1024,
        solverBuild: {
          schemaVersion: 0,
          solver: "SolveSpace",
          solverVersion: "3.2",
          sourceRevision: "27b6a080c8b669421bd4d444650c3b8eddec5687",
          abiVersion: 1,
          moduleSha256: "60c8714fbd5d94a50bdfcde7bd1658cfb2a180ad44be124997905ece7be545c7",
          wasmSha256: "c9e3e35084b3812e9eae7bdff8fd3290394918c88ba38504e58a9a9d4a2bd978",
        },
      },
    }
  }
  return { ...envelope(request), type: "documentDisposed", ownedShapeCount: 0 }
}

type RequestHandler = (
  request: DocumentWorkerRequest,
) => DocumentWorkerTerminalResponse | Promise<DocumentWorkerTerminalResponse>

class FakeClient implements DocumentWorkerClientPort {
  readonly requests: DocumentWorkerRequest[] = []
  terminated = false

  constructor(private readonly handler: RequestHandler = successfulResponse) {}

  async request(request: DocumentWorkerRequest) {
    this.requests.push(request)
    return this.handler(request)
  }

  terminate() {
    this.terminated = true
  }
}

function createHarness(
  handlers: readonly RequestHandler[] = [],
  options: DocumentWorkerSessionOptions = {},
) {
  const clients: FakeClient[] = []
  const session = new DocumentWorkerSession(
    documentId,
    () => {
      const client = new FakeClient(handlers[clients.length] ?? successfulResponse)
      clients.push(client)
      return client
    },
    options,
  )
  return { clients, session }
}

describe("DocumentWorkerSession", () => {
  it("keeps exact reconstruction on the active native session and never recovers transient face identities", async () => {
    const input = {
      source: {
        documentId,
        featureId: "0195b5ac-b220-7a2c-8c33-67a36a7f3101",
        contentHash: "a".repeat(64),
        outputRole: "result",
      },
      preserveFaceIds: [27],
      voxelGrid: {
        originMm: [0, 0, 0] as [number, number, number],
        cellSizeMm: 1,
        cells: [[0, 0, 0] as [number, number, number]],
      },
      sourceToPrintFrame: {
        originMm: [0, 0, 0] as [number, number, number],
        rotation: [0, 0, 0, 1] as [number, number, number, number],
      },
      protectedBoxes: [],
      preserveDepthMm: 2,
    }
    let fail = false
    const { clients, session } = createHarness([
      (request) => {
        if (request.type !== "reconstructPrintOptimization") return successfulResponse(request)
        if (fail)
          throw new DocumentWorkerRequestError("Native worker was replaced.", "worker-error")
        return {
          ...envelope(request),
          type: "printOptimizationReconstructed",
          reconstruction: {
            source: input.source,
            stepBytes: new Uint8Array([1]),
            verificationMesh: { positions: new Float64Array(12), indices: new Uint32Array(12) },
            sourceVolumeMm3: 2,
            volumeMm3: 1,
            preservedFaceCount: 1,
          },
        }
      },
    ])
    await session.rebuild({ document: document(3), mesh })
    const response = await session.reconstructPrintOptimization(input)
    expect(response.reconstruction.volumeMm3).toBe(1)
    expect(clients[0]?.requests.at(-1)).toMatchObject({
      type: "reconstructPrintOptimization",
      revision: 3,
      generation: 1,
      input,
    })
    fail = true
    await expect(session.reconstructPrintOptimization(input)).rejects.toThrow(
      "Native worker was replaced",
    )
    expect(clients.length).toBe(1)
    expect(clients[0]?.terminated).toBe(false)
    expect(
      clients[0]?.requests.filter((request) => request.type === "rebuildDocument").length,
    ).toBe(1)
  })

  it("accepts a complete domain snapshot with project display units", async () => {
    const { clients, session } = createHarness()
    const snapshot = documentSnapshotSchema.parse({
      ...document(1),
      displayUnits: { length: "in", angle: "rad" },
    })

    await session.rebuild({ document: snapshot, mesh })

    expect(clients[0]?.requests[0]).toMatchObject({
      type: "rebuildDocument",
      document: { displayUnits: { length: "in", angle: "rad" } },
    })
  })

  it("restarts from the last successfully rebuilt committed snapshot", async () => {
    const { clients, session } = createHarness([], { initialGeneration: 7 })

    await session.rebuild({ document: document(3), mesh })
    const recovered = await session.restartAndRecover()

    expect(session.generation).toBe(8)
    expect(clients).toHaveLength(2)
    expect(clients[0]?.terminated).toBe(true)
    expect(clients[0]?.requests[0]).toMatchObject({
      type: "rebuildDocument",
      revision: 3,
      generation: 7,
    })
    expect(clients[1]?.requests[0]).toMatchObject({
      type: "rebuildDocument",
      document: { revision: 3, variables: [{ name: "width", expression: "24 mm" }] },
      generation: 8,
    })
    expect(recovered).toMatchObject({ type: "documentRebuilt", generation: 8 })
  })

  it("retries a committed rebuild once after a worker crash", async () => {
    const workerCrash: RequestHandler = async () => {
      throw new DocumentWorkerRequestError("Worker crashed.", "worker-error")
    }
    const { clients, session } = createHarness([workerCrash])

    await expect(session.rebuild({ document: document(1), mesh })).resolves.toMatchObject({
      type: "documentRebuilt",
      generation: 2,
    })

    expect(clients).toHaveLength(2)
    expect(clients[0]?.terminated).toBe(true)
    expect(clients[1]?.requests[0]).toMatchObject({ generation: 2, revision: 1 })
  })

  it("recovers when an idle worker was already found unavailable", async () => {
    const unavailable: RequestHandler = async () => {
      throw new DocumentWorkerRequestError("Worker is unavailable.", "worker-terminated")
    }
    const { clients, session } = createHarness([unavailable])

    await expect(session.rebuild({ document: document(1), mesh })).resolves.toMatchObject({
      type: "documentRebuilt",
      generation: 2,
    })
    expect(clients[0]?.terminated).toBe(true)
  })

  it("retries a retryable engine failure but not a deterministic failure", async () => {
    const retryableFailure: RequestHandler = async (request) => {
      throw new DocumentWorkerRequestError("Initialization failed.", "worker-failure", {
        ...envelope(request),
        type: "failure",
        diagnostic: {
          code: "engine-initialization-failed",
          message: "Initialization failed.",
          retryable: true,
        },
      })
    }
    const retryable = createHarness([retryableFailure])
    await expect(retryable.session.rebuild({ document: document(1), mesh })).resolves.toMatchObject(
      { generation: 2 },
    )

    const deterministicFailure: RequestHandler = async (request) => {
      throw new DocumentWorkerRequestError("Document is invalid.", "worker-failure", {
        ...envelope(request),
        type: "failure",
        diagnostic: {
          code: "invalid-document-snapshot",
          message: "Document is invalid.",
          retryable: false,
        },
      })
    }
    const deterministic = createHarness([deterministicFailure])
    await expect(
      deterministic.session.rebuild({ document: document(1), mesh }),
    ).rejects.toMatchObject({ code: "worker-failure" })
    expect(deterministic.clients).toHaveLength(1)
    expect(deterministic.session.generation).toBe(1)
  })

  it("serializes concurrent session operations", async () => {
    let releaseFirst: (() => void) | undefined
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })
    let requestCount = 0
    const delayed: RequestHandler = async (request) => {
      requestCount += 1
      if (requestCount === 1) await firstGate
      return successfulResponse(request)
    }
    const { clients, session } = createHarness([delayed])

    const first = session.rebuild({ document: document(1), mesh })
    const second = session.rebuild({ document: document(2), mesh })
    await Promise.resolve()
    expect(clients[0]?.requests).toHaveLength(1)

    releaseFirst?.()
    await Promise.all([first, second])
    expect(clients[0]?.requests.map(({ revision }) => revision)).toEqual([1, 2])
  })

  it("uses the recovered revision for health and disposal", async () => {
    const { clients, session } = createHarness()
    await session.rebuild({ document: document(4), mesh })

    await expect(session.health()).resolves.toMatchObject({ type: "health", revision: 4 })
    await expect(session.dispose()).resolves.toMatchObject({
      type: "documentDisposed",
      revision: 4,
    })
    expect(clients[0]?.requests.map(({ type }) => type)).toEqual([
      "rebuildDocument",
      "healthCheck",
      "disposeDocument",
    ])
  })

  it("exports the last successfully rebuilt revision", async () => {
    const { clients, session } = createHarness()
    await session.rebuild({ document: document(4), mesh })

    await expect(session.exportDocument("step")).resolves.toMatchObject({
      type: "documentExported",
      revision: 4,
      format: "step",
      file: new Uint8Array([1, 2, 3]),
    })
    expect(clients[0]?.requests.map(({ type }) => type)).toEqual([
      "rebuildDocument",
      "exportDocument",
    ])
  })

  it("retains surface texture export options at the client boundary", async () => {
    const { clients, session } = createHarness()
    await session.rebuild({ document: document(4), mesh })
    const textureQuality = { maxEdgeLengthMm: 1, maxTriangles: 2_000 }
    await session.exportDocument("3mf", { surfaceTextures: [], textureQuality })
    expect(clients[0]?.requests.at(-1)).toMatchObject({
      type: "exportDocument",
      surfaceTextures: [],
      textureQuality,
    })
  })

  it("retains export tessellation quality without changing the rebuilt viewport mesh policy", async () => {
    const { clients, session } = createHarness()
    await session.rebuild({ document: document(4), mesh })
    const meshQuality = { chordTolerance: 0.01, angularTolerance: 0.05 }
    await session.exportDocument("3mf", { meshQuality })
    expect(clients[0]?.requests.at(-1)).toMatchObject({ type: "exportDocument", meshQuality })
    expect(clients[0]?.requests[0]).toMatchObject({ type: "rebuildDocument", mesh })
  })

  it("rebuilds the committed snapshot before retrying export after a worker crash", async () => {
    const crashingExport: RequestHandler = async (request) => {
      if (request.type === "exportDocument") {
        throw new DocumentWorkerRequestError("Worker crashed.", "worker-error")
      }
      return successfulResponse(request)
    }
    const { clients, session } = createHarness([crashingExport])
    await session.rebuild({ document: document(3), mesh })

    await expect(session.exportDocument("stl")).resolves.toMatchObject({
      type: "documentExported",
      revision: 3,
      generation: 2,
      format: "stl",
    })
    expect(clients).toHaveLength(2)
    expect(clients[0]?.requests.map(({ type }) => type)).toEqual([
      "rebuildDocument",
      "exportDocument",
    ])
    expect(clients[1]?.requests.map(({ type }) => type)).toEqual([
      "rebuildDocument",
      "exportDocument",
    ])
  })

  it("solves the exact rebuilt revision with stable drag and continuation records", async () => {
    const { clients, session } = createHarness()
    await session.rebuild({ document: document(4), mesh })
    const sourceSketch = documentRebuildSnapshotSchema.parse(document(4)).sketches[0]
    expect(sourceSketch).toBeDefined()
    if (!sourceSketch) return

    const response = await session.solveSketch({
      sketchId,
      draftSketch: {
        ...sourceSketch,
        label: "Unsaved session profile",
      },
      continuation: {
        schemaVersion: 0,
        sketchId,
        sourceRevision: 3,
        points: [{ entityId: sketchPointId, x: 1, y: 2 }],
        circles: [],
      },
      draggedPoints: [{ entityId: sketchPointId, x: 10, y: 20 }],
    })

    expect(response).toMatchObject({
      type: "sketchSolved",
      revision: 4,
      solution: {
        sketchId,
        sourceRevision: 4,
        points: [{ entityId: sketchPointId, x: 10, y: 20 }],
      },
    })
    expect(clients[0]?.requests.map(({ type }) => type)).toEqual(["rebuildDocument", "solveSketch"])
    expect(clients[0]?.requests[1]).toMatchObject({
      type: "solveSketch",
      draftSketch: { id: sketchId, label: "Unsaved session profile" },
    })
  })

  it("rebuilds committed state before retrying a sketch solve after worker failure", async () => {
    const crashingSolve: RequestHandler = async (request) => {
      if (request.type === "solveSketch") {
        throw new DocumentWorkerRequestError("Sketch worker crashed.", "worker-error")
      }
      return successfulResponse(request)
    }
    const { clients, session } = createHarness([crashingSolve])
    await session.rebuild({ document: document(3), mesh })

    await expect(session.solveSketch({ sketchId })).resolves.toMatchObject({
      type: "sketchSolved",
      revision: 3,
      generation: 2,
    })
    expect(clients[1]?.requests.map(({ type }) => type)).toEqual(["rebuildDocument", "solveSketch"])
  })

  it("can restart without a recovery snapshot and closes deterministically", async () => {
    const { clients, session } = createHarness()

    await expect(session.restartAndRecover()).resolves.toBeNull()
    expect(session.generation).toBe(2)
    session.terminate()

    await expect(session.rebuild({ document: document(1), mesh })).rejects.toThrow("closed")
    expect(clients.every(({ terminated }) => terminated)).toBe(true)
  })
})

it("retains detached source bytes when a worker is restarted", async () => {
  const bytes = new Uint8Array([1, 2, 3])
  const sources = [
    {
      asset: {
        id: sketchId,
        digest: "a".repeat(64),
        byteLength: 3,
        filename: "Source.step",
        format: "step",
        representation: "exact-solid",
        normalization: {
          sourceUnit: "millimeter",
          scaleToMillimeters: 1,
          normalizedUnit: "millimeter",
        },
        outputs: [sketchPointId],
      },
      bytes,
    },
  ]
  const { clients, session } = createHarness([], {
    materializeSourceAssets: async () => sourceAssetMaterializationsSchema.parse(sources),
  })
  await session.rebuild({ document: document(3), mesh })
  bytes.fill(0)
  await session.restartAndRecover()
  const request = clients[1]?.requests[0]
  expect(request?.type).toBe("rebuildDocument")
  if (request?.type !== "rebuildDocument") throw new Error("Missing recovered rebuild")
  expect(Array.from(request.sourceAssets?.[0]?.bytes ?? [])).toEqual([1, 2, 3])
})

it("inspects a source without rebuilding or changing the document revision", async () => {
  const inspection = { unitEvidence: "explicit-source-metadata" as const, outputs: [] }
  const { clients, session } = createHarness([
    (request) =>
      request.type === "inspectSourceImport"
        ? { ...envelope(request), type: "sourceImportInspected", inspection }
        : successfulResponse(request),
  ])
  await session.rebuild({ document: document(7), mesh })
  const result = await session.inspectSourceImport({
    source: {
      format: "step",
      digest: "a".repeat(64),
      byteLength: 3,
      normalization: {
        sourceUnit: "millimeter",
        scaleToMillimeters: 1,
        normalizedUnit: "millimeter",
      },
      unitPolicy: "step-system-mm",
      readerPolicyVersion: 1,
    },
    bytes: new Uint8Array([1, 2, 3]),
    mesh,
  })
  expect(result.inspection).toEqual(inspection)
  expect(clients[0]?.requests.map(({ type }) => type)).toEqual([
    "rebuildDocument",
    "inspectSourceImport",
  ])
  expect(clients[0]?.requests[1]).toMatchObject({ revision: 7 })
})

it("inspects explicit mesh units through the serialized session without changing rebuilt authority", async () => {
  const bytes = new TextEncoder().encode(
    "solid source\nfacet normal 0 0 1\nouter loop\nvertex 0 0 0\nvertex 1 0 0\nvertex 0 2 0\nendloop\nendfacet\nendsolid source",
  )
  const inspection = await inspectMeshSource("stl", bytes, "cm")
  const { clients, session } = createHarness([
    (request) =>
      request.type === "inspectMeshImport"
        ? { ...envelope(request), type: "meshImportInspected", inspection }
        : successfulResponse(request),
  ])
  await session.rebuild({ document: document(7), mesh })
  const result = await session.inspectMeshImport({ format: "stl", bytes, units: "cm" })
  expect(result.inspection.normalization.scaleToMillimeters).toBe(10)
  expect(result.inspection.outputs[0]?.shape).toMatchObject({
    solidCount: 0,
    volume: 0,
    surfaceArea: 100,
  })
  expect(clients[0]?.requests[1]).toMatchObject({
    revision: 7,
    type: "inspectMeshImport",
    input: { units: "cm" },
  })
  await session.restartAndRecover()
  expect(clients[1]?.requests.map(({ type }) => type)).toEqual(["rebuildDocument"])
})

it("exports isolated assembly authority without rebuilding or changing the current model recovery", async () => {
  const { clients, session } = createHarness([
    (request) =>
      request.type === "exportAssembly"
        ? {
            ...envelope(request),
            type: "assemblyExported",
            format: request.input.settings.format,
            file: new Uint8Array([4, 5]),
            bodyCount: 2,
          }
        : successfulResponse(request),
  ])
  await session.rebuild({ document: document(7), mesh })
  const exported = await session.exportAssembly(
    {
      assembly: { authorityJson: "{}", sourceAssets: [], mesh, interferencePairs: [] },
      settings: { format: "step" },
    },
    7,
  )
  expect(exported.bodyCount).toBe(2)
  expect(Array.from(exported.file)).toEqual([4, 5])
  expect(clients[0]?.requests.map(({ type }) => type)).toEqual([
    "rebuildDocument",
    "exportAssembly",
  ])
  await session.restartAndRecover()
  expect(clients[1]?.requests.map(({ type }) => type)).toEqual(["rebuildDocument"])
})
