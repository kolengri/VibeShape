import {
  createLengthQuantity,
  createRectangleSketch,
  documentSnapshotSchema,
  extrusionFeatureType,
  featureRecordSchema,
  type SketchRecord,
  sketchConstraintIdSchema,
  sketchEntityIdSchema,
  sketchIdSchema,
  sketchRecordSchema,
} from "@vibeshape/domain"
import {
  createSketchProfileSelector,
  detectSketchProfiles,
  SKETCH_SOLVER_BUILD,
  type SolveSketchRecordResult,
} from "@vibeshape/sketch-solver"
import { describe, expect, it, vi } from "vitest"
import { createDocumentFeatureContentPreparer } from "./extrusion-content"

const sketchId = sketchIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f3201")
const entityIds = Array.from({ length: 8 }, (_, index) =>
  sketchEntityIdSchema.parse(`0195b5ac-b220-7a2c-8c33-${String(3210 + index).padStart(12, "0")}`),
)
const constraintIds = Array.from({ length: 7 }, (_, index) =>
  sketchConstraintIdSchema.parse(
    `0195b5ac-b220-7a2c-8c33-${String(3230 + index).padStart(12, "0")}`,
  ),
)

function fixture() {
  const nextEntityId = vi.fn(() => {
    const entityId = entityIds[nextEntityId.mock.calls.length - 1]
    if (!entityId) throw new Error("The entity fixture is exhausted.")
    return entityId
  })
  const nextConstraintId = vi.fn(() => {
    const constraintId = constraintIds[nextConstraintId.mock.calls.length - 1]
    if (!constraintId) throw new Error("The constraint fixture is exhausted.")
    return constraintId
  })
  const sketch = createRectangleSketch({
    id: sketchId,
    label: "Profile",
    plane: "xz",
    width: createLengthQuantity(20),
    height: createLengthQuantity(10),
    createEntityId: nextEntityId,
    createConstraintId: nextConstraintId,
  })
  return extrusionFixture(sketch)
}

function extrusionFixture(sketch: SketchRecord) {
  const points = sketch.entities.flatMap((entity) =>
    entity.type === "point" ? [{ entityId: entity.id, x: entity.x, y: entity.y }] : [],
  )
  const profileResult = detectSketchProfiles(sketch, { points, circles: [] })
  const selector = createSketchProfileSelector(sketch.id, profileResult, 0)
  if (!selector) throw new Error("Expected the rectangle profile selector.")
  const feature = featureRecordSchema.parse({
    schemaVersion: 0,
    id: "0195b5ac-b220-7a2c-8c33-000000003301",
    type: extrusionFeatureType.type,
    parameters: {
      profile: selector,
      distance: createLengthQuantity(15),
      symmetric: true,
      operation: "new",
    },
    dependencies: [],
    references: [],
    suppressed: false,
  })
  const document = documentSnapshotSchema.parse({
    schemaVersion: 0,
    id: "0195b5ac-b213-7f2c-9c33-67a36a7f21ac",
    revision: 3,
    name: "Extrusion preparation",
    variables: [],
    sketches: [sketch],
    features: [feature],
    createdAt: "2026-08-09T00:00:00.000Z",
    updatedAt: "2026-08-09T00:00:00.000Z",
  })
  const solution = {
    schemaVersion: 0,
    sketchId: sketch.id,
    sourceRevision: document.revision,
    status: "fully-constrained",
    degreesOfFreedom: 0,
    maximumResidual: 0,
    points,
    circles: [],
    failedConstraintIds: [],
    profileResult,
    heapCapacityBytes: 1024,
    solverBuild: SKETCH_SOLVER_BUILD,
  } as const
  return { document, feature, solution }
}

function ellipseFixture() {
  return extrusionFixture(
    sketchRecordSchema.parse({
      schemaVersion: 0,
      id: sketchId,
      label: "Ellipse profile",
      plane: "xy",
      entities: [
        {
          schemaVersion: 0,
          id: "0195b5ac-b220-7a2c-8c33-000000003401",
          type: "point",
          x: 2,
          y: 3,
          construction: false,
        },
        {
          schemaVersion: 0,
          id: "0195b5ac-b220-7a2c-8c33-000000003402",
          type: "point",
          x: 12,
          y: 3,
          construction: false,
        },
        {
          schemaVersion: 0,
          id: "0195b5ac-b220-7a2c-8c33-000000003403",
          type: "point",
          x: 2,
          y: 8,
          construction: false,
        },
        {
          schemaVersion: 0,
          id: "0195b5ac-b220-7a2c-8c33-000000003404",
          type: "ellipse",
          centerPointId: "0195b5ac-b220-7a2c-8c33-000000003401",
          primaryAxisPointId: "0195b5ac-b220-7a2c-8c33-000000003402",
          secondaryAxisPointId: "0195b5ac-b220-7a2c-8c33-000000003403",
          construction: false,
        },
      ],
      constraints: [],
    }),
  )
}

function ellipticalArcFixture() {
  return extrusionFixture(
    sketchRecordSchema.parse({
      schemaVersion: 0,
      id: sketchId,
      label: "Elliptical arc profile",
      plane: "xy",
      entities: [
        {
          schemaVersion: 0,
          id: "0195b5ac-b220-7a2c-8c33-000000003411",
          type: "point",
          x: 0,
          y: 0,
          construction: false,
        },
        {
          schemaVersion: 0,
          id: "0195b5ac-b220-7a2c-8c33-000000003412",
          type: "point",
          x: 10,
          y: 0,
          construction: false,
        },
        {
          schemaVersion: 0,
          id: "0195b5ac-b220-7a2c-8c33-000000003413",
          type: "point",
          x: 0,
          y: 5,
          construction: false,
        },
        {
          schemaVersion: 0,
          id: "0195b5ac-b220-7a2c-8c33-000000003414",
          type: "point",
          x: -10,
          y: 0,
          construction: false,
        },
        {
          schemaVersion: 0,
          id: "0195b5ac-b220-7a2c-8c33-000000003415",
          type: "elliptical-arc",
          centerPointId: "0195b5ac-b220-7a2c-8c33-000000003411",
          primaryAxisPointId: "0195b5ac-b220-7a2c-8c33-000000003412",
          secondaryAxisPointId: "0195b5ac-b220-7a2c-8c33-000000003413",
          startPointId: "0195b5ac-b220-7a2c-8c33-000000003412",
          endPointId: "0195b5ac-b220-7a2c-8c33-000000003414",
          construction: false,
        },
        {
          schemaVersion: 0,
          id: "0195b5ac-b220-7a2c-8c33-000000003416",
          type: "line",
          startPointId: "0195b5ac-b220-7a2c-8c33-000000003414",
          endPointId: "0195b5ac-b220-7a2c-8c33-000000003412",
          construction: false,
        },
      ],
      constraints: [],
    }),
  )
}

describe("document extrusion content preparation", () => {
  it("resolves a stable selector into ordered exact profile geometry", async () => {
    const { document, feature, solution } = fixture()
    const solve = vi.fn((): SolveSketchRecordResult => ({ ok: true, solution }))
    const prepare = createDocumentFeatureContentPreparer(solve)

    const first = await prepare({ document, feature })
    const second = await prepare({ document, feature })

    expect(first).toMatchObject({
      ok: true,
      parameters: {
        sketchId,
        frame: {
          origin: [0, 0, 0],
          xAxis: [1, 0, 0],
          yAxis: [0, 0, 1],
          normal: [0, -1, 0],
        },
        distance: 15,
        symmetric: true,
        operation: "new",
        outer: { sourceEntityIds: expect.arrayContaining(entityIds.slice(4)) },
        holes: [],
      },
    })
    expect(second).toEqual(first)
    expect(solve).toHaveBeenCalledTimes(1)
  })

  it("materializes an exact solved ellipse for the geometry worker", async () => {
    const { document, feature, solution } = ellipseFixture()
    const prepare = createDocumentFeatureContentPreparer(() => ({ ok: true, solution }))

    await expect(prepare({ document, feature })).resolves.toMatchObject({
      ok: true,
      parameters: {
        outer: {
          segments: [
            {
              entityId: "0195b5ac-b220-7a2c-8c33-000000003404",
              type: "ellipse",
              center: [2, 3],
              primaryAxisPoint: [12, 3],
              secondaryAxisPoint: [2, 8],
            },
          ],
        },
      },
    })
  })

  it("resolves an extrusion-cap support into a parametric world frame", async () => {
    const source = fixture()
    const reference = {
      schemaVersion: 0 as const,
      featureId: source.feature.id,
      kind: "face" as const,
      semanticRole: "extrusion.cap.end",
      signature: {
        kind: "face" as const,
        geometryClass: "PLANE",
        measure: 200,
        centroid: [0, -7.5, 0] as [number, number, number],
        bounds: {
          min: [-10, -7.5, -5] as [number, number, number],
          max: [10, -7.5, 5] as [number, number, number],
        },
        direction: [0, -1, 0] as [number, number, number],
        directionMode: "oriented" as const,
        boundaryCount: 4,
        adjacentGeometryClasses: ["PLANE"],
      },
    }
    const supportedSketch = sketchRecordSchema.parse({
      ...source.document.sketches[0],
      id: "0195b5ac-b220-7a2c-8c33-67a36a7f3299",
      label: "Supported profile",
      support: { kind: "feature-face", reference },
    })
    const target = extrusionFixture(supportedSketch)
    const feature = featureRecordSchema.parse({
      ...target.feature,
      id: "0195b5ac-b220-7a2c-8c33-000000003302",
      dependencies: [source.feature.id],
      references: [reference],
    })
    const document = documentSnapshotSchema.parse({
      ...target.document,
      sketches: [source.document.sketches[0], supportedSketch],
      features: [source.feature, feature],
    })
    const prepare = createDocumentFeatureContentPreparer(() => ({
      ok: true,
      solution: target.solution,
    }))

    await expect(
      prepare({ document, feature, features: document.features }),
    ).resolves.toMatchObject({
      ok: true,
      parameters: {
        supportFeatureId: source.feature.id,
        frame: {
          origin: [0, -7.5, 0],
          xAxis: [1, 0, 0],
          yAxis: [0, 0, 1],
          normal: [0, -1, 0],
        },
      },
    })
  })

  it("materializes an ordered exact elliptical arc for the geometry worker", async () => {
    const { document, feature, solution } = ellipticalArcFixture()
    const prepare = createDocumentFeatureContentPreparer(() => ({ ok: true, solution }))

    await expect(prepare({ document, feature })).resolves.toMatchObject({
      ok: true,
      parameters: {
        outer: {
          segments: expect.arrayContaining([
            {
              entityId: "0195b5ac-b220-7a2c-8c33-000000003415",
              type: "elliptical-arc",
              center: [0, 0],
              primaryAxisPoint: [10, 0],
              secondaryAxisPoint: [0, 5],
              start: expect.any(Array),
              end: expect.any(Array),
            },
          ]),
        },
      },
    })
  })

  it("fails closed when the selected boundary disappears", async () => {
    const { document, feature, solution } = fixture()
    const prepare = createDocumentFeatureContentPreparer(() => ({
      ok: true,
      solution: { ...solution, profileResult: { ...solution.profileResult, profiles: [] } },
    }))

    await expect(prepare({ document, feature })).resolves.toMatchObject({
      ok: false,
      diagnostic: { code: "org.vibeshape.feature.sketch-profile-missing" },
    })
  })

  it("ignores unrelated feature types and reports an unavailable solver", async () => {
    const { document, feature } = fixture()
    const prepare = createDocumentFeatureContentPreparer(null)

    await expect(
      prepare({
        document,
        feature: {
          ...feature,
          type: { ...feature.type, typeId: "org.vibeshape.feature.part-design.box" },
        },
      }),
    ).resolves.toBeNull()
    await expect(prepare({ document, feature })).resolves.toMatchObject({
      ok: false,
      diagnostic: { code: "org.vibeshape.feature.sketch-solver-unavailable" },
    })
  })
})
