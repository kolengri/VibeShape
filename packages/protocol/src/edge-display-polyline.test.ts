import { expect, it } from "vitest"
import { MAX_TOPOLOGY_DISPLAY_POLYLINE_POINTS, topologyCandidatesSchema } from "./geometry-worker"

const candidate = (candidateId: string, points: number) => ({
  candidateId,
  kind: "edge" as const,
  lineageTokens: [],
  signature: {
    kind: "edge" as const,
    geometryClass: "BSPLINE",
    measure: 1,
    centroid: [0, 0, 0] as [number, number, number],
    bounds: {
      min: [0, 0, 0] as [number, number, number],
      max: [1, 1, 1] as [number, number, number],
    },
    boundaryCount: 2,
    adjacentGeometryClasses: [],
  },
  edgePolyline: Array.from(
    { length: points },
    (_, index) => [index, 0, 0] as [number, number, number],
  ),
})

it("rejects topology candidates over the aggregate display point budget", () => {
  const result = topologyCandidatesSchema.safeParse(
    Array.from({ length: 64 }, (_, index) => candidate(`edge:${index}`, 1025)),
  )
  expect(result.success).toBe(false)
  expect(MAX_TOPOLOGY_DISPLAY_POLYLINE_POINTS).toBe(65_536)
})

it("accepts the aggregate display point budget exactly", () => {
  const result = topologyCandidatesSchema.safeParse([
    ...Array.from({ length: 63 }, (_, index) => candidate(`edge:${index}`, 1025)),
    candidate("edge:63", 961),
  ])
  expect(result.success).toBe(true)
})

it.each([0, 1, 1026])("rejects an invalid per-edge polyline size: %s", (points) => {
  expect(topologyCandidatesSchema.safeParse([candidate("edge:invalid", points)]).success).toBe(
    false,
  )
})

it("rejects non-edge and non-finite display geometry", () => {
  expect(
    topologyCandidatesSchema.safeParse([
      {
        ...candidate("face:0", 2),
        kind: "face",
        signature: { ...candidate("face:0", 2).signature, kind: "face", geometryClass: "PLANE" },
      },
    ]).success,
  ).toBe(false)
  expect(
    topologyCandidatesSchema.safeParse([
      {
        ...candidate("edge:nan", 2),
        edgePolyline: [
          [Number.NaN, 0, 0],
          [1, 0, 0],
        ],
      },
    ]).success,
  ).toBe(false)
})
