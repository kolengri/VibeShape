import {
  sketchConstraintIdSchema,
  sketchEntityIdSchema,
  sketchIdSchema,
} from "@vibeshape/domain/identifiers"
import type { SketchEntity } from "@vibeshape/domain/sketch"
import {
  appendSketchStraightSlot,
  createEmptySketch,
  moveSketchPoint,
} from "@vibeshape/domain/sketch-edit"
import { beforeAll, describe, expect, it } from "vitest"
import createNativeSketchSolver from "../runtime/vibeshape_slvs.mjs"
import type { NativeSketchSolverModule } from "./abi"
import { solveSketchRecord } from "./production"

let nextEntityId = 1
let nextConstraintId = 1
let nativeModule: NativeSketchSolverModule

function createEntityId() {
  const suffix = String(nextEntityId++).padStart(12, "0")
  return sketchEntityIdSchema.parse(`018f0000-0000-7000-9000-${suffix}`)
}

function createConstraintId() {
  const suffix = String(nextConstraintId++).padStart(12, "0")
  return sketchConstraintIdSchema.parse(`018f0000-0000-7000-a000-${suffix}`)
}

function requiredEntity<Entity extends SketchEntity>(
  entities: readonly Entity[],
  label: string,
  predicate: (entity: Entity) => boolean,
) {
  const entity = entities.find(predicate)
  if (!entity) throw new Error(`The slot fixture is missing its ${label} entity.`)
  return entity
}

function distance(first: { x: number; y: number }, second: { x: number; y: number }) {
  return Math.hypot(second.x - first.x, second.y - first.y)
}

describe("native slot invariants", () => {
  beforeAll(async () => {
    nativeModule = await createNativeSketchSolver()
  })

  it("preserves equal tangent sides and cap radii after a boundary drag", () => {
    nextEntityId = 1
    nextConstraintId = 1
    const sketch = createEmptySketch({
      id: sketchIdSchema.parse("018f0000-0000-7000-8000-000000000001"),
      label: "Slot invariant fixture",
      plane: "xy",
    })
    const authored = appendSketchStraightSlot(sketch, {
      createConstraintId,
      createEntityId,
      endCenter: { kind: "new", point: { x: 60, y: 0 } },
      startCenter: { kind: "new", point: { x: 0, y: 0 } },
      widthPoint: { x: 60, y: 30 },
    }).sketch
    const lines = authored.entities.filter(
      (entity): entity is Extract<SketchEntity, { type: "line" }> => entity.type === "line",
    )
    const arcs = authored.entities.filter(
      (entity): entity is Extract<SketchEntity, { type: "arc" }> => entity.type === "arc",
    )
    const centerLine = requiredEntity(lines, "construction centerline", (line) => line.construction)
    const startArc = requiredEntity(
      arcs,
      "start cap",
      (arc) => arc.centerPointId === centerLine.startPointId,
    )
    const endArc = requiredEntity(
      arcs,
      "end cap",
      (arc) => arc.centerPointId === centerLine.endPointId,
    )
    const moved = moveSketchPoint(authored, endArc.startPointId, { x: 75, y: -10 })

    const result = solveSketchRecord(nativeModule, { revision: 1, sketch: moved, variables: [] })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.solution.status).toBe("under-constrained")
    expect(result.solution.profileResult.profiles).toHaveLength(1)
    const solved = new Map(result.solution.points.map((point) => [point.entityId, point]))
    const point = (entityId: ReturnType<typeof createEntityId>) => {
      const value = solved.get(entityId)
      if (!value) throw new Error(`The native solution is missing point ${entityId}.`)
      return value
    }
    const centerStart = point(startArc.centerPointId)
    const centerEnd = point(endArc.centerPointId)
    const positiveStart = point(startArc.startPointId)
    const positiveEnd = point(endArc.endPointId)
    const negativeStart = point(startArc.endPointId)
    const negativeEnd = point(endArc.startPointId)
    const centerLength = distance(centerStart, centerEnd)
    const positiveLength = distance(positiveStart, positiveEnd)
    const negativeLength = distance(negativeStart, negativeEnd)
    const radii = [
      distance(centerStart, positiveStart),
      distance(centerStart, negativeStart),
      distance(centerEnd, positiveEnd),
      distance(centerEnd, negativeEnd),
    ]
    const normalizedTangentResidual = (
      lineStart: { x: number; y: number },
      lineEnd: { x: number; y: number },
      center: { x: number; y: number },
    ) =>
      Math.abs(
        ((lineEnd.x - lineStart.x) * (lineStart.x - center.x) +
          (lineEnd.y - lineStart.y) * (lineStart.y - center.y)) /
          (distance(lineStart, lineEnd) * distance(lineStart, center)),
      )

    expect(positiveLength).toBeCloseTo(centerLength, 9)
    expect(negativeLength).toBeCloseTo(centerLength, 9)
    for (const radius of radii) expect(radius).toBeCloseTo(radii[0] ?? 0, 9)
    expect(normalizedTangentResidual(positiveStart, positiveEnd, centerStart)).toBeLessThan(1e-10)
    expect(normalizedTangentResidual(positiveEnd, positiveStart, centerEnd)).toBeLessThan(1e-10)
    expect(normalizedTangentResidual(negativeStart, negativeEnd, centerStart)).toBeLessThan(1e-10)
    expect(normalizedTangentResidual(negativeEnd, negativeStart, centerEnd)).toBeLessThan(1e-10)
  })
})
