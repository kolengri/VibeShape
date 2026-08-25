import type { Shape3D } from "replicad"
import { describe, expect, it, vi } from "vitest"
import { captureReplicadTopologySnapshot, createTopologyCandidates } from "./topology-signatures"

function sample(
  candidateId: string,
  kind: "vertex" | "edge" | "face",
  ownKey: number,
  boundaryKeys: number[],
  geometryClass: string,
) {
  return {
    candidateId,
    kind,
    ownKey,
    boundaryKeys,
    signature: {
      kind,
      geometryClass,
      measure: 10,
      centroid: [0, 0, 0] as [number, number, number],
      bounds: {
        min: [0, 0, 0] as [number, number, number],
        max: [1, 1, 1] as [number, number, number],
      },
      boundaryCount: boundaryKeys.length,
    },
  }
}

describe("createTopologyCandidates", () => {
  it("derives adjacency and exposes only the bounded face-to-mesh selection join", () => {
    const candidates = createTopologyCandidates([
      sample("face:0", "face", 100, [10, 11], "PLANE"),
      sample("face:1", "face", 101, [11, 12], "CYLINDRE"),
      sample("edge:0", "edge", 11, [], "LINE"),
    ])

    expect(candidates[0]?.signature.adjacentGeometryClasses).toEqual(["CYLINDRE"])
    expect(candidates[1]?.signature.adjacentGeometryClasses).toEqual(["PLANE"])
    expect(candidates[2]?.signature.adjacentGeometryClasses).toEqual(["CYLINDRE", "PLANE"])
    expect(candidates[0]?.meshFaceId).toBe(100)
    expect(candidates[2]?.meshFaceId).toBeUndefined()
    expect(JSON.stringify(candidates)).not.toContain("ownKey")
    expect(JSON.stringify(candidates)).not.toContain("boundaryKeys")
  })

  it("adds semantic and lineage annotations from reviewed feature output rules", () => {
    const [candidate] = createTopologyCandidates([sample("face:0", "face", 100, [10], "PLANE")], {
      semanticRole: () => "extrude.cap.end",
      lineageTokens: () => ["extrude:source-face:4"],
    })

    expect(candidate).toMatchObject({
      semanticRole: "extrude.cap.end",
      lineageTokens: ["extrude:source-face:4"],
    })
  })

  it("preserves rebuild-local references without transient shape keys", () => {
    const candidates = createTopologyCandidates([
      {
        ...sample("vertex:0", "vertex", 7, [], "POINT"),
        referenceGeometry: { kind: "vertex", position: [1, 2, 3] },
      },
      {
        ...sample("edge:0", "edge", 8, [], "LINE"),
        referenceGeometry: { kind: "line-edge", start: [0, 0, 0], end: [1, 0, 0] },
      },
    ])

    expect(candidates.map(({ referenceGeometry }) => referenceGeometry)).toEqual([
      { kind: "vertex", position: [1, 2, 3] },
      { kind: "line-edge", start: [0, 0, 0], end: [1, 0, 0] },
    ])
    expect(JSON.stringify(candidates)).not.toContain("ownKey")
  })

  it("releases acquired wrappers when a later topology accessor fails", () => {
    const face = { delete: vi.fn() }
    const shape = {
      get faces() {
        return [face]
      },
      get edges(): never {
        throw new Error("edge access failed")
      },
    } as unknown as Shape3D

    expect(() => captureReplicadTopologySnapshot(shape)).toThrow("edge access failed")
    expect(face.delete).toHaveBeenCalledOnce()
  })
})
