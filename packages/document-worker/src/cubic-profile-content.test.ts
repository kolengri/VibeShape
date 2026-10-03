import { sketchProfileSelectorSchema, sketchRecordSchema } from "@vibeshape/domain"
import { extrusionProfileSegmentSchema } from "@vibeshape/protocol"
import { detectSketchProfiles, SKETCH_SOLVER_BUILD } from "@vibeshape/sketch-solver"
import { describe, expect, it } from "vitest"
import { materializeSelectedProfile } from "./analytical-profile-content"

const id = (n: number) => `01900000-0000-7000-8000-${n.toString(16).padStart(12, "0")}`
function fixture() {
  const sketch = sketchRecordSchema.parse({
    schemaVersion: 0,
    id: id(50),
    label: "Cubic profile",
    plane: "xy",
    entities: [
      ...[
        [0, 0],
        [0, 4],
        [4, 4],
        [4, 0],
      ].map(([x, y], i) => ({
        schemaVersion: 0,
        id: id(i + 1),
        type: "point",
        construction: false,
        x,
        y,
      })),
      {
        schemaVersion: 0,
        id: id(5),
        type: "cubic-bezier",
        construction: false,
        startPointId: id(1),
        control1PointId: id(2),
        control2PointId: id(3),
        endPointId: id(4),
      },
      {
        schemaVersion: 0,
        id: id(6),
        type: "line",
        construction: false,
        startPointId: id(4),
        endPointId: id(1),
      },
    ],
    constraints: [],
  })
  const points = sketch.entities.flatMap((entity) =>
    entity.type === "point" ? [{ entityId: entity.id, x: entity.x, y: entity.y }] : [],
  )
  const solution = {
    schemaVersion: 0 as const,
    sketchId: sketch.id,
    sourceRevision: 2,
    status: "under-constrained" as const,
    degreesOfFreedom: 8,
    maximumResidual: 0,
    points,
    circles: [],
    failedConstraintIds: [],
    heapCapacityBytes: 1024,
    solverBuild: SKETCH_SOLVER_BUILD,
    profileResult: detectSketchProfiles(sketch, { points, circles: [] }),
  }
  const selector = sketchProfileSelectorSchema.parse({
    schemaVersion: 0,
    sketchId: sketch.id,
    outerBoundaryEntityIds: [id(5), id(6)],
    holeBoundaryEntityIds: [],
  })
  return { sketch, solution, selector }
}
describe("exact cubic profile content", () => {
  it("reverses all four coordinate and identity roles when orienting the outer loop", () => {
    const f = fixture()
    const result = materializeSelectedProfile(f.sketch, f.solution, f.selector)
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(result.diagnostic.code)
    const cubic = result.outer.segments.find((segment) => segment.type === "cubic-bezier")
    expect(cubic).toEqual({
      entityId: id(5),
      type: "cubic-bezier",
      startPointId: id(4),
      control1PointId: id(3),
      control2PointId: id(2),
      endPointId: id(1),
      start: [4, 0],
      control1: [4, 4],
      control2: [0, 4],
      end: [0, 0],
    })
    expect(extrusionProfileSegmentSchema.safeParse(cubic).success).toBe(true)
    expect(f.sketch.entities[4]).toMatchObject({ startPointId: id(1), control1PointId: id(2) })
  })
  it("fails closed if a solved control is missing", () => {
    const f = fixture()
    expect(
      materializeSelectedProfile(
        f.sketch,
        { ...f.solution, points: f.solution.points.filter(({ entityId }) => entityId !== id(2)) },
        f.selector,
      ),
    ).toMatchObject({
      ok: false,
      diagnostic: { code: "org.vibeshape.feature.sketch-profile-invalid" },
    })
  })
  it("rejects malformed exact cubic wire roles and collapsed geometry", () => {
    const segment = {
      type: "cubic-bezier",
      entityId: id(5),
      startPointId: id(1),
      control1PointId: id(2),
      control2PointId: id(3),
      endPointId: id(4),
      start: [0, 0],
      control1: [0, 4],
      control2: [4, 4],
      end: [4, 0],
    }
    expect(
      extrusionProfileSegmentSchema.safeParse({ ...segment, control1PointId: id(1) }).success,
    ).toBe(false)
    expect(
      extrusionProfileSegmentSchema.safeParse({ ...segment, control1: [NaN, 4] }).success,
    ).toBe(false)
    expect(
      extrusionProfileSegmentSchema.safeParse({
        ...segment,
        start: [0, 0],
        control1: [0, 0],
        control2: [0, 0],
        end: [0, 0],
      }).success,
    ).toBe(false)
    expect(
      extrusionProfileSegmentSchema.safeParse({ ...segment, weights: [1, 1, 1, 1] }).success,
    ).toBe(false)
  })
})
