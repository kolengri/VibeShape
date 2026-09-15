import type { Shape3D } from "replicad"
import { expect, it, vi } from "vitest"
import { captureReplicadTopologySnapshot } from "./topology-signatures"

vi.mock("replicad", () => ({
  measureShapeLinearProperties: () => ({ length: 10, centerOfMass: [5, 0, 0], delete: vi.fn() }),
}))
vi.mock("./edge-display-polyline", () => ({
  edgeDisplayPolyline: vi.fn((_edge, budget: number) =>
    Array.from({ length: budget }, (_, i) => [i, 0, 0]),
  ),
}))

import { edgeDisplayPolyline } from "./edge-display-polyline"

it("stops display sampling at the feature budget while retaining exact topology and releasing wrappers", () => {
  const vector = (point: number[]) => ({ toTuple: () => point, delete: vi.fn() })
  const edges = Array.from({ length: 67 }, (_, i) => ({
    geomType: "BSPLINE",
    hashCode: i + 1,
    isClosed: false,
    tangentAt: () => vector([1, 0, 0]),
    startPoint: vector([0, i, 0]),
    endPoint: vector([10, i, 0]),
    boundingBox: {
      bounds: [
        [0, i, 0],
        [10, i, 0],
      ],
      delete: vi.fn(),
    },
    delete: vi.fn(),
  }))
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
  for (const edge of edges) expect(edge.delete).toHaveBeenCalledOnce()
})
