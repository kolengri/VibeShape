import {
  documentIdSchema,
  documentSnapshotSchema,
  featureIdSchema,
  featureRecordSchema,
} from "@vibeshape/domain"
import { describe, expect, it } from "vitest"
import {
  createExtrusionPreviewDocument,
  createExtrusionPreviewMeshes,
} from "./use-extrusion-preview"

const documentId = documentIdSchema.parse("0195b5ac-b213-7f2c-9c33-67a36a7f2101")
const previewDocumentId = documentIdSchema.parse("0195b5ac-b213-7f2c-9c33-67a36a7f2102")
const baseId = featureIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f3101")
const independentId = featureIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f3102")
const candidateId = featureIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f3103")

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

describe("extrusion preview composition", () => {
  it("creates a disposable document without mutating the committed snapshot", () => {
    const candidate = feature(candidateId, [baseId])
    const preview = createExtrusionPreviewDocument(snapshot, candidate, previewDocumentId)

    expect(preview.id).toBe(previewDocumentId)
    expect(preview.features.map(({ id }) => id)).toEqual([baseId, independentId, candidateId])
    expect(snapshot.id).toBe(documentId)
    expect(snapshot.features.map(({ id }) => id)).toEqual([baseId, independentId])
  })

  it("replaces an edited feature identity instead of appending a duplicate", () => {
    const edited = feature(baseId)
    const preview = createExtrusionPreviewDocument(snapshot, edited, previewDocumentId)

    expect(preview.features).toHaveLength(2)
    expect(preview.features[0]?.id).toBe(baseId)
  })

  it("marks only changed terminal geometry as preview", () => {
    const document = createExtrusionPreviewDocument(
      snapshot,
      feature(candidateId, [baseId]),
      previewDocumentId,
    )
    const meshes = createExtrusionPreviewMeshes(
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
})
