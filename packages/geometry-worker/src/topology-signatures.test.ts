import { describe, expect, it } from "vitest"
import { createTopologyCandidates } from "./topology-signatures"

function sample(
  candidateId: string,
  kind: "edge" | "face",
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
})
