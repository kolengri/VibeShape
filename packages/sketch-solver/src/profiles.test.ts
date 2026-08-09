import { sketchRecordSchema } from "@vibeshape/domain/sketch"
import { describe, expect, it } from "vitest"
import {
  detectSketchProfiles,
  MAX_PROFILE_CURVES,
  MAX_PROFILE_DIAGNOSTIC_ENTITY_IDS,
} from "./profiles"

function id(index: number) {
  return `018f0000-0000-7000-8000-${String(index).padStart(12, "0")}`
}

function point(index: number, x: number, y: number, construction = false) {
  return { schemaVersion: 0 as const, id: id(index), type: "point" as const, x, y, construction }
}

function line(index: number, startIndex: number, endIndex: number, construction = false) {
  return {
    schemaVersion: 0 as const,
    id: id(index),
    type: "line" as const,
    startPointId: id(startIndex),
    endPointId: id(endIndex),
    construction,
  }
}

function circle(index: number, centerIndex: number, radius: number, construction = false) {
  return {
    schemaVersion: 0 as const,
    id: id(index),
    type: "circle" as const,
    centerPointId: id(centerIndex),
    radius,
    construction,
  }
}

function arc(index: number, centerIndex: number, startIndex: number, endIndex: number) {
  return {
    schemaVersion: 0 as const,
    id: id(index),
    type: "arc" as const,
    centerPointId: id(centerIndex),
    startPointId: id(startIndex),
    endPointId: id(endIndex),
    construction: false,
  }
}

function sketch(
  entities: readonly ReturnType<typeof point | typeof line | typeof circle | typeof arc>[],
) {
  return sketchRecordSchema.parse({
    schemaVersion: 0,
    id: id(9_000),
    label: "Profile fixture",
    plane: "xy",
    entities,
    constraints: [],
  })
}

function authoredSolution(value: ReturnType<typeof sketch>) {
  return {
    points: value.entities.flatMap((entity) =>
      entity.type === "point" ? [{ entityId: entity.id, x: entity.x, y: entity.y }] : [],
    ),
    circles: value.entities.flatMap((entity) =>
      entity.type === "circle" ? [{ entityId: entity.id, radius: entity.radius }] : [],
    ),
  }
}

describe("sketch profile detection", () => {
  it("extracts a deterministic rectangular profile", () => {
    const value = sketch([
      point(1, 0, 0),
      point(2, 20, 0),
      point(3, 20, 10),
      point(4, 0, 10),
      line(101, 1, 2),
      line(102, 2, 3),
      line(103, 3, 4),
      line(104, 4, 1),
    ])

    const result = detectSketchProfiles(value, authoredSolution(value))

    expect(result.diagnostics).toEqual([])
    expect(result.profiles).toHaveLength(1)
    expect(result.profiles[0]).toMatchObject({
      profileIndex: 0,
      outerLoopIndex: 0,
      holeLoopIndices: [],
      area: 200,
      perimeter: 60,
    })
    expect(result.loops[0]?.segments).toHaveLength(4)
  })

  it("groups a nested circle as a hole and preserves an island", () => {
    const value = sketch([point(1, 0, 0), circle(101, 1, 10), circle(102, 1, 6), circle(103, 1, 2)])

    const result = detectSketchProfiles(value, authoredSolution(value))

    expect(result.diagnostics).toEqual([])
    expect(result.loops.map(({ depth, parentLoopIndex }) => ({ depth, parentLoopIndex }))).toEqual([
      { depth: 0, parentLoopIndex: null },
      { depth: 1, parentLoopIndex: 0 },
      { depth: 2, parentLoopIndex: 1 },
    ])
    expect(result.profiles).toHaveLength(2)
    expect(result.profiles[0]?.holeLoopIndices).toEqual([1])
    expect(result.profiles[0]?.area).toBeCloseTo(Math.PI * (10 ** 2 - 6 ** 2), 6)
    expect(result.profiles[1]?.area).toBeCloseTo(Math.PI * 2 ** 2, 6)
  })

  it("joins two compatible semicircular arcs into one profile", () => {
    const value = sketch([
      point(1, 0, 0),
      point(2, 5, 0),
      point(3, -5, 0),
      arc(101, 1, 2, 3),
      arc(102, 1, 3, 2),
    ])

    const result = detectSketchProfiles(value, authoredSolution(value))

    expect(result.diagnostics).toEqual([])
    expect(result.profiles).toHaveLength(1)
    expect(result.profiles[0]?.area).toBeCloseTo(Math.PI * 5 ** 2, 6)
    expect(result.loops[0]?.segments).toHaveLength(2)
  })

  it("snaps distinct solved endpoint identities within tolerance", () => {
    const value = sketch([
      point(1, 0, 0),
      point(2, 10, 0),
      point(3, 10, 0),
      point(4, 10, 10),
      point(5, 10, 10),
      point(6, 0, 10),
      point(7, 0, 10),
      point(8, 0, 0),
      line(101, 1, 2),
      line(102, 3, 4),
      line(103, 5, 6),
      line(104, 7, 8),
    ])

    const result = detectSketchProfiles(value, authoredSolution(value))

    expect(result.diagnostics).toEqual([])
    expect(result.profiles[0]?.area).toBeCloseTo(100, 8)
  })

  it("reports open, intersecting, duplicate, and degenerate geometry without guessing", () => {
    const open = sketch([point(1, 0, 0), point(2, 10, 0), line(101, 1, 2)])
    expect(detectSketchProfiles(open, authoredSolution(open))).toMatchObject({
      profiles: [],
      diagnostics: [{ code: "open-chain", entityIds: [id(101)] }],
    })

    const crossing = sketch([
      point(1, -5, 0),
      point(2, 5, 0),
      point(3, 0, -5),
      point(4, 0, 5),
      line(101, 1, 2),
      line(102, 3, 4),
    ])
    expect(detectSketchProfiles(crossing, authoredSolution(crossing))).toMatchObject({
      profiles: [],
      diagnostics: [{ code: "intersecting-entities", entityIds: [id(101), id(102)] }],
    })

    const duplicate = sketch([
      point(1, 0, 0),
      point(2, 10, 0),
      point(3, 0, 0),
      point(4, 10, 0),
      line(101, 1, 2),
      line(102, 3, 4),
    ])
    expect(detectSketchProfiles(duplicate, authoredSolution(duplicate))).toMatchObject({
      profiles: [],
      diagnostics: [{ code: "duplicate-entity", entityIds: [id(101), id(102)] }],
    })

    const degenerate = sketch([point(1, 0, 0), point(2, 10, 0), line(101, 1, 2)])
    expect(detectSketchProfiles(degenerate, { points: [], circles: [] })).toMatchObject({
      profiles: [],
      diagnostics: [{ code: "degenerate-entity", entityIds: [id(101)] }],
    })
  })

  it("ignores construction curves when extracting regions", () => {
    const value = sketch([point(1, 0, 0), circle(101, 1, 5), circle(102, 1, 3, true)])

    const result = detectSketchProfiles(value, authoredSolution(value))

    expect(result.diagnostics).toEqual([])
    expect(result.profiles).toHaveLength(1)
    expect(result.profiles[0]?.area).toBeCloseTo(Math.PI * 25, 6)
  })

  it("keeps output stable when authored entity order changes", () => {
    const entities = [
      point(1, 0, 0),
      point(2, 20, 0),
      point(3, 20, 10),
      point(4, 0, 10),
      line(101, 1, 2),
      line(102, 2, 3),
      line(103, 3, 4),
      line(104, 4, 1),
    ] as const
    const forward = sketch(entities)
    const reversed = sketch([...entities].reverse())

    expect(detectSketchProfiles(reversed, authoredSolution(reversed))).toEqual(
      detectSketchProfiles(forward, authoredSolution(forward)),
    )
  })

  it("rejects invalid solved values and caps budget diagnostics", () => {
    const value = sketch([point(1, 0, 0), circle(101, 1, 5)])
    const invalidSolution = authoredSolution(value)
    expect(
      detectSketchProfiles(value, {
        ...invalidSolution,
        points: invalidSolution.points.map((point) => ({ ...point, x: Number.NaN })),
      }),
    ).toMatchObject({ profiles: [], diagnostics: [{ code: "invalid-solution" }] })

    const centers = Array.from({ length: MAX_PROFILE_CURVES + 1 }, (_, index) =>
      point(index + 1, index * 3, 0),
    )
    const circles = Array.from({ length: MAX_PROFILE_CURVES + 1 }, (_, index) =>
      circle(index + 10_000, index + 1, 1),
    )
    const oversized = sketch([...centers, ...circles])
    const result = detectSketchProfiles(oversized, authoredSolution(oversized))

    expect(result.profiles).toEqual([])
    expect(result.diagnostics).toHaveLength(1)
    expect(result.diagnostics[0]).toMatchObject({ code: "profile-budget-exceeded" })
    expect(result.diagnostics[0]?.entityIds).toHaveLength(MAX_PROFILE_DIAGNOSTIC_ENTITY_IDS)
  })
})
