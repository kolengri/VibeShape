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
import { type SketchSolveContinuation, solveSketchRecord } from "./production"

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

  it("fails a join closed instead of reversing it when a handle is pushed through", () => {
    const { sketch } = spline()
    const [incoming, outgoing] = cubics(sketch)
    if (!incoming || !outgoing) throw new Error("The fixture must contain two segments.")
    let continuation: SketchSolveContinuation | null = null
    // The outgoing handle starts near (13.6, 5.0); drag it back past the join at (10, 6). Once the
    // handle collapses onto the join, the solve fails that join instead of accepting a cusp.
    let failedSteps = 0
    for (let step = 1; step <= 12; step += 1) {
      const pointer = { x: 13.6 - step * 0.5, y: 5 + step * 0.05 }
      const solution = solved(
        sketch,
        [{ entityId: outgoing.control1PointId, ...pointer }],
        continuation,
      )
      expectStrictG1OrFailedJoins(sketch, solution)
      if (solution.status === "failed") {
        failedSteps += 1
        continue
      }
      continuation = continuationFrom(sketch, solution)
      const [first] = joinTangents(sketch, solvedPointMap(solution))
      expect(first?.outgoingAhead).toBeGreaterThan(0)
    }
    // Early steps converge; the collapse steps fail closed instead of producing a cusp.
    expect(failedSteps).toBeGreaterThan(0)
    expect(failedSteps).toBeLessThan(12)
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
      expect(solvedPointMap(solution).get(first.endPointId)?.y).toBeCloseTo(offset, 6)
      const [join] = joinTangents(dimensioned, solvedPointMap(solution))
      expect(Math.abs(join?.cross ?? 1)).toBeLessThan(1e-9)
      expect(join?.dot).toBeCloseTo(1, 9)
      // Both handles keep their authored third-of-chord length instead of collapsing.
      expect(join?.incomingLength).toBeCloseTo(10 / 3, 4)
      expect(join?.outgoingLength).toBeCloseTo(10 / 3, 4)
    }
  })

  it("fails the join closed when one drag step pushes a handle through it", () => {
    const { sketch } = spline()
    const outgoing = cubics(sketch)[1]
    if (!outgoing) throw new Error("The fixture must contain a middle segment.")
    // The outgoing handle starts near (13.6, 5.0), beyond the join at (10, 6).
    const solution = solved(sketch, [{ entityId: outgoing.control1PointId, x: 7, y: 7 }])
    expect(solution.status).toBe("failed")
    expect<readonly string[]>(solution.failedConstraintIds).toEqual([firstJoinId(sketch)])
    expectStrictG1OrFailedJoins(sketch, solution)
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
})
