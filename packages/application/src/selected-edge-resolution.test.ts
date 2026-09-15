import { describe, expect, it } from "vitest"
import { resolveSelectedEdgeCandidates } from "./selected-edge-resolution"

const signature = (x: number) => ({
  kind: "edge" as const,
  geometryClass: "LINE",
  measure: 10,
  centroid: [x, 0, 0] as [number, number, number],
  bounds: {
    min: [x - 5, 0, 0] as [number, number, number],
    max: [x + 5, 0, 0] as [number, number, number],
  },
  direction: [1, 0, 0] as [number, number, number],
  directionMode: "axis" as const,
  boundaryCount: 2,
  adjacentGeometryClasses: ["PLANE", "PLANE"],
})

const reference = (x: number, overrides: Record<string, unknown> = {}) => ({
  schemaVersion: 0 as const,
  kind: "edge" as const,
  signature: signature(x),
  inputIndex: 0,
  ...overrides,
})

const candidate = (id: string, x: number, semanticRole?: string) => ({
  candidateId: id,
  kind: "edge" as const,
  signature: signature(x),
  lineageTokens: [],
  ...(semanticRole ? { semanticRole } : {}),
})

const sourceId = "0195b5ac-b220-7a2c-8c33-67a36a7f3302"

describe("selected-edge durable resolution", () => {
  it("follows a semantic edge after dimensions and ephemeral IDs change", () => {
    expect(
      resolveSelectedEdgeCandidates(
        [reference(0, { semanticRole: "primitive.box.edge.x" })],
        [candidate("edge:9", 20, "primitive.box.edge.x")],
        sourceId,
      ),
    ).toEqual(["edge:9"])
  })
  it.each([
    ["missing", [candidate("edge:0", 20)]],
    ["ambiguous", [candidate("edge:0", 0), candidate("edge:1", 0)]],
  ])("rejects %s signature matches", (status, candidates) => {
    expect(() => resolveSelectedEdgeCandidates([reference(0)], candidates, sourceId)).toThrow(
      status,
    )
  })
  it("rejects two references resolving to the same exact edge", () => {
    expect(() =>
      resolveSelectedEdgeCandidates(
        [reference(0), reference(10, { semanticRole: "edge-role" })],
        [candidate("edge:0", 0, "edge-role")],
        sourceId,
      ),
    ).toThrow("duplicate")
  })
  it("rejects wrong dependency input and empty or oversized selection sets", () => {
    const candidates = [candidate("edge:0", 0)]
    expect(() =>
      resolveSelectedEdgeCandidates([reference(0, { inputIndex: 1 })], candidates, sourceId),
    ).toThrow("input 0")
    expect(() => resolveSelectedEdgeCandidates([], candidates, sourceId)).toThrow("1–256")
    expect(() =>
      resolveSelectedEdgeCandidates(
        Array.from({ length: 257 }, () => reference(0)),
        candidates,
        sourceId,
      ),
    ).toThrow("1–256")
  })
})
