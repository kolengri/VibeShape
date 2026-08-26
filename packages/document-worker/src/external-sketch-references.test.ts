import type { FeatureGeometryRecord } from "@vibeshape/application/feature-rebuild"
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
  it("materializes an exact planar-face section through the current worker-local face key", async () => {
    const featureId = id("4640")
    const contentHash = "a".repeat(64)
    const signature = {
      kind: "face" as const,
      geometryClass: "PLANE",
      measure: 100,
      centroid: [0, 5, 5] as [number, number, number],
      bounds: {
        min: [0, 0, 0] as [number, number, number],
        max: [0, 10, 10] as [number, number, number],
      },
      direction: [1, 0, 0] as [number, number, number],
      directionMode: "oriented" as const,
      boundaryCount: 4,
      adjacentGeometryClasses: ["PLANE", "PLANE", "PLANE", "PLANE"],
    }
    const feature = {
      schemaVersion: 0 as const,
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
    const target = sketchRecordSchema.parse({
      ...pointSketch(9, 0),
      entities: [],
      externalReferences: [
        {
          schemaVersion: 0,
          id: id("4641"),
          kind: "model-intersection",
          reference: {
            schemaVersion: 0,
            featureId,
            kind: "face",
            semanticRole: "primitive.box.side.x-max",
            signature,
          },
          projectedLineId: id("4642"),
          projectedStartPointId: id("4643"),
          projectedEndPointId: id("4644"),
        },
      ],
    })
    const document = documentSnapshotSchema.parse({
      schemaVersion: 0,
      id: id("4645"),
      revision: 1,
      name: "Planar face intersection",
      displayUnits: { length: "mm", angle: "deg" },
      variables: [],
      sketches: [target],
      features: [feature],
      createdAt: "2026-08-26T00:00:00.000Z",
      updatedAt: "2026-08-26T00:00:00.000Z",
    })
    const geometry = [
      {
        featureId,
        contentHash,
        geometry: {
          topologyCandidates: [
            {
              candidateId: "face:current",
              kind: "face",
              meshFaceId: 313,
              semanticRole: "primitive.box.side.x-max",
              lineageTokens: [],
              signature,
            },
          ],
        },
      },
    ] as unknown as readonly FeatureGeometryRecord[]
    const sectionPlanarFace = vi.fn(async () => ({
      ok: true as const,
      endpoints: [
        [0, 2, 0],
        [0, 8, 0],
      ] as const,
    }))

    const result = await resolveExternalSketchGeometry(
      document,
      target,
      vi.fn(solved),
      [],
      new Map(),
      geometry,
      sectionPlanarFace,
    )

    expect(sectionPlanarFace).toHaveBeenCalledWith(
      expect.objectContaining({
        documentId: document.id,
        sourceFeatureId: featureId,
        sourceContentHash: contentHash,
        resolvedFaceKey: 313,
        planeOrigin: [0, 0, 0],
        planeNormal: [0, 0, 1],
      }),
    )
    expect(result.externalLines).toEqual([
      expect.objectContaining({
        startPoint: expect.objectContaining({ x: 0, y: 2 }),
        endPoint: expect.objectContaining({ x: 0, y: 8 }),
      }),
    ])
  })

  it("projects resolved model vertices and edges from feature geometry", async () => {
    const featureId = id("4600")
    const feature = {
      schemaVersion: 0 as const,
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
    const target = sketchRecordSchema.parse({
      ...pointSketch(6, 0),
      entities: [],
      externalReferences: [
        {
          schemaVersion: 0,
          id: id("4601"),
          kind: "model-point",
          reference: {
            schemaVersion: 0,
            featureId,
            kind: "vertex",
            semanticRole: "vertex.source",
            signature: {
              kind: "vertex",
              geometryClass: "POINT",
              measure: 0,
              centroid: [3, 4, 9],
              bounds: { min: [3, 4, 9], max: [3, 4, 9] },
              boundaryCount: 0,
              adjacentGeometryClasses: [],
            },
          },
          projectedPointId: id("4602"),
        },
        {
          schemaVersion: 0,
          id: id("4603"),
          kind: "model-line",
          reference: {
            schemaVersion: 0,
            featureId,
            kind: "edge",
            semanticRole: "edge.source",
            signature: {
              kind: "edge",
              geometryClass: "LINE",
              measure: 5,
              centroid: [2, 0, 2.5],
              bounds: { min: [0, 0, 0], max: [4, 0, 5] },
              direction: [0.8, 0, 0.6],
              directionMode: "oriented",
              boundaryCount: 2,
              adjacentGeometryClasses: [],
            },
          },
          projectedLineId: id("4604"),
          projectedStartPointId: id("4605"),
          projectedEndPointId: id("4606"),
        },
      ],
    })
    const document = documentSnapshotSchema.parse({
      ...documentSnapshotSchema.parse({
        schemaVersion: 0,
        id: id("4607"),
        revision: 1,
        name: "Model reference",
        displayUnits: { length: "mm", angle: "deg" },
        variables: [],
        sketches: [target],
        features: [feature],
        createdAt: "2026-08-25T00:00:00.000Z",
        updatedAt: "2026-08-25T00:00:00.000Z",
      }),
    })
    const candidate = (
      kind: "vertex" | "edge",
      semanticRole: string,
      referenceGeometry: unknown,
    ) => ({
      candidateId: id(`46${kind === "vertex" ? "08" : "09"}`),
      kind,
      semanticRole,
      lineageTokens: [],
      referenceGeometry,
      signature: {
        kind,
        geometryClass: kind === "vertex" ? "POINT" : "LINE",
        measure: kind === "vertex" ? 0 : 5,
        centroid: kind === "vertex" ? [3, 4, 9] : [2, 0, 2.5],
        bounds:
          kind === "vertex"
            ? { min: [3, 4, 9], max: [3, 4, 9] }
            : { min: [0, 0, 0], max: [4, 0, 5] },
        ...(kind === "edge"
          ? { direction: [0.8, 0, 0.6], directionMode: "oriented" as const }
          : {}),
        boundaryCount: kind === "vertex" ? 0 : 2,
        adjacentGeometryClasses: [],
      },
    })
    const geometry = [
      {
        featureId,
        geometry: {
          topologyCandidates: [
            candidate("vertex", "vertex.source", { kind: "vertex", position: [3, 4, 9] }),
            candidate("edge", "edge.source", {
              kind: "line-edge",
              start: [0, 0, 0],
              end: [4, 0, 5],
            }),
          ],
        },
      },
    ] as unknown as readonly FeatureGeometryRecord[]

    const result = await resolveExternalSketchGeometry(
      document,
      target,
      vi.fn(solved),
      [],
      new Map(),
      geometry,
    )

    expect(result.externalPoints).toEqual([expect.objectContaining({ x: 3, y: 4 })])
    expect(result.externalLines?.[0]).toEqual(
      expect.objectContaining({
        startPoint: expect.objectContaining({ x: 0, y: 0 }),
        endPoint: expect.objectContaining({ x: 4, y: 0 }),
      }),
    )
  })

  it("fails closed when model reference geometry payload is missing", async () => {
    const sourceFeatureId = id("4610")
    const feature = {
      schemaVersion: 0 as const,
      id: sourceFeatureId,
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
    const target = sketchRecordSchema.parse({
      ...pointSketch(7, 0),
      entities: [],
      externalReferences: [
        {
          schemaVersion: 0,
          id: id("4611"),
          kind: "model-point",
          reference: {
            schemaVersion: 0,
            featureId: sourceFeatureId,
            kind: "vertex",
            signature: {
              kind: "vertex",
              geometryClass: "VERTEX",
              measure: 0,
              centroid: [0, 0, 0],
              bounds: { min: [0, 0, 0], max: [0, 0, 0] },
              boundaryCount: 0,
              adjacentGeometryClasses: [],
            },
          },
          projectedPointId: id("4612"),
        },
      ],
    })
    const document = documentSnapshotSchema.parse({
      schemaVersion: 0,
      id: id("4613"),
      revision: 1,
      name: "Missing model geometry",
      displayUnits: { length: "mm", angle: "deg" },
      variables: [],
      sketches: [target],
      features: [feature],
      createdAt: "2026-08-25T00:00:00.000Z",
      updatedAt: "2026-08-25T00:00:00.000Z",
    })

    await expect(resolveExternalSketchGeometry(document, target, vi.fn(solved))).rejects.toThrow(
      "geometry is unavailable",
    )
  })

  it("materializes an exact circular model edge as read-only curve geometry", async () => {
    const featureId = id("4620")
    const projectedEntityId = id("4621")
    const projectedCenterId = id("4622")
    const feature = {
      schemaVersion: 0 as const,
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
    const signature = {
      kind: "edge" as const,
      geometryClass: "CIRCLE",
      measure: Math.PI * 10,
      centroid: [2, 3, 0],
      bounds: { min: [-3, -2, 0], max: [7, 8, 0] },
      boundaryCount: 0,
      adjacentGeometryClasses: [],
    }
    const target = sketchRecordSchema.parse({
      ...pointSketch(8, 0),
      entities: [],
      externalReferences: [
        {
          schemaVersion: 0,
          id: id("4623"),
          kind: "model-curve",
          reference: {
            schemaVersion: 0,
            featureId,
            kind: "edge",
            semanticRole: "edge.circular",
            signature,
          },
          sourceType: "circle",
          projectedEntityId,
          projectedType: "circle",
          projectedPointIds: [projectedCenterId],
        },
      ],
    })
    const document = documentSnapshotSchema.parse({
      schemaVersion: 0,
      id: id("4624"),
      revision: 1,
      name: "Circular model reference",
      displayUnits: { length: "mm", angle: "deg" },
      variables: [],
      sketches: [target],
      features: [feature],
      createdAt: "2026-08-25T00:00:00.000Z",
      updatedAt: "2026-08-25T00:00:00.000Z",
    })
    const geometry = [
      {
        featureId,
        geometry: {
          topologyCandidates: [
            {
              candidateId: "edge:rebuilt-circle",
              kind: "edge",
              semanticRole: "edge.circular",
              lineageTokens: [],
              signature,
              referenceGeometry: {
                kind: "circle-edge",
                center: [2, 3, 0],
                xAxis: [1, 0, 0],
                yAxis: [0, 1, 0],
                normal: [0, 0, 1],
                radius: 5,
              },
            },
          ],
        },
      },
    ] as unknown as readonly FeatureGeometryRecord[]

    const result = await resolveExternalSketchGeometry(
      document,
      target,
      vi.fn(solved),
      [],
      new Map(),
      geometry,
    )

    expect(result.externalCurves).toEqual([
      {
        points: [expect.objectContaining({ id: projectedCenterId, x: 2, y: 3 })],
        curve: expect.objectContaining({
          id: projectedEntityId,
          type: "circle",
          centerPointId: projectedCenterId,
          radius: 5,
          construction: true,
        }),
      },
    ])
  })

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
