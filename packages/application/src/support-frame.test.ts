import {
  boxFeatureType,
  createLengthQuantity,
  cylinderFeatureType,
  datumPlaneFeatureType,
  documentSnapshotSchema,
  extrusionFeatureType,
  featureRecordSchema,
  sketchRecordSchema,
} from "@vibeshape/domain"
import { describe, expect, it } from "vitest"
import {
  datumPlaneFrame,
  projectSketchPointBetweenFrames,
  projectWorldPointToSupport,
  type SupportFrame,
  type SupportFrameGeometryRecord,
  sketchFrame,
  supportPointToWorld,
} from "./support-frame"

const documentId = "0195b5ac-b213-7f2c-9c33-67a36a7f21ac"
const sketchId = "0195b5ac-b220-7a2c-8c33-67a36a7f3201"
const boxId = "0195b5ac-b220-7a2c-8c33-000000003301"
const datumAId = "0195b5ac-b220-7a2c-8c33-000000003302"
const datumBId = "0195b5ac-b220-7a2c-8c33-000000003303"
const cylinderId = "0195b5ac-b220-7a2c-8c33-000000003304"
const extrusionId = "0195b5ac-b220-7a2c-8c33-000000003305"
const sourceSketchId = "0195b5ac-b220-7a2c-8c33-000000003306"
const profileEntityId = "0195b5ac-b220-7a2c-8c33-000000003307"

function faceReference(featureId: string, semanticRole: string) {
  return {
    schemaVersion: 0 as const,
    featureId,
    kind: "face" as const,
    semanticRole,
    signature: {
      kind: "face" as const,
      geometryClass: "PLANE" as const,
      measure: 1,
      centroid: [0, 0, 0] as const,
      bounds: { min: [0, 0, 0] as const, max: [1, 1, 1] as const },
      boundaryCount: 4,
      adjacentGeometryClasses: [],
    },
  }
}

function documentWith(sketches: readonly unknown[], features: readonly unknown[]) {
  return documentSnapshotSchema.parse({
    schemaVersion: 0,
    id: documentId,
    revision: 1,
    name: "Support frame tests",
    sketches,
    features,
    createdAt: "2026-08-20T00:00:00.000Z",
    updatedAt: "2026-08-20T00:00:00.000Z",
  })
}

function sketch(support?: unknown, id = sketchId) {
  return sketchRecordSchema.parse({
    schemaVersion: 0,
    id,
    label: "Profile",
    plane: "xy",
    ...(support ? { support } : {}),
    entities: [],
    constraints: [],
  })
}

describe("support-frame resolution", () => {
  it("projects a point from one support frame into another through world space", () => {
    const source: SupportFrame = {
      origin: [10, 20, 30],
      xAxis: [1, 0, 0],
      yAxis: [0, 0, 1],
      normal: [0, -1, 0],
    }
    const target: SupportFrame = {
      origin: [5, 0, 25],
      xAxis: [0, 1, 0],
      yAxis: [0, 0, 1],
      normal: [1, 0, 0],
    }

    expect(supportPointToWorld(source, { x: 4, y: 7 })).toEqual([14, 20, 37])
    expect(projectWorldPointToSupport(target, [14, 20, 37])).toEqual({ x: 20, y: 12 })
    expect(projectSketchPointBetweenFrames(source, target, { x: 4, y: 7 })).toEqual({
      local: { x: 20, y: 12 },
      world: [14, 20, 37],
    })
  })

  it.each([
    ["xy", [0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1]],
    ["xz", [0, 0, 0], [1, 0, 0], [0, 0, 1], [0, -1, 0]],
    ["yz", [0, 0, 0], [0, 1, 0], [0, 0, 1], [1, 0, 0]],
  ] as const)("resolves the %s origin plane", (plane, origin, xAxis, yAxis, normal) => {
    const source = sketchRecordSchema.parse({ ...sketch(), plane })
    const document = documentWith([source], [])
    expect(sketchFrame(source, document, [])).toEqual({ origin, xAxis, yAxis, normal })
  })

  it("resolves a feature face and recursively offsets a datum plane", () => {
    const box = featureRecordSchema.parse({
      schemaVersion: 0,
      id: boxId,
      type: boxFeatureType.type,
      parameters: {
        width: createLengthQuantity(10),
        depth: createLengthQuantity(8),
        height: createLengthQuantity(4),
        centered: false,
        origin: {
          x: createLengthQuantity(100),
          y: createLengthQuantity(20),
          z: createLengthQuantity(30),
        },
      },
      dependencies: [],
      references: [],
      suppressed: false,
    })
    const supportedSketch = sketch({
      kind: "feature-face",
      reference: faceReference(boxId, "primitive.box.cap.end"),
    })
    const datum = featureRecordSchema.parse({
      schemaVersion: 0,
      id: datumAId,
      type: datumPlaneFeatureType.type,
      parameters: {
        mode: "offset",
        support: { kind: "feature-face", reference: faceReference(boxId, "primitive.box.cap.end") },
        offset: createLengthQuantity(2),
      },
      dependencies: [boxId],
      references: [faceReference(boxId, "primitive.box.cap.end")],
      suppressed: false,
    })
    const document = documentWith([supportedSketch], [box, datum])

    expect(sketchFrame(supportedSketch, document, [box, datum])).toMatchObject({
      origin: [100, 20, 34],
      normal: [0, 0, 1],
    })
    expect(datumPlaneFrame(datum, document, [box, datum], new Set())).toMatchObject({
      origin: [100, 20, 36],
      normal: [0, 0, 1],
    })
  })

  it("resolves every translated primitive cap and side in world coordinates", () => {
    const box = featureRecordSchema.parse({
      schemaVersion: 0,
      id: boxId,
      type: boxFeatureType.type,
      parameters: {
        width: createLengthQuantity(10),
        depth: createLengthQuantity(8),
        height: createLengthQuantity(4),
        centered: true,
        origin: {
          x: createLengthQuantity(100),
          y: createLengthQuantity(20),
          z: createLengthQuantity(30),
        },
      },
      dependencies: [],
      references: [],
      suppressed: false,
    })
    const cylinder = featureRecordSchema.parse({
      schemaVersion: 0,
      id: cylinderId,
      type: cylinderFeatureType.type,
      parameters: {
        radius: createLengthQuantity(5),
        height: createLengthQuantity(8),
        centered: true,
        origin: {
          x: createLengthQuantity(-10),
          y: createLengthQuantity(5),
          z: createLengthQuantity(40),
        },
      },
      dependencies: [],
      references: [],
      suppressed: false,
    })
    const cases = [
      [boxId, "primitive.box.side.x-min", [95, 20, 30], [-1, 0, 0]],
      [boxId, "primitive.box.side.x-max", [105, 20, 30], [1, 0, 0]],
      [boxId, "primitive.box.side.y-min", [100, 16, 30], [0, -1, 0]],
      [boxId, "primitive.box.side.y-max", [100, 24, 30], [0, 1, 0]],
      [boxId, "primitive.box.cap.start", [100, 20, 28], [0, 0, -1]],
      [boxId, "primitive.box.cap.end", [100, 20, 32], [0, 0, 1]],
      [cylinderId, "primitive.cylinder.cap.start", [-10, 5, 36], [0, 0, -1]],
      [cylinderId, "primitive.cylinder.cap.end", [-10, 5, 44], [0, 0, 1]],
    ] as const

    for (const [featureId, role, origin, normal] of cases) {
      const supported = sketch({ kind: "feature-face", reference: faceReference(featureId, role) })
      const document = documentWith([supported], [box, cylinder])
      expect(sketchFrame(supported, document, [box, cylinder])).toMatchObject({ origin, normal })
    }
  })

  it("propagates a translated support frame through an extrusion cap", () => {
    const box = featureRecordSchema.parse({
      schemaVersion: 0,
      id: boxId,
      type: boxFeatureType.type,
      parameters: {
        width: createLengthQuantity(10),
        depth: createLengthQuantity(8),
        height: createLengthQuantity(4),
        centered: false,
        origin: {
          x: createLengthQuantity(100),
          y: createLengthQuantity(20),
          z: createLengthQuantity(30),
        },
      },
      dependencies: [],
      references: [],
      suppressed: false,
    })
    const sourceSketch = sketch(
      { kind: "feature-face", reference: faceReference(boxId, "primitive.box.cap.end") },
      sourceSketchId,
    )
    const extrusion = featureRecordSchema.parse({
      schemaVersion: 0,
      id: extrusionId,
      type: extrusionFeatureType.type,
      parameters: {
        profile: {
          schemaVersion: 0,
          sketchId: sourceSketchId,
          outerBoundaryEntityIds: [profileEntityId],
          holeBoundaryEntityIds: [],
        },
        distance: createLengthQuantity(10),
        symmetric: false,
        operation: "new",
      },
      dependencies: [boxId],
      references: [faceReference(boxId, "primitive.box.cap.end")],
      suppressed: false,
    })
    const target = sketch({
      kind: "feature-face",
      reference: faceReference(extrusionId, "extrusion.cap.end"),
    })
    const document = documentWith([sourceSketch, target], [box, extrusion])

    expect(sketchFrame(target, document, [box, extrusion])).toMatchObject({
      origin: [100, 20, 44],
      normal: [0, 0, 1],
    })
  })

  it("fails closed for missing and cyclic support", () => {
    const missingSketch = sketch({
      kind: "feature-face",
      reference: faceReference(boxId, "primitive.box.cap.end"),
    })
    const missingDocument = documentWith([], [])
    expect(sketchFrame(missingSketch, missingDocument, [])).toBeNull()

    const datumA = featureRecordSchema.parse({
      schemaVersion: 0,
      id: datumAId,
      type: datumPlaneFeatureType.type,
      parameters: {
        mode: "offset",
        support: { kind: "feature-face", reference: faceReference(datumBId, "datum.plane") },
        offset: createLengthQuantity(1),
      },
      dependencies: [datumBId],
      references: [faceReference(datumBId, "datum.plane")],
      suppressed: false,
    })
    const datumB = featureRecordSchema.parse({
      schemaVersion: 0,
      id: datumBId,
      type: datumPlaneFeatureType.type,
      parameters: {
        mode: "offset",
        support: { kind: "feature-face", reference: faceReference(datumAId, "datum.plane") },
        offset: createLengthQuantity(1),
      },
      dependencies: [datumAId],
      references: [faceReference(datumAId, "datum.plane")],
      suppressed: false,
    })
    const cyclicSketch = sketch({
      kind: "feature-face",
      reference: faceReference(datumAId, "datum.plane"),
    })
    const cyclicDocument = documentWith([], [])
    expect(sketchFrame(cyclicSketch, cyclicDocument, [datumA, datumB])).toBeNull()
  })

  it("resolves extrusion side supports from current planar geometry and follows movement", () => {
    const feature = featureRecordSchema.parse({
      schemaVersion: 0,
      id: extrusionId,
      type: extrusionFeatureType.type,
      parameters: {
        profile: {
          schemaVersion: 0,
          sketchId: sourceSketchId,
          outerBoundaryEntityIds: [profileEntityId],
          holeBoundaryEntityIds: [],
        },
        distance: createLengthQuantity(10),
        symmetric: false,
        operation: "new",
      },
      dependencies: [],
      references: [],
      suppressed: false,
    })
    const role = `extrusion.side.${profileEntityId}`
    const supported = sketch({ kind: "feature-face", reference: faceReference(extrusionId, role) })
    const document = documentWith([supported], [feature])
    const current = (centroid: [number, number, number], direction: [number, number, number]) =>
      ({
        featureId: extrusionId,
        geometry: {
          topologyCandidates: [
            {
              candidateId: "face-current",
              kind: "face",
              semanticRole: role,
              lineageTokens: [],
              signature: {
                kind: "face",
                geometryClass: "PLANE",
                measure: 12,
                centroid,
                bounds: { min: centroid, max: centroid },
                direction,
                directionMode: "oriented",
                boundaryCount: 4,
                adjacentGeometryClasses: [],
              },
            },
          ],
        },
      }) satisfies SupportFrameGeometryRecord

    const frame = sketchFrame(supported, document, [feature], new Set(), [
      current([3, 4, 5], [0, 1, 0]),
    ])
    expect(frame).toMatchObject({
      origin: [0, 4, 0],
      normal: [0, 1, 0],
    })
    expect(frame).not.toBeNull()
    if (frame) {
      const cross = [
        frame.xAxis[1] * frame.yAxis[2] - frame.xAxis[2] * frame.yAxis[1],
        frame.xAxis[2] * frame.yAxis[0] - frame.xAxis[0] * frame.yAxis[2],
        frame.xAxis[0] * frame.yAxis[1] - frame.xAxis[1] * frame.yAxis[0],
      ]
      for (let axis = 0; axis < 3; axis += 1) {
        expect(cross[axis]).toBeCloseTo(frame.normal[axis] as number)
      }
    }
    expect(
      sketchFrame(supported, document, [feature], new Set(), [current([8, 4, 5], [0, 1, 0])]),
    ).toMatchObject({
      origin: [0, 4, 0],
    })
    expect(
      sketchFrame(supported, document, [feature], new Set(), [current([8, 7, 5], [0, 1, 0])]),
    ).toMatchObject({
      origin: [0, 7, 0],
    })
    const ambiguous = current([3, 4, 5], [0, 1, 0])
    ;(ambiguous.geometry.topologyCandidates as unknown[]).push({
      ...ambiguous.geometry.topologyCandidates[0],
      candidateId: "face-other",
    })
    expect(sketchFrame(supported, document, [feature], new Set(), [ambiguous])).toBeNull()
    expect(sketchFrame(supported, document, [feature], new Set(), [])).toBeNull()
  })
})
