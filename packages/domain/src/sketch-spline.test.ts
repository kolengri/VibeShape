import { describe, expect, it } from "bun:test"
import { sketchConstraintIdSchema, sketchEntityIdSchema, sketchIdSchema } from "./identifiers"
import { type SketchEntity, type SketchRecord, sketchRecordSchema } from "./sketch"
import {
  appendSketchSpline,
  createEmptySketch,
  removeSketchEntities,
  type SketchPoint2,
} from "./sketch-edit"
import { interpolatingSplineControls } from "./sketch-spline"

const id = (value: number) => `01900000-0000-7000-8000-${value.toString(16).padStart(12, "0")}`
const wave = [
  { x: 0, y: 0 },
  { x: 10, y: 6 },
  { x: 20, y: 0 },
  { x: 30, y: 5 },
] as const

function spline(points: readonly SketchPoint2[], closed = false, base?: SketchRecord) {
  let entity = 1
  let constraint = 1
  return appendSketchSpline(
    base ?? createEmptySketch({ id: sketchIdSchema.parse(id(900)), label: "Spline", plane: "xy" }),
    {
      points: points.map((point) => ({ kind: "new", point })),
      closed,
      createEntityId: () => sketchEntityIdSchema.parse(id(entity++)),
      createConstraintId: () => sketchConstraintIdSchema.parse(id(500 + constraint++)),
    },
  )
}

type Cubic = Extract<SketchEntity, { type: "cubic-bezier" }>
function cubics(sketch: SketchRecord): Cubic[] {
  return sketch.entities.flatMap((entity) => (entity.type === "cubic-bezier" ? [entity] : []))
}
function point(sketch: SketchRecord, pointId: string) {
  const entity = sketch.entities.find(({ id: entityId }) => entityId === pointId)
  if (entity?.type !== "point") throw new Error(`Missing point ${pointId}.`)
  return entity
}

describe("interpolating sketch splines", () => {
  it("chains cubic segments through shared through-point identities with G1 joins", () => {
    const { sketch, createdConstraintIds, createdEntityIds } = spline(wave)
    const segments = cubics(sketch)
    expect(segments).toHaveLength(3)
    // Four through-points, two handles and one curve per segment.
    expect(createdEntityIds).toHaveLength(4 + 3 * 3)
    for (const [index, segment] of segments.entries()) {
      const { x, y } = point(sketch, segment.startPointId)
      expect({ x, y }).toEqual({ ...wave[index] } as SketchPoint2)
      const end = point(sketch, segment.endPointId)
      expect({ x: end.x, y: end.y }).toEqual({ ...wave[index + 1] } as SketchPoint2)
      if (index > 0)
        expect<string>(segment.startPointId).toBe(segments[index - 1]?.endPointId ?? "")
    }
    const joins = sketch.constraints.filter(({ type }) => type === "tangent-join")
    expect(joins.map(({ id: constraintId }) => constraintId)).toEqual([...createdConstraintIds])
    expect(joins).toEqual([
      expect.objectContaining({
        incomingCurveId: segments[0]?.id,
        outgoingCurveId: segments[1]?.id,
      }),
      expect.objectContaining({
        incomingCurveId: segments[1]?.id,
        outgoingCurveId: segments[2]?.id,
      }),
    ])
    for (const [incoming, outgoing] of [
      [segments[0], segments[1]],
      [segments[1], segments[2]],
    ] as const) {
      if (!incoming || !outgoing) throw new Error("Missing join segments.")
      const join = point(sketch, incoming.endPointId)
      const before = point(sketch, incoming.control2PointId)
      const after = point(sketch, outgoing.control1PointId)
      const a = { x: join.x - before.x, y: join.y - before.y }
      const b = { x: after.x - join.x, y: after.y - join.y }
      expect(a.x * b.y - a.y * b.x).toBeCloseTo(0, 12)
      expect(a.x * b.x + a.y * b.y).toBeGreaterThan(0)
    }
    expect(sketchRecordSchema.parse(JSON.parse(JSON.stringify(sketch)))).toEqual(sketch)
  })

  it("closes on the first through-point entity and joins the seam", () => {
    const square = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ]
    const { sketch } = spline(square, true)
    const segments = cubics(sketch)
    expect(segments).toHaveLength(4)
    expect<string | undefined>(segments.at(-1)?.endPointId).toBe(segments[0]?.startPointId)
    expect(sketch.entities.filter(({ type }) => type === "point")).toHaveLength(4 + 4 * 2)
    const joins = sketch.constraints.flatMap((constraint) =>
      constraint.type === "tangent-join"
        ? [[constraint.incomingCurveId, constraint.outgoingCurveId]]
        : [],
    )
    expect<string[][]>(joins).toEqual(
      segments.map((segment, index) => [
        segment.id,
        segments[(index + 1) % segments.length]?.id ?? "",
      ]),
    )
  })

  it("draws a two-point open spline as one straight cubic", () => {
    const [controls] = interpolatingSplineControls(
      [
        { x: 0, y: 0 },
        { x: 9, y: 0 },
      ],
      false,
    )
    expect(controls).toEqual({ control1: { x: 3, y: 0 }, control2: { x: 6, y: 0 } })
  })

  it("rejects too few, repeated or excessive through-points", () => {
    expect(() => spline(wave.slice(0, 1))).toThrow(RangeError)
    expect(() => spline(wave.slice(0, 2), true)).toThrow(RangeError)
    expect(() => spline([wave[0], wave[0], wave[1]])).toThrow(RangeError)
    // The closing chord counts as a segment too.
    expect(() => spline([wave[0], wave[1], wave[0]], true)).toThrow(RangeError)
    const many = Array.from({ length: 129 }, (_, index) => ({ x: index, y: index % 2 }))
    expect(() => spline(many)).toThrow(RangeError)
  })

  it("rejects tangent joins that do not share the through-point or reference other curves", () => {
    const { sketch } = spline(wave)
    const [first, second, third] = cubics(sketch)
    const [join] = sketch.constraints
    if (!first || !second || !third || join?.type !== "tangent-join")
      throw new Error("Missing fixture geometry.")
    const parse = (constraint: object) =>
      sketchRecordSchema.safeParse({ ...sketch, constraints: [constraint] }).success
    expect(parse(join)).toBe(true)
    expect(parse({ ...join, outgoingCurveId: third.id })).toBe(false)
    expect(parse({ ...join, incomingCurveId: second.id, outgoingCurveId: first.id })).toBe(false)
    expect(parse({ ...join, outgoingCurveId: first.id })).toBe(false)
    expect(parse({ ...join, incomingCurveId: first.startPointId })).toBe(false)
  })

  it("drops the joins of a removed segment and keeps the remaining chain valid", () => {
    const { sketch } = spline(wave)
    const [, middle] = cubics(sketch)
    if (!middle) throw new Error("Missing middle segment.")
    const removed = removeSketchEntities(sketch, [middle.id])
    expect(cubics(removed)).toHaveLength(2)
    expect(removed.constraints.filter(({ type }) => type === "tangent-join")).toEqual([])
    // Shared through-points stay owned by the remaining neighbors.
    expect(() => point(removed, middle.startPointId)).not.toThrow()
    expect(() => point(removed, middle.control1PointId)).toThrow()
  })

  it("reuses existing through-points without duplicating them", () => {
    const first = spline(wave.slice(0, 2))
    const anchor = cubics(first.sketch)[0]?.endPointId
    if (!anchor) throw new Error("Missing anchor point.")
    let entity = 100
    const continued = appendSketchSpline(first.sketch, {
      points: [
        { kind: "existing", pointId: anchor },
        { kind: "new", point: wave[2] },
      ],
      createEntityId: () => sketchEntityIdSchema.parse(id(entity++)),
      createConstraintId: () => sketchConstraintIdSchema.parse(id(800)),
    })
    expect(cubics(continued.sketch)[1]?.startPointId).toBe(anchor)
    expect(continued.createdConstraintIds).toEqual([])
  })
})
