import { describe, expect, it } from "vitest"
import {
  GEOMETRY_MEMORY_STAGES,
  GEOMETRY_PROTOCOL_VERSION,
  extrusionFeatureContentParametersSchema,
  geometryWorkerRequestSchema,
  geometryWorkerResponseSchema,
  kernelSpikeParametersSchema,
  topologySignatureSchema,
  topologySpikeParametersSchema,
} from "./geometry-worker"

const validEnvelope = {
  protocolVersion: GEOMETRY_PROTOCOL_VERSION,
  requestId: "request-1",
  documentId: "document-1",
  revision: 0,
  generation: 1,
} as const

const featureContentEnvironment = {
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
} as const

const boxFeatureType = {
  moduleId: "org.vibeshape.core.part-design",
  moduleVersion: "0.1.0",
  typeId: "org.vibeshape.feature.part-design.box",
  schemaVersion: 1,
} as const

const boxContent = {
  schemaVersion: 0,
  feature: {
    schemaVersion: 0,
    type: boxFeatureType,
    parameters: { width: 20, depth: 30, height: 25.4, centered: true },
    inputs: [],
    references: [],
  },
  environment: featureContentEnvironment,
} as const

const validParameters = {
  boxSize: [60, 40, 20],
  cylinderRadius: 8,
  cylinderHeight: 30,
  cylinderOrigin: [0, 0, -5],
  filletRadius: 1.5,
  meshTolerance: 0.05,
  angularTolerance: 0.1,
  lifecycleIterations: 3,
  lifecycleOperation: "boolean-cut",
  purgeAfterLifecycle: false,
} as const

const historyStats = {
  sourceCount: 1,
  modifiedSourceCount: 0,
  modifiedRelationCount: 0,
  generatedSourceCount: 0,
  generatedRelationCount: 0,
  deletedSourceCount: 0,
}

describe("geometry worker protocol", () => {
  it("accepts a finite versioned kernel spike request", () => {
    const parsed = geometryWorkerRequestSchema.parse({
      ...validEnvelope,
      type: "runKernelSpike",
      parameters: validParameters,
    })

    expect(parsed.type).toBe("runKernelSpike")
  })

  it("accepts bounded canonical feature evaluation requests", () => {
    const request = {
      ...validEnvelope,
      type: "evaluateFeature",
      featureId: "0195b5ac-b220-7a2c-8c33-67a36a7f3101",
      content: boxContent,
      contentHash: "a".repeat(64),
      dependencies: [],
      mesh: { chordTolerance: 0.05, angularTolerance: 0.1 },
    }

    expect(geometryWorkerRequestSchema.safeParse(request).success).toBe(true)
    expect(
      geometryWorkerRequestSchema.safeParse({
        ...request,
        mesh: { ...request.mesh, chordTolerance: 0.000_1 },
      }).success,
    ).toBe(false)
    expect(
      geometryWorkerRequestSchema.safeParse({ ...request, contentHash: "invalid" }).success,
    ).toBe(false)
    expect(
      geometryWorkerRequestSchema.safeParse({
        ...request,
        content: {
          ...request.content,
          feature: { ...request.content.feature, inputs: ["a".repeat(64)] },
        },
      }).success,
    ).toBe(false)
    expect(
      geometryWorkerRequestSchema.safeParse({
        ...request,
        content: {
          ...request.content,
          feature: {
            ...request.content.feature,
            parameters: Object.fromEntries(
              Array.from({ length: 33 }, (_, index) => [`parameter-${index}`, index]),
            ),
          },
        },
      }).success,
    ).toBe(false)
  })

  it("accepts exact selector-resolved extrusion profiles and rejects mismatched sources", () => {
    const parameters = {
      sketchId: "0195b5ac-b220-7a2c-8c33-67a36a7f3201",
      plane: "xy",
      outer: {
        sourceEntityIds: [
          "0195b5ac-b220-7a2c-8c33-67a36a7f3211",
          "0195b5ac-b220-7a2c-8c33-67a36a7f3212",
        ],
        segments: [
          {
            entityId: "0195b5ac-b220-7a2c-8c33-67a36a7f3211",
            type: "line",
            start: [0, 0],
            end: [20, 0],
          },
          {
            entityId: "0195b5ac-b220-7a2c-8c33-67a36a7f3212",
            type: "arc",
            start: [20, 0],
            middle: [25, 5],
            end: [20, 10],
          },
        ],
      },
      holes: [],
      distance: 12,
      symmetric: false,
      operation: "new",
    } as const

    expect(extrusionFeatureContentParametersSchema.safeParse(parameters).success).toBe(true)
    expect(
      extrusionFeatureContentParametersSchema.safeParse({ ...parameters, operation: "intersect" })
        .success,
    ).toBe(true)
    expect(
      extrusionFeatureContentParametersSchema.safeParse({
        ...parameters,
        outer: { ...parameters.outer, sourceEntityIds: parameters.outer.sourceEntityIds.slice(1) },
      }).success,
    ).toBe(false)
    expect(
      extrusionFeatureContentParametersSchema.safeParse({ ...parameters, distance: Number.NaN })
        .success,
    ).toBe(false)
  })

  it("binds dependent evaluation slots to ordered feature hashes", () => {
    const inputHashes = ["a".repeat(64), "b".repeat(64)]
    const request = {
      ...validEnvelope,
      type: "evaluateFeature",
      featureId: "0195b5ac-b220-7a2c-8c33-67a36a7f3103",
      content: {
        ...boxContent,
        feature: {
          ...boxContent.feature,
          type: { ...boxContent.feature.type, typeId: "org.vibeshape.feature.part-design.boolean" },
          parameters: { operation: "subtract" },
          inputs: inputHashes,
        },
      },
      contentHash: "c".repeat(64),
      dependencies: [
        {
          featureId: "0195b5ac-b220-7a2c-8c33-67a36a7f3101",
          contentHash: inputHashes[0],
        },
        {
          featureId: "0195b5ac-b220-7a2c-8c33-67a36a7f3102",
          contentHash: inputHashes[1],
        },
      ],
      mesh: { chordTolerance: 0.05, angularTolerance: 0.1 },
    }

    expect(geometryWorkerRequestSchema.safeParse(request).success).toBe(true)
    expect(
      geometryWorkerRequestSchema.safeParse({
        ...request,
        dependencies: [...request.dependencies].reverse(),
      }).success,
    ).toBe(false)
    expect(
      geometryWorkerRequestSchema.safeParse({
        ...request,
        dependencies: [request.dependencies[0]],
      }).success,
    ).toBe(false)
    expect(
      geometryWorkerRequestSchema.safeParse({
        ...request,
        dependencies: [
          request.dependencies[0],
          {
            ...request.dependencies[1],
            featureId: "0195b5ac-b220-7a2c-8c33-67a36a7f3101",
          },
        ],
      }).success,
    ).toBe(false)
    expect(
      geometryWorkerRequestSchema.safeParse({
        ...request,
        dependencies: [
          { ...request.dependencies[0], featureId: request.featureId },
          request.dependencies[1],
        ],
      }).success,
    ).toBe(false)
  })

  it("accepts bounded topology parameters and rejects invalid pattern geometry", () => {
    const parameters = {
      boxSize: [60, 40, 20],
      holeCount: 2,
      holeRadius: 6,
      holeSpacing: 10,
      holeCenter: [0, 0],
      filletRadius: 1.5,
    }

    expect(topologySpikeParametersSchema.safeParse(parameters).success).toBe(true)
    expect(
      topologySpikeParametersSchema.safeParse({ ...parameters, holeCenter: [25, 0] }).success,
    ).toBe(false)
    expect(
      topologySpikeParametersSchema.safeParse({
        ...parameters,
        holeCount: 3,
        holeSpacing: 10,
      }).success,
    ).toBe(false)
  })

  it("rejects unordered topology signature bounds at the worker boundary", () => {
    expect(
      topologySignatureSchema.safeParse({
        kind: "face",
        geometryClass: "PLANE",
        measure: 1,
        centroid: [0, 0, 0],
        bounds: { min: [1, 0, 0], max: [0, 1, 1] },
        boundaryCount: 4,
        adjacentGeometryClasses: [],
      }).success,
    ).toBe(false)
  })

  it("defaults an omitted lifecycle operation to the existing boolean-cut fixture", () => {
    const {
      lifecycleOperation: _operation,
      purgeAfterLifecycle: _purge,
      ...legacyParameters
    } = validParameters
    const parsed = kernelSpikeParametersSchema.parse(legacyParameters)

    expect(parsed.lifecycleOperation).toBe("boolean-cut")
    expect(parsed.purgeAfterLifecycle).toBe(false)
  })

  it("rejects an unsupported lifecycle operation", () => {
    expect(
      kernelSpikeParametersSchema.safeParse({
        ...validParameters,
        lifecycleOperation: "fillet",
      }).success,
    ).toBe(false)
  })

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    "rejects non-finite CAD parameters: %s",
    (invalidRadius) => {
      expect(
        kernelSpikeParametersSchema.safeParse({
          ...validParameters,
          cylinderRadius: invalidRadius,
        }).success,
      ).toBe(false)
    },
  )

  it("rejects an unsupported protocol version", () => {
    expect(
      geometryWorkerRequestSchema.safeParse({
        ...validEnvelope,
        protocolVersion: GEOMETRY_PROTOCOL_VERSION + 1,
        type: "healthCheck",
      }).success,
    ).toBe(false)
  })

  it("rejects a fillet that cannot fit inside the box", () => {
    const result = kernelSpikeParametersSchema.safeParse({
      ...validParameters,
      filletRadius: 10,
    })

    expect(result.success).toBe(false)
  })

  it("rejects dimensions outside the bounded spike workspace", () => {
    expect(
      kernelSpikeParametersSchema.safeParse({
        ...validParameters,
        cylinderRadius: 100_001,
      }).success,
    ).toBe(false)
  })

  it("rejects a mesh tolerance that can cause runaway tessellation", () => {
    expect(
      kernelSpikeParametersSchema.safeParse({
        ...validParameters,
        meshTolerance: 0.000_1,
      }).success,
    ).toBe(false)
  })

  it("accepts structured-clone mesh payloads", () => {
    const response = geometryWorkerResponseSchema.parse({
      ...validEnvelope,
      type: "kernelSpikeCompleted",
      engine: {
        adapter: "replicad",
        adapterVersion: "spike-2",
        replicadVersion: "0.23.1",
        opencascadePackageVersion: "0.23.0",
        opencascadeSourceRevision: null,
        wasmBytes: 1,
        initializedInMs: 1,
        featureContentEnvironment,
      },
      shape: {
        valid: true,
        volume: 1,
        surfaceArea: 6,
        bounds: { min: [0, 0, 0], max: [1, 1, 1] },
        faceCount: 6,
        edgeCount: 12,
        solidCount: 1,
      },
      history: {
        booleanCut: {
          vertices: historyStats,
          edges: historyStats,
          faces: historyStats,
          solids: historyStats,
        },
        fillet: {
          vertices: historyStats,
          edges: historyStats,
          faces: historyStats,
        },
      },
      topologyCandidates: [
        {
          candidateId: "face:0",
          kind: "face",
          semanticRole: "base-extrude.cap.end",
          lineageTokens: [],
          signature: {
            kind: "face",
            geometryClass: "PLANE",
            measure: 1,
            centroid: [0.5, 0.5, 1],
            bounds: { min: [0, 0, 1], max: [1, 1, 1] },
            direction: [0, 0, 1],
            directionMode: "oriented",
            boundaryCount: 4,
            adjacentGeometryClasses: ["PLANE", "PLANE", "PLANE", "PLANE"],
          },
        },
      ],
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
        importedShape: {
          valid: true,
          volume: 1,
          surfaceArea: 6,
          bounds: { min: [0, 0, 0], max: [1, 1, 1] },
          faceCount: 6,
          edgeCount: 12,
          solidCount: 1,
        },
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
    })

    expect(response.type).toBe("kernelSpikeCompleted")

    if (response.type !== "kernelSpikeCompleted") {
      throw new Error("Expected the kernel spike response fixture.")
    }

    expect(response.exchange.stepFile).toBeInstanceOf(Uint8Array)
    expect(response.exchange.stepBytes).toBe(response.exchange.stepFile.byteLength)

    expect(
      geometryWorkerResponseSchema.safeParse({
        ...response,
        exchange: { ...response.exchange, stepBytes: response.exchange.stepBytes + 1 },
      }).success,
    ).toBe(false)
  })
})
