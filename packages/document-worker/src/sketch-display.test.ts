import type { FeatureGeometryRecord } from "@vibeshape/application/feature-rebuild"
import { documentSnapshotSchema, sketchEntityIdSchema, sketchRecordSchema } from "@vibeshape/domain"
import {
  detectSketchProfiles,
  SKETCH_SOLVER_BUILD,
  type SketchCompilationInput,
  type SolveSketchRecordResult,
} from "@vibeshape/sketch-solver"
import { describe, expect, it, vi } from "vitest"
import { createSketchDisplayRecords } from "./sketch-display"

describe("document sketch display", () => {
  it("projects authored sketch curves and points through the exact origin-plane frame", async () => {
    const sketch = sketchRecordSchema.parse({
      schemaVersion: 0,
      id: "0195b5ac-b220-7a2c-8c33-67a36a7f3201",
      label: "XZ reference",
      plane: "xz",
      entities: [
        {
          schemaVersion: 0,
          id: "0195b5ac-b220-7a2c-8c33-67a36a7f3211",
          type: "point",
          x: 2,
          y: 3,
          construction: false,
        },
        {
          schemaVersion: 0,
          id: "0195b5ac-b220-7a2c-8c33-67a36a7f3212",
          type: "point",
          x: 7,
          y: 11,
          construction: false,
        },
        {
          schemaVersion: 0,
          id: "0195b5ac-b220-7a2c-8c33-67a36a7f3213",
          type: "line",
          startPointId: "0195b5ac-b220-7a2c-8c33-67a36a7f3211",
          endPointId: "0195b5ac-b220-7a2c-8c33-67a36a7f3212",
          construction: false,
        },
      ],
      constraints: [],
    })
    const document = documentSnapshotSchema.parse({
      schemaVersion: 0,
      id: "0195b5ac-b213-7f2c-9c33-67a36a7f21ac",
      revision: 4,
      name: "Sketch display",
      variables: [],
      sketches: [sketch],
      features: [],
      createdAt: "2026-08-20T00:00:00.000Z",
      updatedAt: "2026-08-20T00:00:00.000Z",
    })

    const records = await createSketchDisplayRecords(document, null, new Map())

    expect(records).toHaveLength(1)
    expect(Array.from(records[0]?.curvePositions ?? [])).toEqual([2, 0, 3, 7, 0, 11])
    expect(Array.from(records[0]?.pointPositions ?? [])).toEqual([2, 0, 3, 7, 0, 11])
  })

  it("uses the engine section port while rebuilding persisted sketch display references", async () => {
    const featureId = "0195b5ac-b220-7a2c-8c33-67a36a7f3301"
    const sketch = sketchRecordSchema.parse({
      schemaVersion: 0,
      id: "0195b5ac-b220-7a2c-8c33-67a36a7f3201",
      label: "Persisted intersection",
      plane: "xy",
      entities: [],
      constraints: [],
      externalReferences: [
        {
          schemaVersion: 0,
          id: "0195b5ac-b220-7a2c-8c33-67a36a7f3401",
          kind: "model-intersection",
          reference: {
            schemaVersion: 0,
            featureId,
            kind: "face",
            semanticRole: "primitive.box.side.x-max",
            signature: {
              kind: "face",
              geometryClass: "PLANE",
              measure: 100,
              centroid: [0, 5, 5],
              bounds: { min: [0, 0, 0], max: [0, 10, 10] },
              direction: [1, 0, 0],
              directionMode: "oriented",
              boundaryCount: 4,
              adjacentGeometryClasses: ["PLANE", "PLANE", "PLANE", "PLANE"],
            },
          },
          projectedLineId: "0195b5ac-b220-7a2c-8c33-67a36a7f3402",
          projectedStartPointId: "0195b5ac-b220-7a2c-8c33-67a36a7f3403",
          projectedEndPointId: "0195b5ac-b220-7a2c-8c33-67a36a7f3404",
        },
      ],
    })
    const feature = {
      schemaVersion: 0,
      id: featureId,
      type: {
        moduleId: "org.vibeshape.test",
        moduleVersion: "0.1.0",
        typeId: "org.vibeshape.test.fixture",
        schemaVersion: 1,
      },
      parameters: {},
      dependencies: [],
      references: [],
      suppressed: false,
    }
    const document = documentSnapshotSchema.parse({
      schemaVersion: 0,
      id: "0195b5ac-b213-7f2c-9c33-67a36a7f21ac",
      revision: 1,
      name: "Persisted intersection",
      displayUnits: { length: "mm", angle: "deg" },
      variables: [],
      sketches: [sketch],
      features: [feature],
      createdAt: "2026-08-20T00:00:00.000Z",
      updatedAt: "2026-08-20T00:00:00.000Z",
    })
    const sectionPlanarFace = vi.fn(async () => ({
      ok: true as const,
      endpoints: [
        [0, 2, 0],
        [0, 8, 0],
      ] as const,
    }))
    const solveSketch = vi.fn(
      async (input: SketchCompilationInput): Promise<SolveSketchRecordResult> => {
        const points = (input.externalLines ?? []).flatMap(({ startPoint, endPoint }) => [
          { entityId: sketchEntityIdSchema.parse(startPoint.id), x: startPoint.x, y: startPoint.y },
          { entityId: sketchEntityIdSchema.parse(endPoint.id), x: endPoint.x, y: endPoint.y },
        ])
        const parsedSketch = sketchRecordSchema.parse(input.sketch)
        return {
          ok: true as const,
          solution: {
            schemaVersion: 0 as const,
            sketchId: parsedSketch.id,
            sourceRevision: input.revision,
            status: "under-constrained" as const,
            degreesOfFreedom: 0,
            maximumResidual: 0,
            points,
            circles: [],
            failedConstraintIds: [],
            profileResult: detectSketchProfiles(parsedSketch, { points, circles: [] }),
            heapCapacityBytes: 1024,
            solverBuild: SKETCH_SOLVER_BUILD,
          },
        } satisfies SolveSketchRecordResult
      },
    )
    const geometry = [
      {
        featureId,
        contentHash: "a".repeat(64),
        geometry: {
          topologyCandidates: [
            {
              candidateId: "face:current",
              kind: "face",
              meshFaceId: 313,
              semanticRole: "primitive.box.side.x-max",
              lineageTokens: [],
              signature: {
                kind: "face",
                geometryClass: "PLANE",
                measure: 100,
                centroid: [0, 5, 5],
                bounds: { min: [0, 0, 0], max: [0, 10, 10] },
                direction: [1, 0, 0],
                directionMode: "oriented",
                boundaryCount: 4,
                adjacentGeometryClasses: ["PLANE", "PLANE", "PLANE", "PLANE"],
              },
            },
          ],
        },
      },
    ] as unknown as readonly FeatureGeometryRecord[]

    const records = await createSketchDisplayRecords(
      document,
      solveSketch,
      new Map(),
      document.features,
      geometry,
      sectionPlanarFace,
    )

    expect(sectionPlanarFace).toHaveBeenCalledOnce()
    expect(solveSketch).toHaveBeenCalledWith(
      expect.objectContaining({ externalLines: expect.any(Array) }),
    )
    expect(Array.from(records[0]?.constructionCurvePositions ?? [])).toEqual([0, 2, 0, 0, 8, 0])

    const failedRecords = await createSketchDisplayRecords(
      document,
      solveSketch,
      new Map(),
      document.features,
      geometry,
      async () => ({
        ok: false,
        diagnostic: {
          code: "disjoint-plane",
          message: "The target plane does not intersect the face.",
        },
      }),
    )
    expect(Array.from(failedRecords[0]?.constructionCurvePositions ?? [])).toEqual([])
    expect(Array.from(failedRecords[0]?.constructionPointPositions ?? [])).toEqual([])
  })
})
