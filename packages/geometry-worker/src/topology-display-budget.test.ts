import { expect, it, mock } from "bun:test"
import type { Shape3D } from "replicad"
import { vi } from "../../../tests/unit/support/bun-test"

const replicadModule = { ...(await import("replicad")) }
const boundsHandles: Bounds[] = []
let failBounds = false
class Bounds {
  coordinates = [0, 0, 0, 10, 0, 0]
  constructor() {
    boundsHandles.push(this)
  }
  IsVoid() {
    return false
  }
  IsOpen() {
    return false
  }
  Get(...coordinates: { current: number }[]) {
    coordinates.forEach((coordinate, index) => {
      coordinate.current = this.coordinates[index] ?? 0
    })
  }
  delete = vi.fn()
}
mock.module("replicad", () => ({
  ...replicadModule,
  getOC: () => ({
    BRep_Tool: { Degenerated: () => false },
    Bnd_Box_1: Bounds,
    BRepBndLib: {
      AddOptimal: (shape: { bounds: number[] }, bounds: Bounds) => {
        if (failBounds) throw new Error("Exact bounds failed.")
        bounds.coordinates = shape.bounds
      },
    },
  }),
  measureShapeLinearProperties: () => ({ length: 10, centerOfMass: [5, 0, 0], delete: vi.fn() }),
}))
mock.module("./edge-display-polyline", () => ({
  edgeDisplayPolyline: vi.fn((_edge, budget: number) =>
    Array.from({ length: budget }, (_, i) => [i, 0, 0]),
  ),
}))

const { captureReplicadTopologySnapshot } = await import("./topology-signatures")
const { edgeDisplayPolyline } = await import("./edge-display-polyline")

function testEdges(count: number) {
  const vector = (point: number[]) => ({ toTuple: () => point, delete: vi.fn() })
  return Array.from({ length: count }, (_, i) => ({
    wrapped: { bounds: [0, i, 0, 10, i, 0] },
    geomType: "BSPLINE",
    hashCode: i + 1,
    isClosed: false,
    tangentAt: () => vector([1, 0, 0]),
    startPoint: vector([0, i, 0]),
    endPoint: vector([10, i, 0]),
    delete: vi.fn(),
  }))
}

it("stops display sampling at the feature budget while retaining exact topology and releasing wrappers", () => {
  const edges = testEdges(67)
  const snapshot = captureReplicadTopologySnapshot({ faces: [], edges } as unknown as Shape3D)
  const candidates = snapshot.candidates.filter((candidate) => candidate.kind === "edge")
  expect(candidates).toHaveLength(67)
  expect(
    candidates.reduce((total, candidate) => total + (candidate.edgePolyline?.length ?? 0), 0),
  ).toBe(65_536)
  expect(edgeDisplayPolyline).toHaveBeenCalledTimes(64)
  expect(candidates[63]?.edgePolyline).toHaveLength(961)
  expect(candidates[64]?.edgePolyline).toBeUndefined()
  expect(candidates[66]?.signature.geometryClass).toBe("BSPLINE")
  expect(snapshot.transientShapeKeys.get("edge:66")).toBe(67)
  for (const edge of edges) expect(edge.delete).toHaveBeenCalledTimes(1)
  expect(boundsHandles).toHaveLength(67)
  for (const bounds of boundsHandles) expect(bounds.delete).toHaveBeenCalledTimes(1)
})

it("releases the exact bounds handle and topology wrappers when native bounds fail", () => {
  const edges = testEdges(1)
  failBounds = true
  try {
    expect(() =>
      captureReplicadTopologySnapshot({ faces: [], edges } as unknown as Shape3D),
    ).toThrow("Exact bounds failed.")
    expect(boundsHandles.at(-1)?.delete).toHaveBeenCalledTimes(1)
    expect(edges[0]?.delete).toHaveBeenCalledTimes(1)
  } finally {
    failBounds = false
  }
})
