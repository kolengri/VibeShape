import type { FeatureGeometryRecord } from "@vibeshape/application/feature-rebuild"
import {
  createAngleQuantity,
  createLengthQuantity,
  createRectangleSketch,
  createSketchProfileSet,
  datumPlaneFeatureType,
  documentSnapshotSchema,
  extrusionFeatureType,
  extrusionFeatureTypeV4,
  featureRecordSchema,
  multiProfileExtrusionFeatureParametersSchema,
  multiProfileExtrusionFeatureType,
  revolveFeatureType,
  revolveFeatureTypeV6,
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

function constructionAxisFixture() {
  const source = fixture()
  const sketch = source.document.sketches[0]
  if (!sketch) throw new Error("Expected a profile sketch.")
  const startPointId = sketchEntityIdSchema.parse("0195b5ac-b220-7a2c-8c33-000000003420")
  const endPointId = sketchEntityIdSchema.parse("0195b5ac-b220-7a2c-8c33-000000003421")
  const axisEntityId = sketchEntityIdSchema.parse("0195b5ac-b220-7a2c-8c33-000000003422")
  const axisSketch = sketchRecordSchema.parse({
    ...sketch,
    entities: [
      ...sketch.entities,
      {
        schemaVersion: 0,
        id: startPointId,
        type: "point",
        x: -4,
        y: 2,
        construction: true,
      },
      {
        schemaVersion: 0,
        id: endPointId,
        type: "point",
        x: 6,
        y: 7,
        construction: true,
      },
      {
        schemaVersion: 0,
        id: axisEntityId,
        type: "line",
        startPointId,
        endPointId,
        construction: true,
      },
    ],
  })
  const document = documentSnapshotSchema.parse({
    ...source.document,
    sketches: [axisSketch],
  })
  const solution = {
    ...source.solution,
    points: [
      ...source.solution.points,
      { entityId: startPointId, x: -4, y: 2 },
      { entityId: endPointId, x: 6, y: 7 },
    ],
  }
  return {
    ...source,
    document,
    solution,
    sketch: axisSketch,
    startPointId,
    endPointId,
    axisEntityId,
  }
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

function multiCircleFixture() {
  const firstCenterId = sketchEntityIdSchema.parse("0195b5ac-b220-7a2c-8c33-000000003450")
  const secondCenterId = sketchEntityIdSchema.parse("0195b5ac-b220-7a2c-8c33-000000003451")
  const firstCircleId = sketchEntityIdSchema.parse("0195b5ac-b220-7a2c-8c33-000000003452")
  const secondCircleId = sketchEntityIdSchema.parse("0195b5ac-b220-7a2c-8c33-000000003453")
  const sketch = sketchRecordSchema.parse({
    schemaVersion: 0,
    id: sketchId,
    label: "Two profiles",
    plane: "xy",
    entities: [
      { schemaVersion: 0, id: firstCenterId, type: "point", x: -8, y: 0, construction: false },
      { schemaVersion: 0, id: secondCenterId, type: "point", x: 8, y: 0, construction: false },
      {
        schemaVersion: 0,
        id: firstCircleId,
        type: "circle",
        centerPointId: firstCenterId,
        radius: 5,
        construction: false,
      },
      {
        schemaVersion: 0,
        id: secondCircleId,
        type: "circle",
        centerPointId: secondCenterId,
        radius: 5,
        construction: false,
      },
    ],
    constraints: [],
  })
  const points = [
    { entityId: firstCenterId, x: -8, y: 0 },
    { entityId: secondCenterId, x: 8, y: 0 },
  ]
  const circles = [
    { entityId: firstCircleId, radius: 5 },
    { entityId: secondCircleId, radius: 5 },
  ]
  const profileResult = detectSketchProfiles(sketch, { points, circles })
  const selectors = [0, 1].map((index) =>
    createSketchProfileSelector(sketch.id, profileResult, index),
  )
  if (!selectors[0] || !selectors[1]) throw new Error("Expected two circle profiles.")
  const feature = featureRecordSchema.parse({
    schemaVersion: 0,
    id: "0195b5ac-b220-7a2c-8c33-000000003454",
    type: multiProfileExtrusionFeatureType.type,
    parameters: {
      profiles: createSketchProfileSet([selectors[1], selectors[0]]),
      distance: createLengthQuantity(10),
      symmetric: false,
      operation: "new",
    },
    dependencies: [],
    references: [],
    suppressed: false,
  })
  const document = documentSnapshotSchema.parse({
    schemaVersion: 0,
    id: "0195b5ac-b213-7f2c-9c33-67a36a7f21ad",
    revision: 1,
    name: "Multi-profile preparation",
    variables: [],
    sketches: [sketch],
    features: [feature],
    createdAt: "2026-08-31T00:00:00.000Z",
    updatedAt: "2026-08-31T00:00:00.000Z",
  })
  const solution = {
    schemaVersion: 0,
    sketchId,
    sourceRevision: document.revision,
    status: "under-constrained",
    degreesOfFreedom: 4,
    maximumResidual: 0,
    points,
    circles,
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
  it("resolves a signed origin-offset datum plane into an exact world frame", async () => {
    const feature = featureRecordSchema.parse({
      schemaVersion: 0,
      id: "0195b5ac-b220-7a2c-8c33-000000003300",
      type: datumPlaneFeatureType.type,
      parameters: {
        mode: "offset",
        support: { kind: "origin-plane", plane: "xz" },
        offset: createLengthQuantity(12),
      },
      dependencies: [],
      references: [],
      suppressed: false,
      label: "Plane 1",
    })
    const document = documentSnapshotSchema.parse({
      schemaVersion: 0,
      id: "0195b5ac-b213-7f2c-9c33-67a36a7f21ac",
      revision: 1,
      name: "Datum plane preparation",
      variables: [],
      sketches: [],
      features: [feature],
      createdAt: "2026-08-20T00:00:00.000Z",
      updatedAt: "2026-08-20T00:00:00.000Z",
    })
    const prepare = createDocumentFeatureContentPreparer(null)

    await expect(prepare({ document, feature })).resolves.toMatchObject({
      ok: true,
      parameters: {
        size: 64,
        frame: {
          origin: [0, -12, 0],
          xAxis: [1, 0, 0],
          yAxis: [0, 0, 1],
          normal: [0, -1, 0],
        },
      },
    })
  })

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

  it("solves once and materializes every canonical profile selector", async () => {
    const { document, feature, solution } = multiCircleFixture()
    const solve = vi.fn((): SolveSketchRecordResult => ({ ok: true, solution }))
    const prepare = createDocumentFeatureContentPreparer(solve)

    const prepared = await prepare({ document, feature })
    expect(prepared, JSON.stringify(prepared)).toMatchObject({
      ok: true,
      parameters: {
        profiles: [
          { outer: { sourceEntityIds: [expect.any(String)] }, holes: [] },
          { outer: { sourceEntityIds: [expect.any(String)] }, holes: [] },
        ],
        operation: "new",
      },
    })
    expect(solve).toHaveBeenCalledTimes(1)
  })

  it.each(["add", "remove", "intersect"] as const)(
    "preserves the multi-profile %s operation after one sketch solve",
    async (operation) => {
      const source = multiCircleFixture()
      const sourceParameters = multiProfileExtrusionFeatureParametersSchema.parse(
        source.feature.parameters,
      )
      const targetFeatureId = "0195b5ac-b220-7a2c-8c33-000000003455"
      const target = featureRecordSchema.parse({
        ...source.feature,
        id: targetFeatureId,
        type: extrusionFeatureType.type,
        parameters: {
          profile: sourceParameters.profiles.profiles[0],
          distance: createLengthQuantity(20),
          symmetric: false,
          operation: "new",
        },
      })
      const feature = featureRecordSchema.parse({
        ...source.feature,
        type: extrusionFeatureTypeV4.type,
        parameters: { ...sourceParameters, operation },
        dependencies: [targetFeatureId],
      })
      const document = documentSnapshotSchema.parse({
        ...source.document,
        features: [target, feature],
      })
      const solve = vi.fn((): SolveSketchRecordResult => ({ ok: true, solution: source.solution }))
      const prepare = createDocumentFeatureContentPreparer(solve)

      await expect(prepare({ document, feature })).resolves.toMatchObject({
        ok: true,
        parameters: {
          profiles: [{ outer: expect.any(Object) }, { outer: expect.any(Object) }],
          operation,
        },
      })
      expect(solve).toHaveBeenCalledTimes(1)
    },
  )

  it.each(["add", "remove", "intersect"] as const)(
    "preserves the multi-profile revolve %s operation after one sketch solve",
    async (operation) => {
      const source = multiCircleFixture()
      const sourceParameters = multiProfileExtrusionFeatureParametersSchema.parse(
        source.feature.parameters,
      )
      const targetFeatureId = "0195b5ac-b220-7a2c-8c33-000000003456"
      const target = featureRecordSchema.parse({
        ...source.feature,
        id: targetFeatureId,
        type: extrusionFeatureType.type,
        parameters: {
          profile: sourceParameters.profiles.profiles[0],
          distance: createLengthQuantity(20),
          symmetric: false,
          operation: "new",
        },
      })
      const feature = featureRecordSchema.parse({
        ...source.feature,
        type: revolveFeatureTypeV6.type,
        parameters: {
          profiles: sourceParameters.profiles,
          axis: { kind: "origin-axis", axis: "y" },
          angle: createAngleQuantity(180, "deg"),
          operation,
        },
        dependencies: [targetFeatureId],
      })
      const document = documentSnapshotSchema.parse({
        ...source.document,
        features: [target, feature],
      })
      const solve = vi.fn((): SolveSketchRecordResult => ({ ok: true, solution: source.solution }))
      const prepare = createDocumentFeatureContentPreparer(solve)

      await expect(prepare({ document, feature })).resolves.toMatchObject({
        ok: true,
        parameters: {
          profiles: [{ outer: expect.any(Object) }, { outer: expect.any(Object) }],
          axis: { kind: "origin-axis", axis: "y" },
          operation,
        },
      })
      expect(solve).toHaveBeenCalledTimes(1)
    },
  )

  it("prepares revolve content with a support-frame world axis", async () => {
    const source = fixture()
    const feature = featureRecordSchema.parse({
      ...source.feature,
      id: "0195b5ac-b220-7a2c-8c33-000000003309",
      type: revolveFeatureType.type,
      parameters: {
        profile: source.feature.parameters.profile,
        axis: { kind: "origin-axis", axis: "y" },
        angle: createAngleQuantity(180, "deg"),
        operation: "new",
      },
    })
    const document = documentSnapshotSchema.parse({ ...source.document, features: [feature] })
    const prepare = createDocumentFeatureContentPreparer(() => ({
      ok: true,
      solution: source.solution,
    }))

    await expect(prepare({ document, feature })).resolves.toMatchObject({
      ok: true,
      parameters: {
        sketchId,
        axis: { kind: "origin-axis", axis: "y" },
        axisOrigin: [0, 0, 0],
        axisDirection: [0, 0, 1],
        angleRadians: Math.PI,
        operation: "new",
      },
    })
  })

  it("resolves a selected stable sketch line into an exact support-frame world axis", async () => {
    const source = fixture()
    const sketch = source.document.sketches[0]
    const line = sketch?.entities.find((entity) => entity.type === "line")
    if (!sketch || !line) throw new Error("Expected a profile line.")
    const start = source.solution.points.find(({ entityId }) => entityId === line.startPointId)
    const end = source.solution.points.find(({ entityId }) => entityId === line.endPointId)
    if (!start || !end) throw new Error("Expected solved line endpoints.")
    const length = Math.hypot(end.x - start.x, end.y - start.y)
    const feature = featureRecordSchema.parse({
      ...source.feature,
      id: "0195b5ac-b220-7a2c-8c33-000000003311",
      type: revolveFeatureType.type,
      parameters: {
        profile: source.feature.parameters.profile,
        axis: { kind: "sketch-line", sketchId: sketch.id, entityId: line.id },
        angle: createAngleQuantity(180, "deg"),
        operation: "new",
      },
    })
    const document = documentSnapshotSchema.parse({ ...source.document, features: [feature] })
    const prepare = createDocumentFeatureContentPreparer(() => ({
      ok: true,
      solution: source.solution,
    }))

    await expect(prepare({ document, feature })).resolves.toMatchObject({
      ok: true,
      parameters: {
        axis: { kind: "sketch-line", sketchId: sketch.id, entityId: line.id },
        axisOrigin: [start.x, 0, start.y],
        axisDirection: [(end.x - start.x) / length, 0, (end.y - start.y) / length],
      },
    })
  })

  it("fails closed when a selected sketch-line axis no longer exists", async () => {
    const source = fixture()
    const feature = featureRecordSchema.parse({
      ...source.feature,
      id: "0195b5ac-b220-7a2c-8c33-000000003312",
      type: revolveFeatureType.type,
      parameters: {
        profile: source.feature.parameters.profile,
        axis: {
          kind: "sketch-line",
          sketchId,
          entityId: "0195b5ac-b220-7a2c-8c33-000000003399",
        },
        angle: createAngleQuantity(180, "deg"),
        operation: "new",
      },
    })
    const document = documentSnapshotSchema.parse({ ...source.document, features: [feature] })
    const prepare = createDocumentFeatureContentPreparer(() => ({
      ok: true,
      solution: source.solution,
    }))

    await expect(prepare({ document, feature })).resolves.toMatchObject({
      ok: false,
      diagnostic: { values: { reason: "revolve-axis-line-unavailable" } },
    })
  })

  it("resolves a stable model-edge axis after evaluation-local candidate IDs change", async () => {
    const source = fixture()
    const sourceFeatureId = source.feature.id
    const signature = {
      kind: "edge" as const,
      geometryClass: "LINE",
      measure: 5,
      centroid: [2.5, 0, 0] as const,
      bounds: { min: [0, 0, 0] as const, max: [5, 0, 0] as const },
      direction: [1, 0, 0] as const,
      directionMode: "axis" as const,
      boundaryCount: 2,
      adjacentGeometryClasses: ["PLANE", "PLANE"],
    }
    const reference = {
      schemaVersion: 0 as const,
      featureId: sourceFeatureId,
      kind: "edge" as const,
      semanticRole: "test.axis.edge",
      signature,
    }
    const feature = featureRecordSchema.parse({
      ...source.feature,
      id: "0195b5ac-b220-7a2c-8c33-000000003313",
      type: revolveFeatureType.type,
      parameters: {
        profile: source.feature.parameters.profile,
        axis: { kind: "model-edge", reference },
        angle: createAngleQuantity(180, "deg"),
        operation: "new",
      },
      dependencies: [sourceFeatureId],
    })
    const document = documentSnapshotSchema.parse({
      ...source.document,
      features: [source.feature, feature],
    })
    const geometry = [
      {
        featureId: sourceFeatureId,
        geometry: {
          topologyCandidates: [
            {
              candidateId: "edge:rebuilt-42",
              kind: "edge",
              semanticRole: "test.axis.edge",
              lineageTokens: [],
              signature,
              referenceGeometry: {
                kind: "line-edge",
                start: [0, 0, 0],
                end: [5, 0, 0],
              },
            },
          ],
        },
      },
    ] as unknown as readonly FeatureGeometryRecord[]
    const prepare = createDocumentFeatureContentPreparer(() => ({
      ok: true,
      solution: source.solution,
    }))

    await expect(prepare({ document, feature, geometry })).resolves.toMatchObject({
      ok: true,
      parameters: {
        axis: { kind: "model-edge", reference },
        axisOrigin: [0, 0, 0],
        axisDirection: [1, 0, 0],
      },
    })

    const noncoplanar = [
      {
        ...geometry[0],
        geometry: {
          topologyCandidates: [
            {
              ...geometry[0]?.geometry.topologyCandidates[0],
              referenceGeometry: {
                kind: "line-edge" as const,
                start: [0, 2, 0] as const,
                end: [5, 2, 0] as const,
              },
            },
          ],
        },
      },
    ] as unknown as readonly FeatureGeometryRecord[]
    await expect(prepare({ document, feature, geometry: noncoplanar })).resolves.toMatchObject({
      ok: false,
      diagnostic: { values: { reason: "revolve-axis-model-edge-noncoplanar" } },
    })
  })

  it.each([
    ["wrong entity type", "unavailable", "revolve-axis-line-unavailable"],
    ["missing solved endpoint", "unsolved", "revolve-axis-line-unsolved"],
    ["coincident solved endpoints", "degenerate", "revolve-axis-line-degenerate"],
  ] as const)("fails closed for a %s selected axis", async (_label, variant, reason) => {
    const source = constructionAxisFixture()
    const wrongTypeEntity = source.sketch.entities.find(({ type }) => type === "point")
    if (!wrongTypeEntity) throw new Error("Expected a point entity.")
    const entityId = variant === "unavailable" ? wrongTypeEntity.id : source.axisEntityId
    const feature = featureRecordSchema.parse({
      ...source.feature,
      id: "0195b5ac-b220-7a2c-8c33-000000003423",
      type: revolveFeatureType.type,
      parameters: {
        profile: source.feature.parameters.profile,
        axis: { kind: "sketch-line", sketchId: source.sketch.id, entityId },
        angle: createAngleQuantity(180, "deg"),
        operation: "new",
      },
    })
    const start = source.solution.points.find(
      ({ entityId: pointEntityId }) => pointEntityId === source.startPointId,
    )
    if (!start) throw new Error("Expected the solved construction-axis start point.")
    const points =
      variant === "unsolved"
        ? source.solution.points.filter(({ entityId }) => entityId !== source.endPointId)
        : variant === "degenerate"
          ? source.solution.points.map((point) =>
              point.entityId === source.endPointId ? { ...point, x: start.x, y: start.y } : point,
            )
          : source.solution.points
    const prepare = createDocumentFeatureContentPreparer(() => ({
      ok: true,
      solution: { ...source.solution, points },
    }))

    await expect(prepare({ document: source.document, feature })).resolves.toMatchObject({
      ok: false,
      diagnostic: { values: { reason } },
    })
  })

  it.each(["add", "remove", "intersect"] as const)(
    "preserves the %s revolve operation in prepared geometry content",
    async (operation) => {
      const source = fixture()
      const feature = featureRecordSchema.parse({
        ...source.feature,
        id: "0195b5ac-b220-7a2c-8c33-000000003319",
        type: revolveFeatureType.type,
        parameters: {
          profile: source.feature.parameters.profile,
          axis: { kind: "origin-axis", axis: "y" },
          angle: createAngleQuantity(180, "deg"),
          operation,
        },
        dependencies: [source.feature.id],
      })
      const document = documentSnapshotSchema.parse({
        ...source.document,
        features: [source.feature, feature],
      })
      const prepare = createDocumentFeatureContentPreparer(() => ({
        ok: true,
        solution: source.solution,
      }))

      await expect(prepare({ document, feature })).resolves.toMatchObject({
        ok: true,
        parameters: { operation },
      })
    },
  )

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
            expect.objectContaining({
              entityId: "0195b5ac-b220-7a2c-8c33-000000003415",
              type: "elliptical-arc",
              startPointId: "0195b5ac-b220-7a2c-8c33-000000003412",
              endPointId: "0195b5ac-b220-7a2c-8c33-000000003414",
              center: [0, 0],
              primaryAxisPoint: [10, 0],
              secondaryAxisPoint: [0, 5],
              start: expect.any(Array),
              end: expect.any(Array),
            }),
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
