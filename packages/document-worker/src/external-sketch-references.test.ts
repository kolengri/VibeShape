import {
  documentSnapshotSchema,
  type SketchRecord,
  sketchEntityIdSchema,
  sketchExternalReferenceIdSchema,
  sketchIdSchema,
  sketchRecordSchema,
} from "@vibeshape/domain"
import {
  detectSketchProfiles,
  SKETCH_SOLVER_BUILD,
  type SolveSketchRecordResult,
} from "@vibeshape/sketch-solver"
import { describe, expect, it, vi } from "vitest"
import { resolveExternalSketchGeometry, type SketchSolvePort } from "./external-sketch-references"

const id = (suffix: string) => `0195b5ac-b220-7a2c-8c33-67a36a7f${suffix}`

function pointSketch(index: number, x: number): SketchRecord {
  return sketchRecordSchema.parse({
    schemaVersion: 0,
    id: id(`41${index.toString().padStart(2, "0")}`),
    label: `Sketch ${index}`,
    plane: "xy",
    entities: [
      {
        schemaVersion: 0,
        id: id(`42${index.toString().padStart(2, "0")}`),
        type: "point",
        construction: false,
        x,
        y: 0,
      },
    ],
    constraints: [],
  })
}

function externalPoint(source: SketchRecord, index: number) {
  const sourcePoint = source.entities[0]
  if (sourcePoint?.type !== "point") throw new Error("Expected a source point.")
  return {
    schemaVersion: 0 as const,
    id: sketchExternalReferenceIdSchema.parse(id(`43${index.toString().padStart(2, "0")}`)),
    kind: "point" as const,
    sourceSketchId: source.id,
    sourcePointId: sourcePoint.id,
    projectedPointId: sketchEntityIdSchema.parse(id(`44${index.toString().padStart(2, "0")}`)),
  }
}

function solved(input: Parameters<SketchSolvePort>[0]): SolveSketchRecordResult {
  const sketch = sketchRecordSchema.parse(input.sketch)
  const external = input.externalPoints?.[0]
  const points = sketch.entities.flatMap((entity) =>
    entity.type === "point"
      ? [{ entityId: entity.id, x: external?.x ?? entity.x, y: external?.y ?? entity.y }]
      : [],
  )
  return {
    ok: true,
    solution: {
      schemaVersion: 0,
      sketchId: sketchIdSchema.parse(sketch.id),
      sourceRevision: input.revision,
      status: "under-constrained",
      degreesOfFreedom: points.length * 2,
      maximumResidual: 0,
      points,
      circles: [],
      failedConstraintIds: [],
      profileResult: detectSketchProfiles(sketch, { points, circles: [] }),
      heapCapacityBytes: 1024,
      solverBuild: SKETCH_SOLVER_BUILD,
    },
  }
}

describe("external sketch reference resolution", () => {
  it("resolves a source sketch through its own external-reference chain", async () => {
    const first = pointSketch(1, 12)
    const second = sketchRecordSchema.parse({
      ...pointSketch(2, 0),
      externalReferences: [externalPoint(first, 1)],
    })
    const third = sketchRecordSchema.parse({
      ...pointSketch(3, 0),
      externalReferences: [externalPoint(second, 2)],
    })
    const document = documentSnapshotSchema.parse({
      schemaVersion: 0,
      id: id("4000"),
      revision: 1,
      name: "Reference chain",
      displayUnits: { length: "mm", angle: "deg" },
      variables: [],
      sketches: [first, second, third],
      features: [],
      createdAt: "2026-08-25T00:00:00.000Z",
      updatedAt: "2026-08-25T00:00:00.000Z",
    })
    const solveSketch = vi.fn<SketchSolvePort>(solved)
    const thirdReference = third.externalReferences?.[0]
    if (thirdReference?.kind !== "point") throw new Error("Expected an external point reference.")

    const result = await resolveExternalSketchGeometry(document, third, solveSketch)

    expect(result.externalPoints).toEqual([
      expect.objectContaining({ id: thirdReference.projectedPointId, x: 12, y: 0 }),
    ])
    expect(solveSketch).toHaveBeenCalledTimes(2)
    expect(
      solveSketch.mock.calls.find(([input]) => input.sketch.id === second.id)?.[0].externalPoints,
    ).toEqual([expect.objectContaining({ x: 12, y: 0 })])
  })

  it("materializes a solved source circle as stable read-only external geometry", async () => {
    const centerId = sketchEntityIdSchema.parse(id("4501"))
    const circleId = sketchEntityIdSchema.parse(id("4502"))
    const source = sketchRecordSchema.parse({
      schemaVersion: 0,
      id: id("4503"),
      label: "Source circle",
      plane: "xy",
      entities: [
        {
          schemaVersion: 0,
          id: centerId,
          type: "point",
          construction: false,
          x: 2,
          y: 3,
        },
        {
          schemaVersion: 0,
          id: circleId,
          type: "circle",
          construction: false,
          centerPointId: centerId,
          radius: 5,
        },
      ],
      constraints: [],
    })
    const projectedCenterId = sketchEntityIdSchema.parse(id("4504"))
    const projectedCircleId = sketchEntityIdSchema.parse(id("4505"))
    const target = sketchRecordSchema.parse({
      schemaVersion: 0,
      id: id("4506"),
      label: "Target",
      plane: "xy",
      entities: [],
      constraints: [],
      externalReferences: [
        {
          schemaVersion: 0,
          id: id("4507"),
          kind: "curve",
          sourceSketchId: source.id,
          sourceEntityId: circleId,
          sourceType: "circle",
          projectedEntityId: projectedCircleId,
          projectedType: "circle",
          projectedPointIds: [projectedCenterId],
        },
      ],
    })
    const document = documentSnapshotSchema.parse({
      schemaVersion: 0,
      id: id("4508"),
      revision: 2,
      name: "Curve reference",
      displayUnits: { length: "mm", angle: "deg" },
      variables: [],
      sketches: [source, target],
      features: [],
      createdAt: "2026-08-25T00:00:00.000Z",
      updatedAt: "2026-08-25T00:00:00.000Z",
    })
    const solveSketch = vi.fn<SketchSolvePort>((input) => {
      const points = [{ entityId: centerId, x: 10, y: 12 }]
      const circles = [{ entityId: circleId, radius: 7 }]
      return {
        ok: true,
        solution: {
          schemaVersion: 0,
          sketchId: sketchIdSchema.parse(input.sketch.id),
          sourceRevision: input.revision,
          status: "under-constrained",
          degreesOfFreedom: 3,
          maximumResidual: 0,
          points,
          circles,
          failedConstraintIds: [],
          profileResult: detectSketchProfiles(source, { points, circles }),
          heapCapacityBytes: 1024,
          solverBuild: SKETCH_SOLVER_BUILD,
        },
      }
    })

    const result = await resolveExternalSketchGeometry(document, target, solveSketch)

    expect(result.externalCurves).toEqual([
      {
        points: [expect.objectContaining({ id: projectedCenterId, x: 10, y: 12 })],
        curve: expect.objectContaining({
          id: projectedCircleId,
          type: "circle",
          centerPointId: projectedCenterId,
          radius: 7,
        }),
      },
    ])
  })
})
