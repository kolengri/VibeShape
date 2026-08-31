import {
  boxFeatureType,
  createLengthQuantity,
  datumPlaneFeatureType,
  documentIdSchema,
  documentSnapshotSchema,
  featureIdSchema,
  featureRecordSchema,
} from "@vibeshape/domain"
import { describe, expect, it } from "vitest"
import {
  createFeaturePreviewDocument,
  createFeaturePreviewMeshes,
  featurePreviewKind,
} from "./use-feature-preview"

const documentId = documentIdSchema.parse("0195b5ac-b213-7f2c-9c33-67a36a7f2101")
const previewDocumentId = documentIdSchema.parse("0195b5ac-b213-7f2c-9c33-67a36a7f2102")
const baseId = featureIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f3101")
const independentId = featureIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f3102")
const candidateId = featureIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f3103")
const datumId = featureIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f3104")

function feature(id: typeof baseId, dependencies: readonly (typeof baseId)[] = []) {
  return featureRecordSchema.parse({
    schemaVersion: 0,
    id,
    type: {
      moduleId: "org.vibeshape.core.part-design",
      moduleVersion: "0.1.0",
      typeId: "org.vibeshape.feature.part-design.box",
      schemaVersion: 1,
    },
    parameters: {},
    dependencies,
    references: [],
    suppressed: false,
  })
}

const snapshot = documentSnapshotSchema.parse({
  schemaVersion: 0,
  id: documentId,
  revision: 4,
  name: "Preview test",
  displayUnits: { length: "mm", angle: "deg" },
  variables: [],
  sketches: [],
  features: [feature(baseId), feature(independentId)],
  createdAt: "2026-08-16T00:00:00.000Z",
  updatedAt: "2026-08-16T00:00:00.000Z",
})

const mesh = {
  positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
  normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
  indices: new Uint32Array([0, 1, 2]),
  triangleFaceIds: new Uint32Array([1]),
}

describe("feature preview composition", () => {
  it("classifies structurally parsed primitive feature types as primitive previews", () => {
    const candidate = featureRecordSchema.parse({
      schemaVersion: 0,
      id: candidateId,
      type: { ...boxFeatureType.type },
      parameters: {
        width: createLengthQuantity(20),
        depth: createLengthQuantity(20),
        height: createLengthQuantity(20),
        centered: false,
        origin: {
          x: createLengthQuantity(0),
          y: createLengthQuantity(0),
          z: createLengthQuantity(0),
        },
      },
      dependencies: [],
      references: [],
      suppressed: false,
    })

    expect(featurePreviewKind(candidate)).toBe("primitive")
  })

  it("creates a disposable document without mutating the committed snapshot", () => {
    const candidate = feature(candidateId, [baseId])
    const preview = createFeaturePreviewDocument(snapshot, candidate, previewDocumentId)

    expect(preview.id).toBe(previewDocumentId)
    expect(preview.features.map(({ id }) => id)).toEqual([baseId, independentId, candidateId])
    expect(snapshot.id).toBe(documentId)
    expect(snapshot.features.map(({ id }) => id)).toEqual([baseId, independentId])
  })

  it("replaces an edited feature identity instead of appending a duplicate", () => {
    const edited = feature(baseId)
    const preview = createFeaturePreviewDocument(snapshot, edited, previewDocumentId)

    expect(preview.features).toHaveLength(2)
    expect(preview.features[0]?.id).toBe(baseId)
  })

  it("marks only changed terminal geometry as preview", () => {
    const document = createFeaturePreviewDocument(
      snapshot,
      feature(candidateId, [baseId]),
      previewDocumentId,
    )
    const meshes = createFeaturePreviewMeshes(
      document,
      [
        { featureId: baseId, contentHash: "base", geometry: { mesh } },
        { featureId: independentId, contentHash: "independent", geometry: { mesh } },
        { featureId: candidateId, contentHash: "candidate", geometry: { mesh } },
      ],
      [
        { featureId: baseId, contentHash: "base" },
        { featureId: independentId, contentHash: "independent" },
      ],
    )

    expect(meshes.map(({ appearance, featureId }) => ({ appearance, featureId }))).toEqual([
      { featureId: independentId, appearance: "model" },
      { featureId: candidateId, appearance: "preview" },
    ])
  })

  it("retains changed datum geometry as a selectable translucent reference preview", () => {
    const datum = featureRecordSchema.parse({
      schemaVersion: 0,
      id: datumId,
      type: datumPlaneFeatureType.type,
      parameters: {
        mode: "offset",
        support: { kind: "origin-plane", plane: "xy" },
        offset: createLengthQuantity(12),
      },
      dependencies: [],
      references: [],
      suppressed: false,
    })
    const document = createFeaturePreviewDocument(snapshot, datum, previewDocumentId)
    const meshes = createFeaturePreviewMeshes(
      document,
      [
        { featureId: baseId, contentHash: "base", geometry: { mesh } },
        { featureId: independentId, contentHash: "independent", geometry: { mesh } },
        { featureId: datumId, contentHash: "datum", geometry: { mesh } },
      ],
      [
        { featureId: baseId, contentHash: "base" },
        { featureId: independentId, contentHash: "independent" },
      ],
    )

    expect(meshes.map(({ appearance, featureId }) => ({ appearance, featureId }))).toEqual([
      { featureId: baseId, appearance: "model" },
      { featureId: independentId, appearance: "model" },
      { featureId: datumId, appearance: "datum" },
    ])
  })
})
