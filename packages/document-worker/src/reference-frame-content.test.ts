import { describe, expect, it } from "bun:test"
import type { FeatureGeometryRecord } from "@vibeshape/application/feature-rebuild"
import {
  createAngleQuantity,
  createLengthQuantity,
  datumPlaneFeatureType,
  documentSnapshotSchema,
  featureRecordSchema,
} from "@vibeshape/domain"
import { coilFeatureType } from "@vibeshape/domain/part-design-coil"
import { draftFeatureType } from "@vibeshape/domain/part-design-draft"
import { mirrorFeatureTypeV2, mirrorFeatureTypeV3 } from "@vibeshape/domain/part-design-mirror"
import {
  prepareReferenceFrameFeatureContent,
  prepareReferenceSupportedFeatureContent,
  shouldPrepareReferenceFrameFeatureContent,
} from "./reference-frame-content"

const sourceId = "0195b5ac-b220-7a2c-8c33-000000003301"
const supportId = "0195b5ac-b220-7a2c-8c33-000000003302"
const targetBody = { schemaVersion: 0, featureId: sourceId, outputRole: "pattern.instance.1" }
const mirror = featureRecordSchema.parse({
  schemaVersion: 0,
  id: "0195b5ac-b220-7a2c-8c33-000000003303",
  type: mirrorFeatureTypeV3.type,
  parameters: {
    targetBody,
    plane: { kind: "explicit-plane", origin: [3, 4, 5], normal: [0.6, 0.8, 0] },
    offset: createLengthQuantity(-25.4),
    preserveSource: true,
  },
  dependencies: [sourceId],
  references: [],
  suppressed: false,
})
const document = documentSnapshotSchema.parse({
  schemaVersion: 0,
  id: sourceId,
  revision: 1,
  name: "Reference content preparation",
  sketches: [],
  features: [],
  createdAt: "2026-10-04T00:00:00Z",
  updatedAt: "2026-10-04T00:00:00Z",
})
describe("versioned Mirror reference content preparation", () => {
  it("retains signed offset and copy intent in UUID-free numerical content", async () => {
    expect(await prepareReferenceFrameFeatureContent({ document, feature: mirror })).toEqual({
      ok: true,
      parameters: {
        planeOrigin: [3, 4, 5],
        planeNormal: [0.6, 0.8, 0],
        offset: -25.4,
        preserveSource: true,
      },
    })
    const legacy = {
      ...mirror,
      type: mirrorFeatureTypeV2.type,
      parameters: { ...mirror.parameters, plane: "XY" },
    }
    expect(shouldPrepareReferenceFrameFeatureContent(legacy)).toBe(false)
    expect(await prepareReferenceFrameFeatureContent({ document, feature: legacy })).toBeNull()
  })
  it("binds a distinct current Datum support by input index and fails closed when suppressed", async () => {
    const datum = featureRecordSchema.parse({
      ...mirror,
      id: supportId,
      type: datumPlaneFeatureType.type,
      parameters: {
        mode: "offset",
        support: { kind: "origin-plane", plane: "xy" },
        offset: createLengthQuantity(8),
      },
      dependencies: [],
    })
    const feature = featureRecordSchema.parse({
      ...mirror,
      parameters: { ...mirror.parameters, plane: { kind: "datum-plane", featureId: supportId } },
      dependencies: [sourceId, supportId],
    })
    const geometry = [{ featureId: datum.id }] as unknown as FeatureGeometryRecord[]
    expect(
      await prepareReferenceFrameFeatureContent({
        document,
        feature,
        features: [datum, feature],
        geometry,
      }),
    ).toEqual({
      ok: true,
      parameters: {
        planeOrigin: [0, 0, 8],
        planeNormal: [0, 0, 1],
        offset: -25.4,
        preserveSource: true,
        supportInputIndex: 1,
      },
    })
    expect(
      await prepareReferenceFrameFeatureContent({
        document,
        feature,
        features: [{ ...datum, suppressed: true }, feature],
        geometry,
      }),
    ).toMatchObject({
      ok: false,
      diagnostic: { code: "org.vibeshape.feature.reference-frame-unresolved" },
    })
  })
})

describe("Draft neutral-plane content preparation", () => {
  const signature = (direction: readonly number[], centroid: readonly number[]) => ({
    kind: "face",
    geometryClass: "PLANE",
    measure: 400,
    centroid,
    bounds: { min: [-10, -10, 0], max: [10, 10, 0] },
    boundaryCount: 4,
    adjacentGeometryClasses: ["PLANE", "PLANE", "PLANE", "PLANE"],
    direction,
    directionMode: "oriented",
  })
  const face = (direction: readonly number[], centroid: readonly number[]) => ({
    schemaVersion: 1,
    featureId: sourceId,
    outputRole: targetBody.outputRole,
    kind: "face",
    signature: signature(direction, centroid),
  })
  const side = face([1, 0, 0], [10, 0, 5])
  const draft = (neutralPlane: unknown, flip = false) =>
    featureRecordSchema.parse({
      ...mirror,
      type: draftFeatureType.type,
      parameters: {
        targetBody,
        faces: [side],
        neutralPlane,
        angle: createAngleQuantity(3, "deg"),
        flip,
      },
    })
  it("pulls along an origin-plane normal and reverses it when flipped", async () => {
    const origin = { kind: "origin-plane", plane: "XY" }
    expect(shouldPrepareReferenceFrameFeatureContent(draft(origin))).toBe(true)
    const prepared = await prepareReferenceSupportedFeatureContent({
      document,
      feature: draft(origin),
    })
    expect(prepared).toMatchObject({
      ok: true,
      parameters: { planeOrigin: [0, 0, 0], planeNormal: [0, 0, 1], pullDirection: [0, 0, 1] },
    })
    expect(JSON.stringify(prepared)).not.toContain(sourceId)
    expect(
      await prepareReferenceSupportedFeatureContent({ document, feature: draft(origin, true) }),
    ).toMatchObject({ ok: true, parameters: { pullDirection: [0, 0, -1] } })
  })
  it("pulls a planar neutral face into the body and fails closed when the face is gone", async () => {
    const base = face([0, 0, -1], [0, 0, 0])
    const geometry = [
      {
        featureId: sourceId,
        geometry: {
          bodies: [
            {
              outputRole: targetBody.outputRole,
              shape: { valid: true, solidCount: 1 },
              topologyCandidates: [
                {
                  candidateId: "face:1",
                  kind: "face",
                  lineageTokens: [],
                  signature: base.signature,
                },
                {
                  candidateId: "face:2",
                  kind: "face",
                  lineageTokens: [],
                  signature: side.signature,
                },
              ],
            },
          ],
        },
      },
    ] as unknown as FeatureGeometryRecord[]
    const feature = draft({ kind: "planar-face", reference: base })
    expect(
      await prepareReferenceSupportedFeatureContent({ document, feature, geometry }),
    ).toMatchObject({
      ok: true,
      parameters: { planeNormal: [0, 0, -1], pullDirection: [0, 0, 1], supportInputIndex: 0 },
    })
    expect(await prepareReferenceSupportedFeatureContent({ document, feature })).toMatchObject({
describe("Coil reference axis content preparation", () => {
  const coil = (overrides: Record<string, unknown>, dependencies: string[]) =>
    featureRecordSchema.parse({
      schemaVersion: 0,
      id: "0195b5ac-b220-7a2c-8c33-000000003304",
      type: coilFeatureType.type,
      parameters: {
        axis: { kind: "explicit-axis", origin: [1, 2, 3], direction: [0, 1, 0] },
        handedness: "left",
        radius: createLengthQuantity(10),
        pitch: createLengthQuantity(4),
        extent: { kind: "height", height: createLengthQuantity(10) },
        startAngle: createAngleQuantity(0.5),
        section: {
          kind: "rectangular",
          width: createLengthQuantity(2),
          height: createLengthQuantity(1),
        },
        operation: "new",
        targetBody: null,
        ...overrides,
      },
      dependencies,
      references: [],
      suppressed: false,
    })

  it("resolves the axis into UUID-free helix content with derived turns", async () => {
    expect(await prepareReferenceFrameFeatureContent({ document, feature: coil({}, []) })).toEqual(
      ok: true,
      parameters: 
          origin: [1, 2, 3],
          direction: [0, 1, 0],
          handedness: "left",
          radius: 10,
          pitch: 4,
          turns: 2.5,
          startAngle: 0.5,,
        section: kind: "rectangular", width: 2, height: 1 ,
        operation: "new",,)
  })

  it("indexes a datum-axis support after the exact target and fails closed when unresolved", async () => {
    const modifying = coil(
      {
        axis: { kind: "datum-axis", featureId: supportId, axis: "normal" },
        operation: "remove",
        targetBody,
      },
      [sourceId, supportId],
    )
    expect(shouldPrepareReferenceFrameFeatureContent(modifying)).toBe(true)
    expect(
      await prepareReferenceFrameFeatureContent({ document, feature: modifying, geometry: [] }),
    ).toMatchObject({
      ok: false,
      diagnostic: { code: "org.vibeshape.feature.reference-frame-unresolved" },
    })
  })
})
