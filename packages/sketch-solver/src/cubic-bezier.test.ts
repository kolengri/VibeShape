import { beforeAll, describe, expect, it } from "bun:test"
import { sketchEntityIdSchema } from "@vibeshape/domain/identifiers"
import { sketchRecordSchema } from "@vibeshape/domain/sketch"
import initializeSolver from "../runtime/vibeshape_slvs.mjs"
import type { NativeSketchSolverModule } from "./abi"
import {
  cubicAreaContribution,
  cubicBounds,
  cubicPointAt,
  cubicRayCrossings,
} from "./cubic-profile-geometry"
import { compileSketchSystem, solveSketchRecord } from "./production"
import {
  curveIntersections,
  type ProfileCircleCurve,
  type ProfileCubicBezierCurve,
  type ProfileEllipseCurve,
  type ProfileLineCurve,
} from "./profile-geometry"
import { detectSketchProfiles } from "./profiles"

const id = (value: number) => `01900000-0000-7000-8000-${value.toString(16).padStart(12, "0")}`
const poles = [
  [0, 0],
  [0, 4],
  [4, 4],
  [4, 0],
] as const
function sketch(points: readonly (readonly [number, number])[] = poles) {
  return sketchRecordSchema.parse({
    schemaVersion: 0,
    id: id(50),
    label: "Cubic dome",
    plane: "xy",
    entities: [
      ...points.map(([x, y], i) => ({
        schemaVersion: 0,
        id: id(i + 1),
        type: "point",
        construction: false,
        x,
        y,
      })),
      {
        schemaVersion: 0,
        id: id(10),
        type: "cubic-bezier",
        construction: false,
        startPointId: id(1),
        control1PointId: id(2),
        control2PointId: id(3),
        endPointId: id(4),
      },
      {
        schemaVersion: 0,
        id: id(11),
        type: "line",
        construction: false,
        startPointId: id(4),
        endPointId: id(1),
      },
    ],
    constraints: [],
  })
}
function solution(model = sketch()) {
  return {
    points: model.entities.flatMap((entity) =>
      entity.type === "point" ? [{ entityId: entity.id, x: entity.x, y: entity.y }] : [],
    ),
    circles: [],
  }
}
function cubic(
  points: readonly [
    readonly [number, number],
    readonly [number, number],
    readonly [number, number],
    readonly [number, number],
  ] = poles,
): ProfileCubicBezierCurve {
  const base = {
    entityId: sketchEntityIdSchema.parse(id(5)),
    type: "cubic-bezier" as const,
    start: { x: points[0][0], y: points[0][1] },
    control1: { x: points[1][0], y: points[1][1] },
    control2: { x: points[2][0], y: points[2][1] },
    end: { x: points[3][0], y: points[3][1] },
  }
  return { ...base, bounds: cubicBounds(base) }
}
function horizontal(y: number): ProfileLineCurve {
  return {
    entityId: sketchEntityIdSchema.parse(id(6)),
    type: "line",
    start: { x: -1, y },
    end: { x: 5, y },
    bounds: { minX: -1, maxX: 5, minY: y, maxY: y },
  }
}

describe("analytical cubic profiles", () => {
  it("retains a cubic segment and computes exact extrema and polynomial area", () => {
    const result = detectSketchProfiles(sketch(), solution())
    expect(result.diagnostics).toEqual([])
    expect(result.profiles).toHaveLength(1)
    expect(result.profiles[0]?.area).toBeCloseTo(9.6, 10)
    expect(result.profiles[0]?.bounds).toEqual({ minX: 0, minY: 0, maxX: 4, maxY: 3 })
    expect(result.loops[0]?.segments.map((segment) => segment.type)).toContain("cubic-bezier")
    expect(cubicPointAt(cubic(), 0.5)).toEqual({ x: 2, y: 3 })
    expect(cubicAreaContribution(cubic(), false)).toBeCloseTo(-9.6, 10)
  })
  it("is deterministic under entity and solved-point reordering", () => {
    const original = sketch(),
      solved = solution(original)
    expect(
      detectSketchProfiles(
        { ...original, entities: [...original.entities].reverse() },
        { ...solved, points: [...solved.points].reverse() },
      ),
    ).toEqual(detectSketchProfiles(original, solved))
  })
  it("finds both crossings and a tangent contact without coarse sampling", () => {
    expect(curveIntersections(cubic(), horizontal(2), 1e-7).points).toHaveLength(2)
    const tangent = curveIntersections(cubic(), horizontal(3), 1e-7)
    expect(tangent.points).toHaveLength(1)
    expect(tangent.points[0]?.x).toBeCloseTo(2, 10)
    expect(curveIntersections(cubic(), horizontal(3.001), 1e-7).points).toEqual([])
  })
  it("isolates exact circle and ellipse contacts, including a repeated tangent root", () => {
    const circle: ProfileCircleCurve = {
      entityId: sketchEntityIdSchema.parse(id(100)),
      type: "circle",
      center: { x: 2, y: 2 },
      radius: 1,
      startAngle: 0,
      sweep: Math.PI * 2,
      start: { x: 3, y: 2 },
      end: { x: 3, y: 2 },
      bounds: { minX: 1, maxX: 3, minY: 1, maxY: 3 },
    }
    const tangent = curveIntersections(cubic(), circle, 1e-7)
    expect(tangent.points).toHaveLength(1)
    expect(tangent.points[0]?.x).toBeCloseTo(2, 8)
    expect(tangent.points[0]?.y).toBeCloseTo(3, 8)
    expect(
      curveIntersections(
        cubic(),
        { ...circle, radius: 2, bounds: { minX: 0, maxX: 4, minY: 0, maxY: 4 } },
        1e-7,
      ).points,
    ).toHaveLength(2)
    const ellipse: ProfileEllipseCurve = {
      entityId: sketchEntityIdSchema.parse(id(101)),
      type: "ellipse",
      center: { x: 2, y: 2 },
      primaryRadius: 2,
      secondaryRadius: 1,
      secondarySign: 1,
      rotationRadians: 0,
      start: { x: 4, y: 2 },
      end: { x: 4, y: 2 },
      bounds: { minX: 0, maxX: 4, minY: 1, maxY: 3 },
    }
    expect(curveIntersections(cubic(), ellipse, 1e-7).points).toHaveLength(3)
  })
  it("finds cubic intersections symmetrically and rejects unresolved subdivision", () => {
    const crossing = cubic([
      [-1, 2],
      [1, 2],
      [3, 2],
      [5, 2],
    ])
    const direct = curveIntersections(cubic(), crossing, 1e-7)
    const reverse = curveIntersections(crossing, cubic(), 1e-7)
    expect(direct.points).toHaveLength(2)
    expect(reverse.points).toHaveLength(2)
    expect(direct.points.map(({ x }) => x).sort((a, b) => a - b)).toEqual(
      expect.arrayContaining(reverse.points.map(({ x }) => expect.closeTo(x, 6))),
    )
    expect(curveIntersections(cubic(), cubic(), 1e-7).coincident).toBe(true)
    expect(curveIntersections(cubic(), crossing, 1e-30)).toMatchObject({ uncertain: true })
  })
  it("counts a horizontal inflection crossing but excludes a tangency in analytical containment", () => {
    // y=(t-1/2)^3, x=3t: a zero first derivative still crosses the ray.
    const inflection = cubic([
      [0, -0.125],
      [1, 0.125],
      [2, -0.125],
      [3, 0.125],
    ])
    expect(cubicRayCrossings(inflection, 0)).toEqual([1.5])
    expect(cubicRayCrossings(cubic(), 3)).toEqual([])
  })
  it("rejects an unsplit interior line crossing", () => {
    const model = sketchRecordSchema.parse({
      ...sketch(),
      entities: [
        ...sketch().entities,
        { schemaVersion: 0, id: id(20), type: "point", construction: false, x: 2, y: -1 },
        { schemaVersion: 0, id: id(21), type: "point", construction: false, x: 2, y: 4 },
        {
          schemaVersion: 0,
          id: id(22),
          type: "line",
          construction: false,
          startPointId: id(20),
          endPointId: id(21),
        },
      ],
    })
    const result = detectSketchProfiles(model, solution(model))
    expect(result.profiles).toEqual([])
    expect(result.diagnostics.map(({ code }) => code)).toContain("intersecting-entities")
  })
  it("rejects collapsed or cusp geometry but leaves it editable", () => {
    const collapsed = sketch([
      [0, 0],
      [0, 0],
      [0, 0],
      [0, 0],
    ])
    expect(
      detectSketchProfiles(collapsed, solution(collapsed)).diagnostics.map(({ code }) => code),
    ).toContain("degenerate-entity")
    const cusp = sketch([
      [0, 0],
      [1, 0],
      [-1, 0],
      [0, 0],
    ])
    expect(
      detectSketchProfiles(cusp, solution(cusp)).diagnostics.map(({ code }) => code),
    ).toContain("degenerate-entity")
  })
  it("rejects a true cubic self crossing", () => {
    const model = sketch([
      [0, 0],
      [5, 5],
      [-5, 5],
      [1, 0],
    ])
    expect(
      detectSketchProfiles(model, solution(model)).diagnostics.map(({ code }) => code),
    ).toContain("intersecting-entities")
  })
  it("reports open chains and ignores construction cubics", () => {
    const model = sketch()
    expect(
      detectSketchProfiles(
        { ...model, entities: model.entities.filter(({ id: entityId }) => entityId !== id(11)) },
        solution(model),
      ).diagnostics.map(({ code }) => code),
    ).toContain("open-chain")
    expect(
      detectSketchProfiles(
        { ...model, entities: model.entities.map((entity) => ({ ...entity, construction: true })) },
        solution(model),
      ).profiles,
    ).toEqual([])
  })
  it("nests a circular hole analytically inside the curved boundary", () => {
    const model = sketchRecordSchema.parse({
      ...sketch(),
      entities: [
        ...sketch().entities,
        { schemaVersion: 0, id: id(20), type: "point", construction: false, x: 2, y: 2 },
        {
          schemaVersion: 0,
          id: id(21),
          type: "circle",
          construction: false,
          centerPointId: id(20),
          radius: 0.25,
        },
      ],
    })
    const solved = {
      ...solution(model),
      circles: [
        { entityId: model.entities[7]?.id as ProfileCubicBezierCurve["entityId"], radius: 0.25 },
      ],
    }
    const result = detectSketchProfiles(model, solved)
    expect(result.diagnostics).toEqual([])
    expect(result.profiles[0]?.holeLoopIndices).toHaveLength(1)
    expect(result.profiles[0]?.area).toBeCloseTo(9.6 - Math.PI * 0.25 ** 2, 10)
  })
})

let native: NativeSketchSolverModule
beforeAll(async () => {
  native = await initializeSolver({
    locateFile: () => new URL("../runtime/vibeshape_slvs.wasm", import.meta.url).pathname,
  })
}, 60_000)
describe("pinned native cubic ABI", () => {
  it("compiles exactly one cubic with four stable point handles", () => {
    const compiled = compileSketchSystem({ sketch: sketch(), revision: 1, variables: [] })
    expect(compiled.ok).toBe(true)
    if (!compiled.ok) throw new Error(compiled.diagnostic.message)
    const records = compiled.compiled.system.entityRecords
    const cubics = Array.from({ length: records.length / 14 }, (_, i) =>
      Array.from(records.slice(i * 14, (i + 1) * 14)),
    ).filter((row) => row[2] === 80002)
    expect(cubics).toHaveLength(1)
    expect(cubics[0]?.[3]).toBe(200)
    expect(new Set(cubics[0]?.slice(4, 8)).size).toBe(4)
  })
  it("solves a closed cubic profile and follows a stable-ID control-point drag", () => {
    const model = sketch()
    const first = solveSketchRecord(native, { sketch: model, revision: 1, variables: [] })
    expect(first.ok).toBe(true)
    if (!first.ok) throw new Error(first.diagnostic.message)
    expect(first.solution.status).toBe("under-constrained")
    expect(first.solution.profileResult.profiles[0]?.area).toBeCloseTo(9.6, 8)
    const moved = solveSketchRecord(native, {
      sketch: model,
      revision: 2,
      variables: [],
      draggedPoints: [{ entityId: sketchEntityIdSchema.parse(id(2)), x: 0, y: 6 }],
    })
    expect(moved.ok).toBe(true)
    if (!moved.ok) throw new Error(moved.diagnostic.message)
    expect(moved.solution.points.find(({ entityId }) => entityId === id(2))?.y).toBeCloseTo(6, 9)
    expect(moved.solution.profileResult.profiles[0]?.area).toBeGreaterThan(9.6)
    expect(model.entities[1]).toMatchObject({ x: 0, y: 4 })
  })
})
