import { describe, expect, it } from "bun:test"
import {
  boxFeatureContentParametersSchema,
  extrusionFeatureContentParametersSchema,
} from "@vibeshape/protocol"
import { boxFeatureSemanticRole, extrusionFeatureSemanticRole } from "./engine"
import type { TopologyCandidateContext } from "./topology-signatures"

function candidate(
  kind: TopologyCandidateContext["kind"],
  geometryClass: string,
  centroid: [number, number, number],
  direction?: [number, number, number],
): TopologyCandidateContext {
  return {
    candidateId: `${kind}:0`,
    kind,
    signature: {
      kind,
      geometryClass,
      measure: 0,
      centroid,
      bounds: { min: centroid, max: centroid },
      ...(direction ? { direction, directionMode: "axis" as const } : {}),
      boundaryCount: kind === "edge" ? 2 : 0,
      adjacentGeometryClasses: [],
    },
  }
}

describe("feature topology semantic roles", () => {
  it.each([
    [false, false, 3, -3, 10],
    [true, false, 3, -10, 3],
    [true, false, null, -10, 0],
    [true, true, null, -5, 5],
  ] as const)(
    "keeps extrusion cap roles at increasing physical bounds (%s, %s, %s)",
    (reversed, symmetric, secondDistance, start, end) => {
      const parameters = {
        ...extrusionFeatureContentParametersSchema.parse({
          sketchId: "0195b5ac-b220-7a2c-8c33-67a36a7f3201",
          plane: "xy",
          outer: {
            sourceEntityIds: ["0195b5ac-b220-7a2c-8c33-67a36a7f3211"],
            segments: [
              {
                entityId: "0195b5ac-b220-7a2c-8c33-67a36a7f3211",
                type: "circle",
                center: [0, 0],
                radius: 2,
              },
            ],
          },
          holes: [],
          distance: 10,
          symmetric,
          operation: "new",
        }),
        reversed,
        secondDistance,
      }
      expect(
        extrusionFeatureSemanticRole(
          candidate("face", "PLANE", [0, 0, start], [0, 0, -1]),
          parameters,
        ),
      ).toBe("extrusion.cap.start")
      expect(
        extrusionFeatureSemanticRole(
          candidate("face", "PLANE", [0, 0, end], [0, 0, 1]),
          parameters,
        ),
      ).toBe("extrusion.cap.end")
      if (end !== 0) {
        expect(
          extrusionFeatureSemanticRole(
            candidate("face", "PLANE", [0, 0, 0], [0, 0, 1]),
            parameters,
          ),
        ).toBeUndefined()
      }
    },
  )

  it("keeps box vertex and edge roles stable across parameter edits", () => {
    const initial = boxFeatureContentParametersSchema.parse({
      width: 20,
      depth: 10,
      height: 8,
      centered: false,
      origin: [0, 0, 0],
    })
    const edited = boxFeatureContentParametersSchema.parse({
      width: 40,
      depth: 30,
      height: 16,
      centered: false,
      origin: [0, 0, 0],
    })

    const initialVertexRole = boxFeatureSemanticRole(
      candidate("vertex", "POINT", [-10, -5, 0]),
      initial,
    )
    const initialEdgeRole = boxFeatureSemanticRole(
      candidate("edge", "LINE", [0, -5, 0], [1, 0, 0]),
      initial,
    )
    expect(initialVertexRole).toBe("primitive.box.vertex.x-min.y-min.z-min")
    expect(initialVertexRole).toBe(
      boxFeatureSemanticRole(candidate("vertex", "POINT", [-20, -15, 0]), edited),
    )
    expect(initialEdgeRole).toBe("primitive.box.edge.x.y-min.z-min")
    expect(initialEdgeRole).toBe(
      boxFeatureSemanticRole(candidate("edge", "LINE", [0, -15, 0], [1, 0, 0]), edited),
    )
  })

  it("anchors extrusion vertices and line edges to sketch entity identities", () => {
    const sketchId = "0195b5ac-b220-7a2c-8c33-67a36a7f3201"
    const firstPointId = "0195b5ac-b220-7a2c-8c33-67a36a7f3202"
    const secondPointId = "0195b5ac-b220-7a2c-8c33-67a36a7f3203"
    const thirdPointId = "0195b5ac-b220-7a2c-8c33-67a36a7f3204"
    const firstLineId = "0195b5ac-b220-7a2c-8c33-67a36a7f3211"
    const secondLineId = "0195b5ac-b220-7a2c-8c33-67a36a7f3212"
    const thirdLineId = "0195b5ac-b220-7a2c-8c33-67a36a7f3213"
    const parameters = (distance: number, size: number) =>
      extrusionFeatureContentParametersSchema.parse({
        sketchId,
        plane: "xy",
        outer: {
          sourceEntityIds: [firstLineId, secondLineId, thirdLineId],
          segments: [
            {
              entityId: firstLineId,
              type: "line",
              startPointId: firstPointId,
              endPointId: secondPointId,
              start: [0, 0],
              end: [size, 0],
            },
            {
              entityId: secondLineId,
              type: "line",
              startPointId: secondPointId,
              endPointId: thirdPointId,
              start: [size, 0],
              end: [0, size],
            },
            {
              entityId: thirdLineId,
              type: "line",
              startPointId: thirdPointId,
              endPointId: firstPointId,
              start: [0, size],
              end: [0, 0],
            },
          ],
        },
        holes: [],
        distance,
        symmetric: false,
        operation: "new",
      })
    const initial = parameters(10, 20)
    const edited = parameters(25, 35)
    const flippedExtent = { ...initial, reversed: true, secondDistance: 3 }
    expect(
      extrusionFeatureSemanticRole(candidate("vertex", "POINT", [0, 0, -10]), flippedExtent),
    ).toBe(`extrusion.vertex.${firstPointId}.cap.start`)
    expect(
      extrusionFeatureSemanticRole(candidate("vertex", "POINT", [0, 0, 3]), flippedExtent),
    ).toBe(`extrusion.vertex.${firstPointId}.cap.end`)
    expect(
      extrusionFeatureSemanticRole(
        candidate("edge", "LINE", [10, 0, -10], [1, 0, 0]),
        flippedExtent,
      ),
    ).toBe(`extrusion.edge.${firstLineId}.cap.start`)
    expect(
      extrusionFeatureSemanticRole(
        candidate("edge", "LINE", [0, 0, -3.5], [0, 0, 1]),
        flippedExtent,
      ),
    ).toBe(`extrusion.edge.${firstPointId}.span`)

    const initialVertexRole = extrusionFeatureSemanticRole(
      candidate("vertex", "POINT", [0, 0, 10]),
      initial,
    )
    const initialCapEdgeRole = extrusionFeatureSemanticRole(
      candidate("edge", "LINE", [10, 0, 0], [1, 0, 0]),
      initial,
    )
    const initialSpanEdgeRole = extrusionFeatureSemanticRole(
      candidate("edge", "LINE", [0, 0, 5], [0, 0, 1]),
      initial,
    )
    expect(initialVertexRole).toBe(`extrusion.vertex.${firstPointId}.cap.end`)
    expect(initialVertexRole).toBe(
      extrusionFeatureSemanticRole(candidate("vertex", "POINT", [0, 0, 25]), edited),
    )
    expect(initialCapEdgeRole).toBe(`extrusion.edge.${firstLineId}.cap.start`)
    expect(initialCapEdgeRole).toBe(
      extrusionFeatureSemanticRole(candidate("edge", "LINE", [17.5, 0, 0], [1, 0, 0]), edited),
    )
    expect(initialSpanEdgeRole).toBe(`extrusion.edge.${firstPointId}.span`)
    expect(initialSpanEdgeRole).toBe(
      extrusionFeatureSemanticRole(candidate("edge", "LINE", [0, 0, 12.5], [0, 0, 1]), edited),
    )

    const coincidentPointId = "0195b5ac-b220-7a2c-8c33-67a36a7f3205"
    const colliding = extrusionFeatureContentParametersSchema.parse({
      ...initial,
      outer: {
        ...initial.outer,
        segments: initial.outer.segments.map((segment) =>
          segment.entityId === secondLineId
            ? { ...segment, startPointId: coincidentPointId }
            : segment,
        ),
      },
    })
    expect(
      extrusionFeatureSemanticRole(candidate("vertex", "POINT", [20, 0, 0]), colliding),
    ).toBeUndefined()
  })
})
