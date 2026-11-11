import { describe, expect, it } from "bun:test"
import {
  boxFeatureType,
  createLengthQuantity,
  createScalarQuantity,
  datumPlaneFeatureType,
  documentSnapshotSchema,
  featureRecordSchema,
  type SketchRecord,
  sketchRecordSchema,
} from "@vibeshape/domain"
import { patternFeatureTypeV3 } from "@vibeshape/domain/part-design-pattern-path"
import { patternFeatureContentParametersV3Schema } from "@vibeshape/protocol"
import { detectSketchProfiles, SKETCH_SOLVER_BUILD } from "@vibeshape/sketch-solver"
import { createDocumentFeatureContentPreparer } from "./extrusion-content"
import type { SketchSolvePort } from "./runtime"

const id = (value: number) => `018f0000-0000-7000-8000-${String(value).padStart(12, "0")}`
const BOX = id(800)
const DATUM = id(801)
const PATTERN = id(900)

function solution(sketch: SketchRecord, revision = 3) {
  const points = sketch.entities.flatMap((entity) =>
    entity.type === "point" ? [{ entityId: entity.id, x: entity.x, y: entity.y }] : [],
  )
  const circles = sketch.entities.flatMap((entity) =>
    entity.type === "circle" ? [{ entityId: entity.id, radius: entity.radius }] : [],
  )
  return {
    schemaVersion: 0 as const,
    sketchId: sketch.id,
    sourceRevision: revision,
    status: "under-constrained" as const,
    degreesOfFreedom: points.length * 2,
    maximumResidual: 0,
    points,
    circles,
    failedConstraintIds: [],
    profileResult: detectSketchProfiles(sketch, { points, circles }),
    heapCapacityBytes: 1024,
    solverBuild: SKETCH_SOLVER_BUILD,
  }
}
const solve: SketchSolvePort = (input) => ({
  ok: true,
  solution: solution(sketchRecordSchema.parse(input.sketch), input.revision),
})

function point(value: number, x: number, y: number) {
  return { schemaVersion: 0, id: id(value), type: "point", x, y, construction: false }
}
function line(value: number, start: number, end: number) {
  return {
    schemaVersion: 0,
    id: id(value),
    type: "line",
    startPointId: id(start),
    endPointId: id(end),
    construction: false,
  }
}
function arc(value: number, center: number, start: number, end: number) {
  return {
    schemaVersion: 0,
    id: id(value),
    type: "arc",
    centerPointId: id(center),
    startPointId: id(start),
    endPointId: id(end),
    construction: false,
  }
}
function sketch(entities: readonly unknown[], support = false) {
  return sketchRecordSchema.parse({
    schemaVersion: 0,
    id: id(300),
    label: "Path",
    plane: "xy",
    entities,
    constraints: [],
    ...(support
      ? {
          support: {
            kind: "feature-face",
            reference: {
              schemaVersion: 0,
              kind: "face",
              featureId: DATUM,
              semanticRole: "datum.plane",
              signature: {
                kind: "face",
                geometryClass: "PLANE",
                measure: 16,
                centroid: [0, 0, 0],
                bounds: { min: [-2, -2, 0], max: [2, 2, 0] },
                boundaryCount: 1,
                adjacentGeometryClasses: [],
              },
            },
          },
        }
      : {}),
  })
}
const box = featureRecordSchema.parse({
  schemaVersion: 0,
  id: BOX,
  type: boxFeatureType.type,
  parameters: {
    width: createLengthQuantity(4),
    depth: createLengthQuantity(4),
    height: createLengthQuantity(4),
    centered: true,
  },
  dependencies: [],
  references: [],
  suppressed: false,
})
const datum = featureRecordSchema.parse({
  schemaVersion: 0,
  id: DATUM,
  type: datumPlaneFeatureType.type,
  parameters: {
    mode: "offset",
    support: { kind: "origin-plane", plane: "xy" },
    offset: createLengthQuantity(0),
  },
  dependencies: [],
  references: [],
  suppressed: false,
})

function pattern(entityIds: readonly number[], start: number, dependencies = [BOX]) {
  return featureRecordSchema.parse({
    schemaVersion: 0,
    id: PATTERN,
    type: patternFeatureTypeV3.type,
    parameters: {
      targetBody: { schemaVersion: 0, featureId: BOX, outputRole: "result" },
      kind: "path",
      count: createScalarQuantity(3),
      path: {
        schemaVersion: 0,
        sketchId: id(300),
        entityIds: entityIds.map(id).sort(),
        startPointId: id(start),
      },
      spacing: { mode: "fixed", distance: createLengthQuantity(2) },
      startOffset: createLengthQuantity(1),
      orientation: "follow",
      reverse: false,
    },
    dependencies,
    references: [],
    suppressed: false,
  })
}

async function prepare(path: SketchRecord, feature = pattern([320, 321], 310), extra = [datum]) {
  const document = documentSnapshotSchema.parse({
    schemaVersion: 0,
    id: id(999),
    revision: 3,
    name: "Path pattern preparation",
    variables: [],
    sketches: [path],
    features: [box, ...extra, feature],
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
  })
  return createDocumentFeatureContentPreparer(solve)({ document, feature })
}

// A line from (0,0) to (5,0) continues tangentially into a quarter arc centered at (5,5).
const tangentChain = [
  point(310, 0, 0),
  point(311, 5, 0),
  point(312, 5, 0),
  point(313, 10, 5),
  point(314, 5, 5),
  line(321, 311, 310),
  arc(320, 314, 312, 313),
]

describe("path Pattern content preparation", () => {
  it("materializes a directed open G1 chain with resolved numeric parameters", async () => {
    const result = await prepare(sketch(tangentChain))
    if (!result.ok) throw new Error(JSON.stringify(result.diagnostic))
    const content = patternFeatureContentParametersV3Schema.parse(result.parameters)
    expect(content).toMatchObject({
      kind: "path",
      count: 3,
      spacing: { mode: "fixed", distance: 2 },
      startOffset: 1,
      orientation: "follow",
      reverse: false,
      path: {
        sketchId: id(300),
        startPointId: id(310),
        geometry: { kind: "chain", closed: false },
      },
    })
    if (content.path.geometry.kind !== "chain") throw new Error("Expected a chain.")
    expect(content.path.geometry.segments.map(({ entityId }) => entityId)).toEqual([
      id(321),
      id(320),
    ])
    expect(content.path.geometry.segments[0]).toMatchObject({ start: [0, 0], end: [5, 0] })
  })

  it("accepts a closed G1 loop started at a shared joint", async () => {
    const loop = sketch([
      point(310, 10, 0),
      point(311, -10, 0),
      point(312, -10, 0),
      point(313, 10, 0),
      point(314, 0, 0),
      arc(320, 314, 310, 311),
      arc(321, 314, 312, 313),
    ])
    const result = await prepare(loop, pattern([320, 321], 313))
    if (!result.ok) throw new Error(JSON.stringify(result.diagnostic))
    const content = patternFeatureContentParametersV3Schema.parse(result.parameters)
    expect(content.path.geometry).toMatchObject({ kind: "chain", closed: true })
    if (content.path.geometry.kind !== "chain") throw new Error("Expected a chain.")
    // Point 313 ends arc 321, so traversal leaves the joint backwards along that arc.
    expect(content.path.geometry.segments[0]?.entityId).toBe(id(321))
  })

  it.each([
    [314, 0],
    [315, Math.PI / 2],
  ])("starts a sketch circle from point %#", async (start, angle) => {
    const circle = sketch([
      point(314, 0, 0),
      point(315, 0, 12),
      {
        schemaVersion: 0,
        id: id(320),
        type: "circle",
        centerPointId: id(314),
        radius: 12,
        construction: false,
      },
    ])
    const result = await prepare(circle, pattern([320], start))
    if (!result.ok) throw new Error(JSON.stringify(result.diagnostic))
    const content = patternFeatureContentParametersV3Schema.parse(result.parameters)
    expect(content.path.geometry).toMatchObject({
      kind: "circle",
      circle: { center: [0, 0], radius: 12 },
    })
    if (content.path.geometry.kind !== "circle") throw new Error("Expected a circle.")
    expect(content.path.geometry.startAngle).toBeCloseTo(angle, 12)
  })

  it("rejects a circle start point that is not on the circle", async () => {
    const circle = sketch([
      point(314, 0, 0),
      point(315, 3, 3),
      {
        schemaVersion: 0,
        id: id(320),
        type: "circle",
        centerPointId: id(314),
        radius: 12,
        construction: false,
      },
    ])
    expect(await prepare(circle, pattern([320], 315))).toMatchObject({
      ok: false,
      diagnostic: {
        code: "org.vibeshape.feature.pattern-path-invalid",
        values: { reason: "path-start-not-on-circle" },
      },
    })
  })

  it("fails closed for a corner that has no tangent frame", async () => {
    const corner = sketch([
      point(310, 0, 0),
      point(311, 5, 0),
      point(312, 5, 5),
      line(320, 310, 311),
      line(321, 311, 312),
    ])
    expect(await prepare(corner)).toMatchObject({
      ok: false,
      diagnostic: {
        code: "org.vibeshape.feature.pattern-path-invalid",
        values: {
          reason: "invalid-materialized-path",
          issue: "Pattern path joins must be G1 tangent continuous.",
        },
      },
    })
  })

  it("requires the target first and every sketch support owner after it", async () => {
    const supported = sketch(tangentChain, true)
    expect(await prepare(supported)).toMatchObject({
      ok: false,
      diagnostic: { values: { reason: "dependency-owners-mismatch" } },
    })
    const result = await prepare(supported, pattern([320, 321], 310, [BOX, DATUM]))
    expect(result.ok).toBe(true)
    expect(await prepare(supported, pattern([320, 321], 310, [DATUM, BOX]))).toMatchObject({
      ok: false,
      diagnostic: { values: { reason: "dependency-owners-mismatch" } },
    })
  })

  it("rejects a missing path curve", async () => {
    expect(await prepare(sketch(tangentChain), pattern([320, 322], 310))).toMatchObject({
      ok: false,
      diagnostic: {
        code: "org.vibeshape.feature.pattern-path-invalid",
        values: { reason: "path-curve-unavailable" },
      },
    })
  })
})
