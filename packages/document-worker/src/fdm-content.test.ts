import { describe, expect, it } from "bun:test"
import {
  boxFeatureType,
  createLengthQuantity,
  documentSnapshotSchema,
  featureRecordSchema,
  type SketchRecord,
  sketchRecordSchema,
} from "@vibeshape/domain"
import { fdmFeatureType } from "@vibeshape/domain/part-design-fdm"
import {
  detectSketchProfiles,
  SKETCH_SOLVER_BUILD,
  type SolveSketchRecordResult,
} from "@vibeshape/sketch-solver"
import { vi } from "../../../tests/unit/support/bun-test"
import { createDocumentFeatureContentPreparer } from "./extrusion-content"

const sourceId = "0195b5ac-b220-7a2c-8c33-67a36a7f3101"
const sketchId = "0195b5ac-b220-7a2c-8c33-67a36a7f3201"
const first = "0195b5ac-b220-7a2c-8c33-67a36a7f3211"
const last = "0195b5ac-b220-7a2c-8c33-67a36a7f3212"
const lineId = "0195b5ac-b220-7a2c-8c33-67a36a7f3213"
function fixture(
  overrides: Record<string, unknown> = {},
  transformSketch: (sketch: SketchRecord) => SketchRecord = (sketch) => sketch,
) {
  const sketch = transformSketch(
    sketchRecordSchema.parse({
      schemaVersion: 0,
      id: sketchId,
      label: "Saved open FDM lines",
      plane: "xy",
      entities: [
        { schemaVersion: 0, id: first, type: "point", x: -5, y: 0, construction: false },
        { schemaVersion: 0, id: last, type: "point", x: 5, y: 0, construction: false },
        {
          schemaVersion: 0,
          id: lineId,
          type: "line",
          startPointId: first,
          endPointId: last,
          construction: false,
        },
      ],
      constraints: [],
    }),
  )
  const feature = featureRecordSchema.parse({
    schemaVersion: 0,
    id: "0195b5ac-b220-7a2c-8c33-67a36a7f3301",
    type: fdmFeatureType.type,
    parameters: {
      kind: "web",
      targetBody: { schemaVersion: 0, featureId: sourceId, outputRole: "result" },
      sketchId,
      lineIds: [lineId],
      thickness: createLengthQuantity(1.2),
      depth: createLengthQuantity(5),
      direction: "forward",
      style: "web",
      extendToWalls: false,
      ...overrides,
    },
    dependencies: [sourceId],
    references: [],
    suppressed: false,
  })
  const base = featureRecordSchema.parse({
    schemaVersion: 0,
    id: sourceId,
    type: boxFeatureType.type,
    parameters: {
      width: createLengthQuantity(20),
      depth: createLengthQuantity(20),
      height: createLengthQuantity(10),
      centered: false,
    },
    dependencies: [],
    references: [],
    suppressed: false,
  })
  const document = documentSnapshotSchema.parse({
    schemaVersion: 0,
    id: "0195b5ac-b213-7f2c-9c33-67a36a7f21ac",
    revision: 3,
    name: "FDM preparation",
    variables: [],
    sketches: [sketch],
    features: [base, feature],
    createdAt: "2026-08-09T00:00:00.000Z",
    updatedAt: "2026-08-09T00:00:00.000Z",
  })
  const points = sketch.entities.flatMap((entity) =>
    entity.type === "point" ? [{ entityId: entity.id, x: entity.id === first ? -6 : 6, y: 1 }] : [],
  )
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
  const solve = vi.fn((): SolveSketchRecordResult => ({ ok: true, solution }))
  return { feature, document, solve }
}
describe("saved FDM sketch materialization", () => {
  it.each(["web", "rib"])(
    "prepares %s from solved saved open line endpoints and reuses its solver receipt",
    async (style) => {
      const { feature, document, solve } = fixture({ style })
      const prepare = createDocumentFeatureContentPreparer(solve)
      const result = await prepare({ document, feature })
      expect(result).toMatchObject({
        ok: true,
        parameters: {
          kind: "web",
          style,
          thickness: 1.2,
          depth: 5,
          segments: [{ start: [-6, 1], end: [6, 1] }],
          frame: { normal: [0, 0, 1] },
          supportInputCount: 0,
        },
      })
      expect(await prepare({ document, feature })).toEqual(result)
      expect(solve).toHaveBeenCalledTimes(1)
    },
  )
  it.each([
    { origin: [0, 0, 8], normal: [0, 0, 1], direction: "forward" },
    { origin: [0, 0, -8], normal: [0, 0, -1], direction: "reverse" },
  ])(
    "terminates at the exact parallel authored plane in $direction direction",
    async ({ origin, normal, direction }) => {
      const { feature, document, solve } = fixture({
        stopPlane: { kind: "explicit-plane", origin, normal },
        direction,
      })
      const result = await createDocumentFeatureContentPreparer(solve)({ document, feature })
      expect(result).toMatchObject({ ok: true, parameters: { depth: 8, direction } })
    },
  )
  it("rejects missing or construction lines without replacing authored IDs", async () => {
    for (const mutate of [
      (sketch: SketchRecord) => ({
        ...sketch,
        entities: sketch.entities.filter(({ id }) => id !== lineId),
      }),
      (sketch: SketchRecord) => ({
        ...sketch,
        entities: sketch.entities.map((entity) =>
          entity.id === lineId ? { ...entity, construction: true } : entity,
        ),
      }),
    ]) {
      const { feature, document, solve } = fixture({}, mutate)
      const before = JSON.stringify(document)
      expect(
        await createDocumentFeatureContentPreparer(solve)({ document, feature }),
      ).toMatchObject({ ok: false, diagnostic: { code: "org.vibeshape.feature.fdm-invalid" } })
      expect(JSON.stringify(document)).toBe(before)
    }
  })
  it.each([
    { origin: [0, 0, 8], normal: [1, 0, 0] },
    { origin: [0, 0, -8], normal: [0, 0, 1] },
  ])("rejects a nonparallel or unreachable stop plane", async (stopPlane) => {
    const { feature, document, solve } = fixture({
      stopPlane: { kind: "explicit-plane", ...stopPlane },
    })
    expect(await createDocumentFeatureContentPreparer(solve)({ document, feature })).toMatchObject({
      ok: false,
      diagnostic: { code: "org.vibeshape.feature.fdm-invalid" },
    })
  })
  it("fails explicitly when the solver is unavailable", async () => {
    const { feature, document } = fixture()
    expect(await createDocumentFeatureContentPreparer(null)({ document, feature })).toMatchObject({
      ok: false,
      diagnostic: { code: "org.vibeshape.feature.sketch-solver-unavailable" },
    })
  })
})

it("rejects another face reference from the same sketch support producer", async () => {
  const reference = {
    schemaVersion: 0,
    featureId: sourceId,
    kind: "face",
    semanticRole: "face.top",
    signature: {
      kind: "face",
      geometryClass: "PLANE",
      measure: 400,
      centroid: [0, 0, 10],
      bounds: { min: [-10, -10, 10], max: [10, 10, 10] },
      direction: [0, 0, 1],
      directionMode: "oriented",
      boundaryCount: 4,
      adjacentGeometryClasses: ["PLANE"],
    },
  }
  const { feature, document, solve } = fixture({}, (sketch) =>
    sketchRecordSchema.parse({ ...sketch, support: { kind: "feature-face", reference } }),
  )
  const mismatched = featureRecordSchema.parse({
    ...feature,
    references: [{ ...reference, semanticRole: "face.bottom" }],
  })
  expect(
    await createDocumentFeatureContentPreparer(solve)({
      document: {
        ...document,
        features: document.features.map((item) => (item.id === feature.id ? mismatched : item)),
      },
      feature: mismatched,
    }),
  ).toMatchObject({ ok: false, diagnostic: { code: "org.vibeshape.feature.fdm-invalid" } })
  expect(solve).not.toHaveBeenCalled()
})
