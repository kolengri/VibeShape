import { describe, expect, it } from "bun:test"
import {
  DOCUMENT_PROTOCOL_VERSION,
  documentWorkerRequestSchema,
  documentWorkerResponseSchema,
} from "./document-worker"
import {
  type PrintOptimizationReconstructionInput,
  printOptimizationReconstructionInputSchema,
  printOptimizationReconstructionSchema,
} from "./print-optimization"

const documentId = "0195b5ac-b213-7f2c-9c33-67a36a7f21ac"
const input: PrintOptimizationReconstructionInput = {
  source: {
    documentId,
    featureId: "0195b5ac-b220-7a2c-8c33-67a36a7f3101",
    contentHash: "a".repeat(64),
    outputRole: "result",
  },
  preserveFaceIds: [27],
  voxelGrid: { originMm: [-1, -2, 0], cellSizeMm: 0.5, cells: [[0, 0, 0]] },
  sourceToPrintFrame: { originMm: [0, 0, 0], rotation: [0, 0, 0, 1] },
  protectedBoxes: [{ minMm: [0, 0, 0], maxMm: [1, 1, 1] }],
  preserveDepthMm: 1,
}
const envelope = {
  protocolVersion: DOCUMENT_PROTOCOL_VERSION,
  requestId: "test-exact-print",
  documentId,
  revision: 2,
  generation: 1,
}
const reconstruction = {
  source: input.source,
  stepBytes: new Uint8Array([1, 2, 3]),
  verificationMesh: {
    positions: new Float64Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1]),
    indices: new Uint32Array([0, 2, 1, 0, 1, 3, 0, 3, 2, 1, 2, 3]),
  },
  sourceVolumeMm3: 1,
  volumeMm3: 0.5,
  preservedFaceCount: 1,
}

describe("exact print reconstruction structured-clone boundary", () => {
  it("carries one source-bound transient request and a double-precision verification mesh", () => {
    const request = documentWorkerRequestSchema.parse({
      ...envelope,
      type: "reconstructPrintOptimization",
      input,
    })
    if (request.type !== "reconstructPrintOptimization")
      throw new Error("Missing reconstruction request.")
    expect(request.input).toEqual(input)
    const result = documentWorkerResponseSchema.parse({
      ...envelope,
      type: "printOptimizationReconstructed",
      reconstruction,
    })
    expect(result.type).toBe("printOptimizationReconstructed")
    expect(printOptimizationReconstructionSchema.parse(structuredClone(reconstruction))).toEqual(
      reconstruction,
    )
    expect(
      documentWorkerRequestSchema.safeParse({
        ...envelope,
        protocolVersion: 27,
        type: "reconstructPrintOptimization",
        input,
      }).success,
    ).toBe(false)
    expect(
      documentWorkerRequestSchema.safeParse({
        ...envelope,
        documentId: "0195b5ac-b213-7f2c-9c33-67a36a7f21ad",
        type: "reconstructPrintOptimization",
        input,
      }).success,
    ).toBe(false)
  })

  it.each([
    { ...input, nativeHandle: 1 },
    { ...input, source: { ...input.source, contentHash: "stale" } },
    { ...input, preserveFaceIds: [27, 27] },
    { ...input, preserveFaceIds: [0] },
    {
      ...input,
      voxelGrid: {
        ...input.voxelGrid,
        cells: [
          [0, 0, 0],
          [0, 0, 0],
        ],
      },
    },
    { ...input, voxelGrid: { ...input.voxelGrid, cells: [[-1, 0, 0]] } },
    { ...input, voxelGrid: { ...input.voxelGrid, cells: [[Number.MAX_SAFE_INTEGER, 0, 0]] } },
    { ...input, voxelGrid: { ...input.voxelGrid, cellSizeMm: Number.NaN } },
    { ...input, sourceToPrintFrame: { originMm: [0, 0, 0], rotation: [0, 0, 0, 2] } },
    { ...input, protectedBoxes: [{ minMm: [1, 0, 0], maxMm: [0, 1, 1] }] },
  ])("rejects malformed exact reconstruction input %#", (value) => {
    expect(printOptimizationReconstructionInputSchema.safeParse(value).success).toBe(false)
  })

  it("admits local geometry above former cell, index, and mesh ceilings", () => {
    const cells = Array.from({ length: 100_001 }, (_, index) => [index, 0, 0])
    expect(
      printOptimizationReconstructionInputSchema.safeParse({
        ...input,
        voxelGrid: { originMm: [-100_000.5, 0, 0], cellSizeMm: 0.5, cells },
      }).success,
    ).toBe(true)
    expect(
      printOptimizationReconstructionSchema.safeParse({
        ...reconstruction,
        verificationMesh: {
          ...reconstruction.verificationMesh,
          positions: new Float64Array(2_000_001),
        },
      }).success,
    ).toBe(true)
  })

  it("rejects non-finite meshes, invalid indices, and unchanged exact material", () => {
    expect(
      printOptimizationReconstructionSchema.safeParse({ ...reconstruction, volumeMm3: 1 }).success,
    ).toBe(false)
    expect(
      printOptimizationReconstructionSchema.safeParse({
        ...reconstruction,
        verificationMesh: {
          ...reconstruction.verificationMesh,
          positions: new Float64Array([Number.NaN, ...new Array(11).fill(0)]),
        },
      }).success,
    ).toBe(false)
    expect(
      printOptimizationReconstructionSchema.safeParse({
        ...reconstruction,
        verificationMesh: {
          ...reconstruction.verificationMesh,
          indices: new Uint32Array([99, 2, 1, 0, 1, 3, 0, 3, 2, 1, 2, 3]),
        },
      }).success,
    ).toBe(false)
  })
})
