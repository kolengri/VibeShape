import { afterEach, describe, expect, it, mock } from "bun:test"
import { featureIdSchema } from "@vibeshape/domain/identifiers"
import type { InspectMeshImportInput } from "@vibeshape/protocol"
import { inspectMeshSource } from "../../../../../packages/document-worker/src/mesh-source-import"
import { vi } from "../../../../../tests/unit/support/bun-test"
import { meshInspection } from "../import/import-test-fixtures"
import type { LightweightingSource } from "./lightweighting-model"

const inspect = vi.fn(async (input: InspectMeshImportInput) =>
  inspectMeshSource(input.format, input.bytes, input.units),
)
mock.module("../../document/document-controller", () => ({ inspectTriangleMeshSource: inspect }))
const { prepareLightweightingSnapshot } = await import("./prepare-lightweighting-snapshot")
const inspectedBody = meshInspection.outputs[0]
if (!inspectedBody) throw new Error("Expected a mesh inspection fixture.")
const featureId = featureIdSchema.parse("0195b5ac-b250-7a2c-8c33-000000000001")
const source: LightweightingSource = {
  context: { documentId: "document", revision: 4, authorityVersion: 4, historyAfter: null },
  partId: "part",
  partName: "Beam",
  featureId,
  outputRole: "result",
  contentHash: "hash",
  body: {
    ...inspectedBody,
    featureId,
    outputRole: "result",
    contentHash: "hash",
    topologyCandidates: [],
  },
}
const mesh = {
  vertices: [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1],
  indices: [0, 2, 1, 0, 1, 3, 0, 3, 2, 1, 2, 3],
}
afterEach(() => inspect.mockClear())

describe("lightweighting snapshot preparation", () => {
  it("inspects ordinary structural snapshots as millimeter STL", async () => {
    const result = await prepareLightweightingSnapshot(mesh, 0.5, source, () => true)
    expect(result?.prepared.filename).toBe("Beam-lightweight.stl")
    expect(result?.prepared.input).toMatchObject({ format: "stl", units: "mm" })
    expect(result?.inspection.normalization).toEqual({
      sourceUnit: "millimeter",
      scaleToMillimeters: 1,
      normalizedUnit: "millimeter",
    })
    expect(inspect).toHaveBeenCalledTimes(1)
  })

  it("inspects exact 3MF fallback coordinates with embedded units", async () => {
    const preciseMesh = {
      ...mesh,
      vertices: mesh.vertices.map((value) => value + 1_000.123456789),
    }
    const result = await prepareLightweightingSnapshot(preciseMesh, 0.5, source, () => true)
    expect(result?.prepared.filename).toBe("Beam-lightweight.3mf")
    expect(result?.prepared.input.format).toBe("3mf")
    expect(result?.prepared.input).not.toHaveProperty("units")
    expect(result?.inspection.normalization).toEqual({
      sourceUnit: "millimeter",
      scaleToMillimeters: 1,
      normalizedUnit: "millimeter",
    })
    expect(result?.inspection.outputs[0]?.mesh.precisePositions?.[0]).toBe(1_000.123456789)
    expect(result?.inspection.outputs[0]?.mesh.positions[0]).toBe(Math.fround(1_000.123456789))
    expect(inspect).toHaveBeenCalledTimes(1)
  })

  it("discards a 3MF result when the captured source becomes stale during inspection", async () => {
    let current = true
    inspect.mockImplementationOnce(async (input: InspectMeshImportInput) => {
      const inspection = await inspectMeshSource(input.format, input.bytes, input.units)
      current = false
      return inspection
    })
    const preciseMesh = {
      ...mesh,
      vertices: mesh.vertices.map((value) => value + 1_000.123456789),
    }
    expect(await prepareLightweightingSnapshot(preciseMesh, 0.5, source, () => current)).toBeNull()
    expect(inspect).toHaveBeenCalledTimes(1)
  })
})
