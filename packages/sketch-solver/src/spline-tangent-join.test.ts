import { beforeAll, describe, expect, it } from "bun:test"
import {
  sketchConstraintIdSchema,
  sketchEntityIdSchema,
  sketchIdSchema,
} from "@vibeshape/domain/identifiers"
import type { SketchRecord } from "@vibeshape/domain/sketch"
import { appendSketchSpline, createEmptySketch } from "@vibeshape/domain/sketch-edit"
import { createLengthQuantity } from "@vibeshape/domain/units"
import initializeSolver from "../runtime/vibeshape_slvs.mjs"
import type { NativeSketchSolverModule } from "./abi"
import { compileSketchSystem, type SketchSolveContinuation, solveSketchRecord } from "./production"
import { solveSketchSystem } from "./solver"

let module: NativeSketchSolverModule
beforeAll(async () => {
  module = (await initializeSolver()) as NativeSketchSolverModule
})

const id = (value: number) => `01900000-0000-7000-8000-${value.toString(16).padStart(12, "0")}`
const throughPoints = [
  { x: 0, y: 0 },
  { x: 10, y: 6 },
  { x: 20, y: 0 },
  { x: 30, y: 5 },
] as const

function spline(points: readonly { x: number; y: number }[] = throughPoints, closed = false) {
  let entity = 1
  let constraint = 1
  return appendSketchSpline(
    createEmptySketch({ id: sketchIdSchema.parse(id(4_000)), label: "Spline", plane: "xy" }),
    {
      points: points.map((point) => ({ kind: "new", point })),
      closed,
      createEntityId: () => sketchEntityIdSchema.parse(id(entity++)),
      createConstraintId: () => sketchConstraintIdSchema.parse(id(2_000 + constraint++)),
    },
  )
}

function solved(
  sketch: SketchRecord,
  draggedPoints: { entityId: string; x: number; y: number }[],
  continuation: SketchSolveContinuation | null = null,
) {
  const result = solveSketchRecord(module, { revision: 1, sketch, draggedPoints, continuation })
  if (!result.ok) throw new Error(result.diagnostic.message)
  return result.solution
}

function cubics(sketch: SketchRecord) {
  return sketch.entities.flatMap((entity) => (entity.type === "cubic-bezier" ? [entity] : []))
}

/** Unit incoming and outgoing tangents at every interior join of the solved chain. */
function joinTangents(sketch: SketchRecord, points: ReadonlyMap<string, { x: number; y: number }>) {
  return sketch.constraints.flatMap((constraint) => {
    if (constraint.type !== "tangent-join") return []
    const incoming = cubics(sketch).find(
      ({ id: curveId }) => curveId === constraint.incomingCurveId,
    )
    const outgoing = cubics(sketch).find(
      ({ id: curveId }) => curveId === constraint.outgoingCurveId,
    )
    if (!incoming || !outgoing) throw new Error("A tangent join must reference two cubics.")
    const at = (pointId: string) => {
      const point = points.get(pointId)
      if (!point) throw new Error(`Missing solved point ${pointId}.`)
      return point
    }
    const join = at(incoming.endPointId)
    const before = at(incoming.control2PointId)
    const after = at(outgoing.control1PointId)
    const a = { x: join.x - before.x, y: join.y - before.y }
    const b = { x: after.x - join.x, y: after.y - join.y }
    const scale = Math.hypot(a.x, a.y) * Math.hypot(b.x, b.y)
    return [
      {
        constraintId: constraint.id as string,
        incomingLength: Math.hypot(a.x, a.y),
        outgoingLength: Math.hypot(b.x, b.y),
        cross: (a.x * b.y - a.y * b.x) / scale,
        dot: (a.x * b.x + a.y * b.y) / scale,
        // Signed outgoing handle length along the incoming tangent.
        outgoingAhead: (a.x * b.x + a.y * b.y) / Math.hypot(a.x, a.y),
      },
    ]
  })
}

function continuationFrom(
  sketch: SketchRecord,
  solution: ReturnType<typeof solved>,
): SketchSolveContinuation {
  return {
    schemaVersion: 0,
    sketchId: sketch.id,
    sourceRevision: 1,
    points: [...solution.points],
    circles: [...solution.circles],
  }
}

function solvedPointMap(solution: ReturnType<typeof solved>) {
  return new Map(solution.points.map(({ entityId, x, y }) => [entityId as string, { x, y }]))
}

describe("spline tangent joins in the pinned SolveSpace solver", () => {
  it("carries both handles when a through-point is dragged in streamed pointer steps", () => {
    const { sketch } = spline()
    const join = cubics(sketch)[1]
    if (!join) throw new Error("The fixture must contain a middle segment.")
    let continuation: SketchSolveContinuation | null = null
    let from = { x: 10, y: 6 }
    for (const target of [
      { x: 11, y: 9 },
      { x: 14, y: 2 },
      { x: 7, y: 12 },
    ]) {
      for (let step = 1; step <= 12; step += 1) {
        const pointer = {
          x: from.x + ((target.x - from.x) * step) / 12,
          y: from.y + ((target.y - from.y) * step) / 12,
        }
        const solution = solved(sketch, [{ entityId: join.startPointId, ...pointer }], continuation)
        expect(solution.status).toBe("under-constrained")
        expect(solution.failedConstraintIds).toEqual([])
        continuation = continuationFrom(sketch, solution)
        const tangents = joinTangents(sketch, solvedPointMap(solution))
        expect(tangents).toHaveLength(2)
        for (const { cross, dot } of tangents) {
          expect(Math.abs(cross)).toBeLessThan(1e-6)
          expect(dot).toBeGreaterThan(0)
        }
      }
      const points = solvedPointMap(solved(sketch, [], continuation))
      expect(points.get(join.startPointId)?.x).toBeCloseTo(target.x, 6)
      expect(points.get(join.startPointId)?.y).toBeCloseTo(target.y, 6)
      from = target
    }
  })

  it("never forms a cusp when a handle is pushed through its join in streamed steps", () => {
    const { sketch } = spline()
    const [incoming, outgoing] = cubics(sketch)
    if (!incoming || !outgoing) throw new Error("The fixture must contain two segments.")
    let continuation: SketchSolveContinuation | null = null
    // The outgoing handle starts near (13.6, 5.0); drag it back past the join at (10, 6). Every step
    // converges, and once behind the join the opposite handle turns with it (still G1).
    for (let step = 1; step <= 12; step += 1) {
      const pointer = { x: 13.6 - step * 0.5, y: 5 + step * 0.05 }
      const solution = solved(
        sketch,
        [{ entityId: outgoing.control1PointId, ...pointer }],
        continuation,
      )
      expect(solution.failedConstraintIds).toEqual([])
      expectStrictG1OrFailedJoins(sketch, solution)
      continuation = continuationFrom(sketch, solution)
    }
    // The join ends turned: its outgoing handle now points back along -x, still strictly G1.
    const final = new Map(
      continuation?.points.map(({ entityId, x, y }) => [entityId as string, { x, y }]),
    )
    const [join] = joinTangents(sketch, final)
    const at = final.get(incoming.endPointId)
    const handle = final.get(outgoing.control1PointId)
    if (!join || !at || !handle) throw new Error("The streamed drag must keep its first join.")
    expect(handle.x - at.x).toBeLessThan(0)
    expect(join.dot).toBeCloseTo(1, 6)
  })

  it("keeps the opposite handle collinear while one tangent handle is dragged", () => {
    const { sketch } = spline()
    const incoming = cubics(sketch)[0]
    if (!incoming) throw new Error("The fixture must contain a first segment.")
    const solution = solved(sketch, [{ entityId: incoming.control2PointId, x: 4, y: 9 }])
    expect(solution.failedConstraintIds).toEqual([])
    const [first] = joinTangents(sketch, solvedPointMap(solution))
    expect(Math.abs(first?.cross ?? 1)).toBeLessThan(1e-6)
    expect(first?.dot).toBeGreaterThan(0)
  })

  it("removes exactly one degree of freedom per join, including the closing join", () => {
    const open = spline()
    const closed = spline(throughPoints.slice(0, 3), true)
    // Four through-points and six handles give 20 free coordinates; two joins remove two.
    expect(solved(open.sketch, []).degreesOfFreedom).toBe(18)
    // Three through-points and six handles give 18 coordinates; three joins remove three.
    expect(solved(closed.sketch, []).degreesOfFreedom).toBe(15)
    expect(closed.createdConstraintIds).toHaveLength(3)
  })

  it("reports a join that conflicts with orthogonal handle alignment", () => {
    const { sketch } = spline()
    const [incoming, outgoing] = cubics(sketch)
    if (!incoming || !outgoing) throw new Error("The fixture must contain two segments.")
    const conflicting = {
      ...sketch,
      constraints: [
        ...sketch.constraints,
        ...[
          [incoming.control2PointId, incoming.endPointId, "horizontal-points"],
          [outgoing.startPointId, outgoing.control1PointId, "vertical-points"],
        ].map(([firstPointId, secondPointId, type], index) => ({
          schemaVersion: 0 as const,
          id: sketchConstraintIdSchema.parse(id(3_000 + index)),
          type: type as "horizontal-points" | "vertical-points",
          firstPointId: sketchEntityIdSchema.parse(firstPointId),
          secondPointId: sketchEntityIdSchema.parse(secondPointId),
        })),
        ...[incoming.endPointId, incoming.control2PointId, outgoing.control1PointId].map(
          (pointId, index) => ({
            schemaVersion: 0 as const,
            id: sketchConstraintIdSchema.parse(id(3_100 + index)),
            type: "fixed" as const,
            pointId,
          }),
        ),
      ],
    }
    const solution = solved(conflicting, [])
    expect(["over-constrained", "failed"]).toContain(solution.status)
    // Every reported ID belongs to the conflicting set; the untouched second join is never blamed.
    const conflictSet = [
      sketch.constraints[0]?.id,
      ...[3_000, 3_001, 3_100, 3_101, 3_102].map((value) =>
        sketchConstraintIdSchema.parse(id(value)),
      ),
    ]
    expect(solution.failedConstraintIds.length).toBeGreaterThan(0)
    for (const failed of solution.failedConstraintIds) expect(conflictSet).toContain(failed)
    expect(solution.failedConstraintIds).toContain(sketchConstraintIdSchema.parse(id(3_001)))
  })

  it("detects a closed spline as one exact cubic-bounded profile", () => {
    const square = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ]
    const { sketch } = spline(square, true)
    const solution = solved(sketch, [])
    expect(solution.profileResult.diagnostics).toEqual([])
    expect(solution.profileResult.profiles).toHaveLength(1)
    const [profile] = solution.profileResult.profiles
    // The rounded square bulges past its through-points but stays inside the handle hull.
    expect(profile?.area).toBeGreaterThan(100)
    expect(profile?.area).toBeLessThan(200)
  })
})

const flat = [
  { x: 0, y: 0 },
  { x: 10, y: 0.001 },
  { x: 20, y: 0 },
] as const

function threeSegments(sketch: SketchRecord) {
  const [first, second, last] = cubics(sketch)
  if (!first || !second || !last) throw new Error("The fixture must contain three segments.")
  return [first, second, last] as const
}

function authoredPoint(sketch: SketchRecord, pointId: string) {
  const point = sketch.entities.find(({ id: entityId }) => entityId === pointId)
  if (point?.type !== "point") throw new Error(`The fixture must contain point ${pointId}.`)
  return point
}

/** Distance the first wave join moved from its authored position at (10, 6). */
function distanceFromOriginalJoin(join: { x: number; y: number } | undefined) {
  if (!join) throw new Error("The solution must contain the join point.")
  return Math.hypot(join.x - 10, join.y - 6)
}

function firstJoinId(sketch: SketchRecord): string {
  const [join] = sketch.constraints
  if (!join) throw new Error("The fixture must contain a tangent join.")
  return join.id
}

function withConstraints(sketch: SketchRecord, constraints: readonly object[]) {
  return { ...sketch, constraints: [...sketch.constraints, ...constraints] } as SketchRecord
}

function fixedPoint(pointId: string, index: number) {
  return {
    schemaVersion: 0,
    id: sketchConstraintIdSchema.parse(id(3_200 + index)),
    type: "fixed",
    pointId: sketchEntityIdSchema.parse(pointId),
  }
}

/** Every converged join is strictly G1; anything else must fail that join by constraint ID. */
function expectStrictG1OrFailedJoins(sketch: SketchRecord, solution: ReturnType<typeof solved>) {
  for (const join of joinTangents(sketch, solvedPointMap(solution))) {
    if (solution.failedConstraintIds.includes(join.constraintId as never)) {
      expect(solution.status).toBe("failed")
      continue
    }
    expect(Math.abs(join.cross)).toBeLessThan(1e-6)
    expect(join.dot).toBeGreaterThan(0)
    // Authored handles span a third of a 10 mm chord; one percent marks a collapsed handle.
    expect(join.incomingLength).toBeGreaterThan(0.1)
    expect(join.outgoingLength).toBeGreaterThan(0.1)
  }
}

describe("tangent joins under large single solves", () => {
  it("translates the join rigidly when a perpendicular dimension moves it farther than a handle", () => {
    const { sketch } = spline(flat)
    const [first, second] = cubics(sketch)
    if (!first || !second) throw new Error("The fixture must contain two segments.")
    for (const offset of [3, 3.4, 5, 20]) {
      const dimensioned = withConstraints(sketch, [
        fixedPoint(first.startPointId, 0),
        fixedPoint(second.endPointId, 1),
        {
          schemaVersion: 0,
          id: sketchConstraintIdSchema.parse(id(3_300)),
          type: "vertical-distance",
          firstPointId: first.endPointId,
          secondPointId: first.startPointId,
          value: createLengthQuantity(offset, "mm"),
        },
      ])
      const solution = solved(dimensioned, [])
      expect(solution.status).toBe("under-constrained")
      expect(solution.failedConstraintIds).toEqual([])
      expect(solvedPointMap(solution).get(first.endPointId)).toMatchObject({
        y: expect.closeTo(offset, 6),
      })
      const [join] = joinTangents(dimensioned, solvedPointMap(solution))
      if (!join) throw new Error("The dimensioned spline must keep its join.")
      expect(Math.abs(join.cross)).toBeLessThan(1e-9)
      expect(join.dot).toBeCloseTo(1, 9)
      // Both handles keep their authored third-of-chord length instead of collapsing.
      expect(join.incomingLength).toBeCloseTo(10 / 3, 4)
      expect(join.outgoingLength).toBeCloseTo(10 / 3, 4)
    }
  })

  it("turns the join instead of forming a cusp when one drag step pushes a handle through it", () => {
    const { sketch } = spline()
    const outgoing = cubics(sketch)[1]
    if (!outgoing) throw new Error("The fixture must contain a middle segment.")
    const before = joinTangents(sketch, solvedPointMap(solved(sketch, [])))[0]
    // The outgoing handle starts near (13.6, 5.0), beyond the join at (10, 6).
    const solution = solved(sketch, [{ entityId: outgoing.control1PointId, x: 7, y: 7 }])
    expect(solution.failedConstraintIds).toEqual([])
    expectStrictG1OrFailedJoins(sketch, solution)
    const [join] = joinTangents(sketch, solvedPointMap(solution))
    if (!before || !join) throw new Error("The spline must keep its first join.")
    // The opposite handle turns with the drag at its own length instead of collapsing.
    expect(join.dot).toBeCloseTo(1, 6)
    expect(join.incomingLength).toBeCloseTo(before.incomingLength, 3)
  })

  it("fails an authored cusp seed with the join constraint ID", () => {
    const { sketch } = spline()
    const outgoing = cubics(sketch)[1]
    if (!outgoing) throw new Error("The fixture must contain a middle segment.")
    // Mirror the outgoing handle behind the join at (10, 6) so both handles share one side.
    const cusp = {
      ...sketch,
      entities: sketch.entities.map((entity) =>
        entity.id === outgoing.control1PointId && entity.type === "point"
          ? { ...entity, x: 20 - entity.x, y: 12 - entity.y }
          : entity,
      ),
    } as SketchRecord
    const solution = solved(cusp, [])
    expect(solution.status).toBe("failed")
    expect<readonly string[]>(solution.failedConstraintIds).toContain(firstJoinId(sketch))
  })

  it("does not carry a fixed handle when its through-point is dragged", () => {
    const { sketch } = spline(flat)
    const [first] = cubics(sketch)
    if (!first) throw new Error("The fixture must contain a first segment.")
    const pinned = withConstraints(sketch, [fixedPoint(first.control2PointId, 0)])
    const before = pinned.entities.find(({ id: entityId }) => entityId === first.control2PointId)
    if (before?.type !== "point") throw new Error("The handle must be a point.")
    const solution = solved(pinned, [{ entityId: first.endPointId, x: 10, y: 4 }])
    const after = solvedPointMap(solution).get(first.control2PointId)
    expect(after?.x).toBeCloseTo(before.x, 9)
    expect(after?.y).toBeCloseTo(before.y, 9)
    expectStrictG1OrFailedJoins(pinned, solution)
  })

  it("translates a join with both handles when a dimension slides it along its tangent", () => {
    const { sketch } = spline()
    const [first, , last] = cubics(sketch)
    if (!first || !last) throw new Error("The fixture must contain three segments.")
    const before = joinTangents(sketch, solvedPointMap(solved(sketch, [])))[0]
    if (!before) throw new Error("The fixture must contain a first join.")
    for (const offset of [15, 18, 40, 100]) {
      const dimensioned = withConstraints(sketch, [
        fixedPoint(first.startPointId, 0),
        fixedPoint(last.endPointId, 1),
        {
          schemaVersion: 0,
          id: sketchConstraintIdSchema.parse(id(3_400)),
          type: "horizontal-distance",
          firstPointId: first.endPointId,
          secondPointId: first.startPointId,
          value: createLengthQuantity(offset, "mm"),
        },
      ])
      const solution = solved(dimensioned, [])
      expect(solution.failedConstraintIds).toEqual([])
      expect(solvedPointMap(solution).get(first.endPointId)).toMatchObject({
        x: expect.closeTo(offset, 6),
      })
      const [join] = joinTangents(dimensioned, solvedPointMap(solution))
      if (!join) throw new Error("The dimensioned spline must keep its first join.")
      expect(join.dot).toBeCloseTo(1, 9)
      expect(join.incomingLength).toBeCloseTo(before.incomingLength, 6)
      expect(join.outgoingLength).toBeCloseTo(before.outgoingLength, 6)
    }
  })

  it("keeps both handle lengths when a coincident point drags a join along its tangent", () => {
    const { sketch } = spline()
    const [first] = cubics(sketch)
    if (!first) throw new Error("The fixture must contain a first segment.")
    const driverId = sketchEntityIdSchema.parse(id(3_500))
    const driven = {
      ...sketch,
      entities: [
        ...sketch.entities,
        { schemaVersion: 0, id: driverId, type: "point", construction: false, x: 10, y: 6 },
      ],
      constraints: [
        ...sketch.constraints,
        {
          schemaVersion: 0,
          id: sketchConstraintIdSchema.parse(id(3_501)),
          type: "coincident",
          firstPointId: driverId,
          secondPointId: first.endPointId,
        },
      ],
    } as SketchRecord
    const before = joinTangents(driven, solvedPointMap(solved(driven, [])))[0]
    // The join tangent at (10, 6) is horizontal; drag the coincident point 1 mm along it.
    const solution = solved(driven, [{ entityId: driverId, x: 11, y: 6 }])
    expect(solution.failedConstraintIds).toEqual([])
    const [join] = joinTangents(driven, solvedPointMap(solution))
    if (!before || !join) throw new Error("The spline must keep its first join.")
    // The coincident drag carries the join handles, so the join reaches the target exactly.
    expect(solvedPointMap(solution).get(first.endPointId)).toMatchObject({
      x: expect.closeTo(11, 6),
      y: expect.closeTo(6, 6),
    })
    expect(join.incomingLength).toBeCloseTo(before.incomingLength, 6)
    expect(join.outgoingLength).toBeCloseTo(before.outgoingLength, 6)
  })

  it("follows a fast handle flick that turns the join tangent beyond a quarter turn", () => {
    const { sketch } = spline()
    const outgoing = cubics(sketch)[1]
    if (!outgoing) throw new Error("The fixture must contain a middle segment.")
    // The join at (10, 6) has a horizontal tangent; one step turns the outgoing handle to 120°.
    const target = { x: 8, y: 6 + 3.5 }
    const solution = solved(sketch, [{ entityId: outgoing.control1PointId, ...target }])
    expect(solution.failedConstraintIds).toEqual([])
    expectStrictG1OrFailedJoins(sketch, solution)
    expect(solvedPointMap(solution).get(outgoing.control1PointId)).toMatchObject({
      x: expect.closeTo(target.x, 3),
      y: expect.closeTo(target.y, 3),
    })
  })

  it("reshapes the tangent instead of moving the join when a handle dimension changes", () => {
    const { sketch } = spline()
    const [first, , last] = cubics(sketch)
    if (!first || !last) throw new Error("The fixture must contain three segments.")
    const pinId = sketchEntityIdSchema.parse(id(3_600))
    const handle = sketch.entities.find(({ id: entityId }) => entityId === first.control2PointId)
    if (handle?.type !== "point") throw new Error("The handle must be a point.")
    const current = Math.hypot(handle.x, handle.y - 12)
    const dimensioned = {
      ...withConstraints(sketch, [
        fixedPoint(first.startPointId, 0),
        fixedPoint(last.endPointId, 1),
        fixedPoint(pinId, 2),
        {
          schemaVersion: 0,
          id: sketchConstraintIdSchema.parse(id(3_601)),
          type: "distance",
          firstPointId: first.control2PointId,
          secondPointId: pinId,
          value: createLengthQuantity(current + 5, "mm"),
        },
      ]),
      entities: [
        ...sketch.entities,
        { schemaVersion: 0, id: pinId, type: "point", construction: false, x: 0, y: 12 },
      ],
    } as SketchRecord
    const solution = solved(dimensioned, [])
    expect(solution.failedConstraintIds).toEqual([])
    const join = solvedPointMap(solution).get(first.endPointId)
    // Holding this handle forced nearly the whole 5 mm change onto the through-point. Left free,
    // the handle absorbs most of it; the join moves exactly as in a solve without any holds.
    expect(distanceFromOriginalJoin(join)).toBeLessThan(2.5)
    expectStrictG1OrFailedJoins(dimensioned, solution)
  })

  it("moves a handle, not its join, when a point coincident with the handle is dragged", () => {
    const { sketch } = spline()
    const [first] = cubics(sketch)
    if (!first) throw new Error("The fixture must contain a first segment.")
    const handle = sketch.entities.find(({ id: entityId }) => entityId === first.control2PointId)
    if (handle?.type !== "point") throw new Error("The handle must be a point.")
    const driverId = sketchEntityIdSchema.parse(id(3_700))
    const driven = {
      ...sketch,
      entities: [
        ...sketch.entities,
        {
          schemaVersion: 0,
          id: driverId,
          type: "point",
          construction: false,
          x: handle.x,
          y: handle.y,
        },
      ],
      constraints: [
        ...sketch.constraints,
        {
          schemaVersion: 0,
          id: sketchConstraintIdSchema.parse(id(3_701)),
          type: "coincident",
          firstPointId: driverId,
          secondPointId: first.control2PointId,
        },
      ],
    } as SketchRecord
    const solution = solved(driven, [{ entityId: driverId, x: handle.x, y: handle.y + 3 }])
    expect(solution.failedConstraintIds).toEqual([])
    const join = solvedPointMap(solution).get(first.endPointId)
    // The old predictor carried the join about 3 mm with the held handle.
    expect(distanceFromOriginalJoin(join)).toBeLessThan(1)
    expectStrictG1OrFailedJoins(driven, solution)
  })

  it("keeps sliding-join handle lengths beside an unchanged handle dimension on another join", () => {
    const { sketch } = spline()
    const [first, second, last] = threeSegments(sketch)
    const [before] = joinTangents(sketch, solvedPointMap(solved(sketch, [])))
    const join2 = authoredPoint(sketch, second.endPointId)
    const handle2 = authoredPoint(sketch, last.control1PointId)
    const length2 = Math.hypot(handle2.x - join2.x, handle2.y - join2.y)
    const dimensioned = withConstraints(sketch, [
      fixedPoint(first.startPointId, 0),
      fixedPoint(last.endPointId, 1),
      {
        schemaVersion: 0,
        id: sketchConstraintIdSchema.parse(id(3_800)),
        type: "horizontal-distance",
        firstPointId: first.endPointId,
        secondPointId: first.startPointId,
        value: createLengthQuantity(15, "mm"),
      },
      {
        // Consistent but redundant with a held handle before handles referenced elsewhere were freed.
        schemaVersion: 0,
        id: sketchConstraintIdSchema.parse(id(3_801)),
        type: "distance",
        firstPointId: last.control1PointId,
        secondPointId: second.endPointId,
        value: createLengthQuantity(length2, "mm"),
      },
    ])
    const solution = solved(dimensioned, [])
    expect(solution.failedConstraintIds).toEqual([])
    const [join] = joinTangents(dimensioned, solvedPointMap(solution))
    expect(join?.incomingLength).toBeCloseTo(before?.incomingLength ?? Number.NaN, 6)
    expect(join?.outgoingLength).toBeCloseTo(before?.outgoingLength ?? Number.NaN, 6)
  })
})

/** Ordinary solve without the predictor, as the reference for joins the predictor must not hold. */
function solvedWithoutHolds(
  sketch: SketchRecord,
  draggedPoints: { entityId: string; x: number; y: number }[],
) {
  const compilation = compileSketchSystem({
    revision: 1,
    sketch,
    draggedPoints,
    continuation: null,
  })
  if (!compilation.ok) throw new Error(compilation.diagnostic.message)
  const { bindings, system } = compilation.compiled
  const { parameterValues } = solveSketchSystem(module, system)
  return (pointId: string) => {
    const binding = bindings.pointParameters.get(pointId as never)
    if (!binding) throw new Error(`Missing solved point ${pointId}.`)
    return {
      x: parameterValues[binding.xIndex] ?? Number.NaN,
      y: parameterValues[binding.yIndex] ?? Number.NaN,
    }
  }
}

/** Adds a horizontal construction line from `startPointId` to an existing or a new end point. */
function withHorizontalLine(
  sketch: SketchRecord,
  startPointId: string,
  end: string | { x: number; y: number },
  index: number,
) {
  const lineId = sketchEntityIdSchema.parse(id(3_900 + index * 4))
  const endPointId =
    typeof end === "string" ? end : sketchEntityIdSchema.parse(id(3_901 + index * 4))
  const endPoint =
    typeof end === "string"
      ? []
      : [{ schemaVersion: 0, id: endPointId, type: "point", construction: true, ...end }]
  const constrained = {
    ...sketch,
    entities: [
      ...sketch.entities,
      ...endPoint,
      { schemaVersion: 0, id: lineId, type: "line", construction: true, startPointId, endPointId },
    ],
    constraints: [
      ...sketch.constraints,
      {
        schemaVersion: 0,
        id: sketchConstraintIdSchema.parse(id(3_902 + index * 4)),
        type: "horizontal",
        lineId,
      },
    ],
  } as SketchRecord
  return { sketch: constrained, endPointId }
}

function slidFirstJoin(sketch: SketchRecord, offset: number) {
  const [first, , last] = threeSegments(sketch)
  return withConstraints(sketch, [
    fixedPoint(first.startPointId, 0),
    fixedPoint(last.endPointId, 1),
    {
      schemaVersion: 0,
      id: sketchConstraintIdSchema.parse(id(3_950)),
      type: "horizontal-distance",
      firstPointId: first.endPointId,
      secondPointId: first.startPointId,
      value: createLengthQuantity(offset, "mm"),
    },
  ])
}

describe("tangent-join predictor holds beside constraints on shared handles", () => {
  it("keeps sliding-join handle lengths beside a horizontal line on another join's handle", () => {
    const { sketch } = spline()
    const [, second, last] = threeSegments(sketch)
    const [before] = joinTangents(sketch, solvedPointMap(solved(sketch, [])))
    // A horizontal construction line from join 2 to its outgoing handle sets that join's tangent.
    const { sketch: lined } = withHorizontalLine(sketch, second.endPointId, last.control1PointId, 0)
    for (const offset of [15, 18, 40]) {
      const dimensioned = slidFirstJoin(lined, offset)
      const solution = solved(dimensioned, [])
      expect(solution.failedConstraintIds).toEqual([])
      const [join] = joinTangents(dimensioned, solvedPointMap(solution))
      expect(join?.incomingLength).toBeCloseTo(before?.incomingLength ?? Number.NaN, 6)
      expect(join?.outgoingLength).toBeCloseTo(before?.outgoingLength ?? Number.NaN, 6)
      expectStrictG1OrFailedJoins(dimensioned, solution)
    }
  })

  it("moves a join exactly as without holds when a line attached to its handle is dragged", () => {
    const { sketch } = spline()
    const [first] = threeSegments(sketch)
    const handle = authoredPoint(sketch, first.control2PointId)
    const end = { x: handle.x - 5, y: handle.y }
    const { sketch: lined, endPointId } = withHorizontalLine(sketch, first.control2PointId, end, 1)
    const drag = [{ entityId: endPointId, x: handle.x - 5, y: handle.y + 3 }]
    const solution = solved(lined, drag)
    const join = solvedPointMap(solution).get(first.endPointId)
    const unheld = solvedWithoutHolds(lined, drag)(first.endPointId)
    expect(join?.x).toBeCloseTo(unheld.x, 6)
    expect(join?.y).toBeCloseTo(unheld.y, 6)
    // A held join was carried about 3 mm with the line; left free it moves under 1 mm.
    expect(distanceFromOriginalJoin(join)).toBeLessThan(1)
    expectStrictG1OrFailedJoins(lined, solution)
  })

  it("still holds a join whose handle carries only a non-driving reference dimension", () => {
    const { sketch } = spline()
    const [first] = threeSegments(sketch)
    const [before] = joinTangents(sketch, solvedPointMap(solved(sketch, [])))
    for (const offset of [15, 18, 40]) {
      const measured = withConstraints(slidFirstJoin(sketch, offset), [
        {
          schemaVersion: 0,
          id: sketchConstraintIdSchema.parse(id(3_960)),
          type: "distance",
          firstPointId: first.control2PointId,
          secondPointId: first.startPointId,
          mode: "reference",
        },
      ])
      const solution = solved(measured, [])
      expect(solution.failedConstraintIds).toEqual([])
      const [join] = joinTangents(measured, solvedPointMap(solution))
      expect(join?.incomingLength).toBeCloseTo(before?.incomingLength ?? Number.NaN, 6)
      expect(join?.outgoingLength).toBeCloseTo(before?.outgoingLength ?? Number.NaN, 6)
    }
  })
})

/** Through-points of an open zigzag with `segments` spans. */
function zigzag(segments: number) {
  return Array.from({ length: segments + 1 }, (_, index) => ({ x: index * 10, y: (index % 2) * 6 }))
}

describe("open spline chains in profile detection", () => {
  it("reports long open chains as open instead of a zero-area out-and-back loop", () => {
    for (const segments of [18, 30]) {
      const { sketch } = spline(zigzag(segments))
      const started = performance.now()
      const solution = solved(sketch, [])
      // Rounding once left the out-and-back walk just above the area tolerance, and its
      // detection took seconds per solve.
      expect(performance.now() - started).toBeLessThan(1_000)
      expect(solution.profileResult.profiles).toEqual([])
      expect(solution.profileResult.loops).toEqual([])
      expect(solution.profileResult.diagnostics).toMatchObject([
        {
          code: "open-chain",
          entityIds: expect.arrayContaining(cubics(sketch).map(({ id }) => id)),
        },
      ])
    }
  })

  it("still detects a long closed spline as one profile", () => {
    const ring = Array.from({ length: 30 }, (_, index) => ({
      x: 50 * Math.cos((index * Math.PI) / 15),
      y: 50 * Math.sin((index * Math.PI) / 15),
    }))
    const { sketch } = spline(ring, true)
    const solution = solved(sketch, [])
    expect(solution.profileResult.diagnostics).toEqual([])
    expect(solution.profileResult.profiles).toHaveLength(1)
    expect(solution.profileResult.profiles[0]?.area).toBeCloseTo(Math.PI * 2_500, -1)
  })
})
