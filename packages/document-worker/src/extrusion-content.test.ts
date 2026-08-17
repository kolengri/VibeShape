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
        plane: "xz",
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
