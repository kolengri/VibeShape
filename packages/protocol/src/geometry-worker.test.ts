import { describe, expect, it } from "vitest"
import {
  GEOMETRY_MEMORY_STAGES,
  GEOMETRY_PROTOCOL_VERSION,
  geometryWorkerRequestSchema,
  geometryWorkerResponseSchema,
  kernelSpikeParametersSchema,
} from "./geometry-worker"

const validEnvelope = {
  protocolVersion: GEOMETRY_PROTOCOL_VERSION,
  requestId: "request-1",
  documentId: "document-1",
  revision: 0,
  generation: 1,
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
} as const

describe("geometry worker protocol", () => {
  it("accepts a finite versioned kernel spike request", () => {
    const parsed = geometryWorkerRequestSchema.parse({
      ...validEnvelope,
      type: "runKernelSpike",
      parameters: validParameters,
    })

    expect(parsed.type).toBe("runKernelSpike")
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
      mesh: {
        positions: new Float32Array([0, 0, 0]),
        normals: new Float32Array([0, 0, 1]),
        indices: new Uint32Array([0, 0, 0]),
        triangleFaceIds: new Uint32Array([1]),
      },
      exchange: {
        stepBytes: 1,
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
        iterations: 1,
        ownedShapesBefore: 0,
        ownedShapesAfter: 0,
        wasmHeapBytesBefore: 1,
        wasmHeapBytesAfter: 1,
        wasmHeapGrowthBytes: 0,
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
  })
})
