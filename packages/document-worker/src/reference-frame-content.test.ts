import { describe, expect, it } from "bun:test"
import type { FeatureGeometryRecord } from "@vibeshape/application/feature-rebuild"
import {
  createLengthQuantity,
  datumPlaneFeatureType,
  documentSnapshotSchema,
  featureRecordSchema,
} from "@vibeshape/domain"
import { mirrorFeatureTypeV2, mirrorFeatureTypeV3 } from "@vibeshape/domain/part-design-mirror"
import {
  prepareReferenceFrameFeatureContent,
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
