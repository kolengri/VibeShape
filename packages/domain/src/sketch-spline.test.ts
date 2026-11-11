import { describe, expect, it } from "bun:test"
import { orphanModelReferencesToFeature } from "./feature-removal-intent"
import {
  featureIdSchema,
  sketchConstraintIdSchema,
  sketchEntityIdSchema,
  sketchExternalReferenceIdSchema,
  sketchIdSchema,
} from "./identifiers"
import {
  projectedExternalSketchEntities,
  type SketchEntity,
  type SketchRecord,
  sketchRecordSchema,
} from "./sketch"
import {
  appendSketchSpline,
  createEmptySketch,
  removeSketchEntities,
  replaceSketchExternalReference,
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
    const through = segments.flatMap((segment) => [segment.startPointId, segment.endPointId])
    // Each segment starts where the previous one ends.
    expect(new Set(through).size).toBe(4)
    expect(
      through.map((pointId) => {
        const { x, y } = point(sketch, pointId)
        return { x, y }
      }),
    ).toEqual([wave[0], wave[1], wave[1], wave[2], wave[2], wave[3]])
    const joins = sketch.constraints.flatMap((constraint) =>
      constraint.type === "tangent-join"
        ? [[constraint.id, constraint.incomingCurveId, constraint.outgoingCurveId]]
        : [],
    )
    const [first, second, third] = segments as [Cubic, Cubic, Cubic]
    expect<string[][]>(joins).toEqual([
      [createdConstraintIds[0] as string, first.id, second.id],
      [createdConstraintIds[1] as string, second.id, third.id],
    ])
    for (const [incoming, outgoing] of [
      [first, second],
      [second, third],
    ] as const) {
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

describe("model spline references", () => {
  const featureId = featureIdSchema.parse("01900000-0000-7000-8000-00000000f000")
  const signature = {
    kind: "edge" as const,
    geometryClass: "BSPLINE_CURVE",
    measure: 24,
    centroid: [10, 2, 0] as [number, number, number],
    bounds: {
      min: [0, 0, 0] as [number, number, number],
      max: [20, 4, 0] as [number, number, number],
    },
    boundaryCount: 2,
    adjacentGeometryClasses: [],
  }
  const reference = {
    schemaVersion: 0 as const,
    id: sketchExternalReferenceIdSchema.parse(id(700)),
    kind: "model-spline" as const,
    reference: {
      schemaVersion: 0 as const,
      featureId,
      kind: "edge" as const,
      semanticRole: "edge.spline",
      signature,
    },
    projectedCurveIds: [id(710), id(711)],
    projectedPointIds: Array.from({ length: 7 }, (_, index) => id(720 + index)),
  }
  const base = createEmptySketch({ id: sketchIdSchema.parse(id(901)), label: "Use", plane: "xy" })
  const parse = (candidate: object) =>
    sketchRecordSchema.safeParse({ ...base, externalReferences: [candidate] })

  it("persists only the topology reference and chained projected identities", () => {
    const parsed = parse(reference)
    expect(parsed.success).toBe(true)
    if (!parsed.success) return
    const projected = projectedExternalSketchEntities(parsed.data.externalReferences ?? [])
    expect(projected.filter(({ type }) => type === "point")).toHaveLength(7)
    expect(projected.filter(({ type }) => type === "cubic-bezier")).toEqual([
      expect.objectContaining({ id: id(710), startPointId: id(720), endPointId: id(723) }),
      expect.objectContaining({ id: id(711), startPointId: id(723), endPointId: id(726) }),
    ])
    expect(JSON.stringify(parsed.data)).not.toContain('"x"')
  })

  it("rejects mismatched identity counts, duplicates and analytical source edges", () => {
    expect(
      parse({ ...reference, projectedPointIds: reference.projectedPointIds.slice(0, 6) }).success,
    ).toBe(false)
    expect(
      parse({
        ...reference,
        projectedPointIds: [...reference.projectedPointIds.slice(0, 6), id(710)],
      }).success,
    ).toBe(false)
    expect(
      parse({
        ...reference,
        reference: { ...reference.reference, signature: { ...signature, geometryClass: "CIRCLE" } },
      }).success,
    ).toBe(false)
  })

  it("accepts constraints only on the stable end points of a projected chain", () => {
    const pointId = sketchEntityIdSchema.parse(id(760))
    const withConstraint = (target: string) =>
      sketchRecordSchema.safeParse({
        ...base,
        entities: [{ schemaVersion: 0, id: pointId, type: "point", x: 0, y: 0 }],
        externalReferences: [reference],
        constraints: [
          {
            schemaVersion: 0,
            id: sketchConstraintIdSchema.parse(id(761)),
            type: "coincident",
            firstPointId: pointId,
            secondPointId: target,
          },
        ],
      })
    expect(withConstraint(id(720)).success).toBe(true)
    expect(withConstraint(id(726)).success).toBe(true)
    // Interior joints and handles move along the edge when its segment count changes.
    for (const interior of [id(721), id(723), id(725)]) {
      const parsed = withConstraint(interior)
      expect(parsed.success).toBe(false)
      expect(parsed.error?.issues[0]?.message).toContain("start and end points")
    }
  })

  it("orphans on feature deletion and repairs without changing projected identities", () => {
    const sketch = sketchRecordSchema.parse({ ...base, externalReferences: [reference] })
    const orphaned = orphanModelReferencesToFeature(sketch, featureId)
    expect(orphaned.externalReferences?.[0]).toMatchObject({
      schemaVersion: 1,
      orphanedSource: { kind: "deleted-feature", featureId },
    })
    const repaired = replaceSketchExternalReference(sketch, reference.id, {
      kind: "model-spline",
      reference: { ...reference.reference, semanticRole: "edge.other-spline" },
    })
    expect(repaired.externalReferences?.[0]).toMatchObject({
      projectedCurveIds: reference.projectedCurveIds,
      projectedPointIds: reference.projectedPointIds,
      reference: { semanticRole: "edge.other-spline" },
    })
    expect(() =>
      replaceSketchExternalReference(sketch, reference.id, {
        kind: "model-line",
        reference: { ...reference.reference, signature: { ...signature, geometryClass: "LINE" } },
      }),
    ).toThrow(TypeError)
  })
})
