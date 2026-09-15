import {
  boxFeatureType,
  createLengthQuantity,
  documentSnapshotSchema,
  featureRecordSchema,
  holeFeatureType,
  holeFeatureTypeV2,
  sketchEntityIdSchema,
  sketchRecordSchema,
} from "@vibeshape/domain"
import {
  detectSketchProfiles,
  SKETCH_SOLVER_BUILD,
  type SolveSketchRecordResult,
} from "@vibeshape/sketch-solver"
import { describe, expect, it, vi } from "vitest"
import {
  createDocumentFeatureContentPreparer,
  shouldPrepareDocumentFeatureContent,
} from "./extrusion-content"

function fixture(offset = 0) {
  const id = (index: number) =>
    `0195b5ac-b220-7a2c-8c33-${String(8000 + offset + index).padStart(12, "0")}`
  const pointA = sketchEntityIdSchema.parse(id(1))
  const pointB = sketchEntityIdSchema.parse(id(2))
  const sketch = sketchRecordSchema.parse({
    schemaVersion: 0,
    id: id(3),
    label: "Hole centers",
    plane: "xz",
    entities: [
      { schemaVersion: 0, id: pointA, type: "point", x: 90, y: 80, construction: true },
      { schemaVersion: 0, id: pointB, type: "point", x: 70, y: 60, construction: false },
    ],
    constraints: [],
  })
  const target = featureRecordSchema.parse({
    schemaVersion: 0,
    id: id(4),
    type: boxFeatureType.type,
    parameters: {
      width: createLengthQuantity(60),
      depth: createLengthQuantity(40),
      height: createLengthQuantity(20),
      centered: false,
    },
    dependencies: [],
    references: [],
    suppressed: false,
  })
  const feature = featureRecordSchema.parse({
    schemaVersion: 0,
    id: id(5),
    type: holeFeatureType.type,
    parameters: {
      sketchId: sketch.id,
      pointIds: [pointA, pointB],
      diameter: createLengthQuantity(10),
      direction: "reverse",
      extent: "blind",
      depth: createLengthQuantity(12),
    },
    dependencies: [target.id],
    references: [],
    suppressed: false,
  })
  const document = documentSnapshotSchema.parse({
    schemaVersion: 0,
    id: id(6),
    revision: 3,
    name: "Hole preparation",
    variables: [],
    sketches: [sketch],
    features: [target, feature],
    createdAt: "2026-09-07T00:00:00.000Z",
    updatedAt: "2026-09-07T00:00:00.000Z",
  })
  const points = [
    { entityId: pointA, x: 20, y: 10 },
    { entityId: pointB, x: 10, y: 5 },
  ]
  const solution = {
    schemaVersion: 0,
    sketchId: sketch.id,
    sourceRevision: document.revision,
    status: "under-constrained",
    degreesOfFreedom: 4,
    maximumResidual: 0,
    points,
    circles: [],
    failedConstraintIds: [],
    profileResult: detectSketchProfiles(sketch, { points, circles: [] }),
    heapCapacityBytes: 1024,
    solverBuild: SKETCH_SOLVER_BUILD,
  } as const
  return { document, feature, target, sketch, solution, pointA, pointB }
}

describe("Hole sketch content preparation", () => {
  it("uses solved points in the support frame and shares one solve across holes", async () => {
    const { document, feature, solution, target } = fixture()
    const solve = vi.fn((): SolveSketchRecordResult => ({ ok: true, solution }))
    const prepare = createDocumentFeatureContentPreparer(solve)
    const expected = {
      ok: true,
      parameters: {
        frame: { origin: [0, 0, 0], xAxis: [1, 0, 0], yAxis: [0, 0, 1], normal: [0, -1, 0] },
        centers: [
          [10, 0, 5],
          [20, 0, 10],
        ],
        diameter: 10,
        direction: "reverse",
        extent: "blind",
        depth: 12,
      },
    }
    expect(shouldPrepareDocumentFeatureContent(feature)).toBe(true)
    expect(await prepare({ document, feature })).toEqual(expected)
    expect(await prepare({ document, feature: { ...feature, id: target.id } })).toEqual(expected)
    expect(solve).toHaveBeenCalledTimes(1)
  })

  it("prepares versioned body-targeted holes without leaking authored selectors into geometry parameters", async () => {
    const source = fixture()
    const feature = featureRecordSchema.parse({
      ...source.feature,
      type: holeFeatureTypeV2.type,
      parameters: {
        ...source.feature.parameters,
        targetBody: {
          schemaVersion: 0,
          featureId: source.target.id,
          outputRole: "pattern.instance.1",
        },
      },
    })
    const prepare = createDocumentFeatureContentPreparer(() => ({
      ok: true,
      solution: source.solution,
    }))
    expect(shouldPrepareDocumentFeatureContent(feature)).toBe(true)
    const result = await prepare({ document: source.document, feature })
    expect(result).toEqual(await prepare({ document: source.document, feature: source.feature }))
    expect(result?.ok && result.parameters).not.toHaveProperty("targetBody")
  })

  it("produces identical geometry parameters when authored identities change", async () => {
    const prepareFixture = async (offset: number) => {
      const { document, feature, solution } = fixture(offset)
      return createDocumentFeatureContentPreparer(() => ({ ok: true, solution }))({
        document,
        feature,
      })
    }
    expect(await prepareFixture(100)).toEqual(await prepareFixture(0))
  })

  it("omits blind depth for a directional through-all cut", async () => {
    const source = fixture()
    const { depth: _, ...parameters } = source.feature.parameters
    const feature = featureRecordSchema.parse({
      ...source.feature,
      parameters: { ...parameters, extent: "through-all" },
    })
    const result = await createDocumentFeatureContentPreparer(() => ({
      ok: true,
      solution: source.solution,
    }))({ document: source.document, feature })
    expect(result).toMatchObject({
      ok: true,
      parameters: { extent: "through-all", direction: "reverse" },
    })
    if (!result?.ok) throw new Error("Expected prepared Hole content.")
    expect(result.parameters).not.toHaveProperty("depth")
    expect(result.parameters).not.toHaveProperty("sketchId")
    expect(result.parameters).not.toHaveProperty("pointIds")
  })

  it("preserves positive dimensions below a micron for kernel evaluation", async () => {
    const source = fixture()
    const feature = featureRecordSchema.parse({
      ...source.feature,
      parameters: {
        ...source.feature.parameters,
        diameter: createLengthQuantity(0.0001),
        depth: createLengthQuantity(0.0001),
      },
    })
    const prepare = createDocumentFeatureContentPreparer(() => ({
      ok: true,
      solution: source.solution,
    }))
    expect(await prepare({ document: source.document, feature })).toMatchObject({
      ok: true,
      parameters: { diameter: 0.0001, depth: 0.0001 },
    })
  })

  it("reports missing sketch and unavailable solving explicitly", async () => {
    const { document, feature } = fixture()
    const prepare = createDocumentFeatureContentPreparer(null)
    expect(await prepare({ document: { ...document, sketches: [] }, feature })).toMatchObject({
      ok: false,
      diagnostic: { code: "org.vibeshape.feature.sketch-missing" },
    })
    expect(await prepare({ document, feature })).toMatchObject({
      ok: false,
      diagnostic: { code: "org.vibeshape.feature.sketch-solver-unavailable" },
    })
  })

  it("fails before solving when a selected point is deleted or becomes a circle", async () => {
    const source = fixture()
    const solve = vi.fn((): SolveSketchRecordResult => ({ ok: true, solution: source.solution }))
    const prepare = createDocumentFeatureContentPreparer(solve)
    for (const entities of [
      source.sketch.entities.slice(1),
      [
        ...source.sketch.entities.slice(1),
        {
          schemaVersion: 0,
          id: source.pointA,
          type: "circle",
          centerPointId: source.pointB,
          radius: 4,
          construction: true,
        },
      ],
    ]) {
      const sketch = sketchRecordSchema.parse({ ...source.sketch, entities })
      expect(
        await prepare({
          document: { ...source.document, sketches: [sketch] },
          feature: source.feature,
        }),
      ).toMatchObject({
        ok: false,
        diagnostic: { code: "org.vibeshape.feature.hole-point-missing" },
      })
    }
    expect(solve).not.toHaveBeenCalled()
  })

  it("rejects stale, mismatched, or failed solver solutions", async () => {
    const source = fixture()
    for (const solution of [
      { ...source.solution, sourceRevision: 2 },
      { ...source.solution, sketchId: fixture(100).sketch.id },
      { ...source.solution, status: "failed" as const },
    ]) {
      const prepare = createDocumentFeatureContentPreparer(() => ({ ok: true, solution }))
      expect(await prepare(source)).toMatchObject({
        ok: false,
        diagnostic: { code: "org.vibeshape.feature.sketch-solve-failed" },
      })
    }
  })

  it("rejects missing, coincident, and non-finite solved centers", async () => {
    const source = fixture()
    for (const points of [
      source.solution.points.slice(1),
      source.solution.points.map((point) => ({ ...point, x: 10, y: 5 })),
      source.solution.points.map((point) => ({ ...point, x: Number.NaN })),
    ]) {
      const prepare = createDocumentFeatureContentPreparer(() => ({
        ok: true,
        solution: { ...source.solution, points },
      }))
      expect(await prepare(source)).toMatchObject({ ok: false })
    }
  })

  it("resolves support slots without embedding source identities in geometry content", async () => {
    const source = fixture()
    for (const distinct of [false, true]) {
      const support = distinct ? fixture(100).target : source.target
      const reference = {
        schemaVersion: 0,
        featureId: support.id,
        kind: "face",
        semanticRole: "primitive.box.cap.end",
        signature: {
          kind: "face",
          geometryClass: "PLANE",
          measure: 2400,
          centroid: [0, 0, 20],
          bounds: { min: [-30, -20, 20], max: [30, 20, 20] },
          direction: [0, 0, 1],
          directionMode: "oriented",
          boundaryCount: 4,
          adjacentGeometryClasses: ["PLANE"],
        },
      }
      const sketch = sketchRecordSchema.parse({
        ...source.sketch,
        support: { kind: "feature-face", reference },
      })
      const feature = featureRecordSchema.parse({
        ...source.feature,
        dependencies: distinct ? [source.target.id, support.id] : [source.target.id],
        references: [reference],
      })
      const document = documentSnapshotSchema.parse({
        ...source.document,
        sketches: [sketch],
        features: distinct ? [source.target, support, feature] : [source.target, feature],
      })
      const prepare = createDocumentFeatureContentPreparer(() => ({
        ok: true,
        solution: source.solution,
      }))
      expect(await prepare({ document, feature })).toMatchObject({
        ok: true,
        parameters: {
          supportInputIndex: distinct ? 1 : 0,
          centers: [
            [10, 5, 20],
            [20, 10, 20],
          ],
          frame: { origin: [0, 0, 20], normal: [0, 0, 1] },
        },
      })
      expect(await prepare({ document, feature, features: [feature] })).toMatchObject({
        ok: false,
        diagnostic: { code: "org.vibeshape.feature.sketch-support-missing" },
      })
    }
  })
})
