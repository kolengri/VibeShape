import { beforeAll, describe, expect, it } from "bun:test"
import {
  sketchConstraintIdSchema,
  sketchEntityIdSchema,
  sketchIdSchema,
} from "@vibeshape/domain/identifiers"
import type { SketchRecord } from "@vibeshape/domain/sketch"
import { appendSketchSpline, createEmptySketch } from "@vibeshape/domain/sketch-edit"
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

  it("never reverses a join into a cusp when a handle is pushed through its through-point", () => {
    const { sketch } = spline()
    const [incoming, outgoing] = cubics(sketch)
    if (!incoming || !outgoing) throw new Error("The fixture must contain two segments.")
    let continuation: SketchSolveContinuation | null = null
    // The outgoing handle starts near (13.6, 5.0); drag it back past the join at (10, 6). At the
    // boundary the collapsed handle pushes the through-point instead of flipping behind it.
    for (let step = 1; step <= 12; step += 1) {
      const pointer = { x: 13.6 - step * 0.5, y: 5 + step * 0.05 }
      const solution = solved(
        sketch,
        [{ entityId: outgoing.control1PointId, ...pointer }],
        continuation,
      )
      continuation = continuationFrom(sketch, solution)
      const [first] = joinTangents(sketch, solvedPointMap(solution))
      // A handle may shrink onto the join (the closed boundary) but never flips behind it.
      expect(first?.outgoingAhead).toBeGreaterThan(-1e-6)
    }
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
    expect(solution.failedConstraintIds.length).toBeGreaterThan(0)
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
