import type { ResolvedAuthoredPart } from "@vibeshape/application/authored-parts"
import type { DocumentRebuildOutcome } from "@vibeshape/application/persistent-document-session"
import {
  boxFeatureType,
  createLengthQuantity,
  documentSnapshotSchema,
  featureRecordSchema,
} from "@vibeshape/domain"

export const catalogueHash = "a".repeat(64)
const catalogueShape = {
  valid: true,
  solidCount: 1,
  volume: 64,
  surfaceArea: 96,
  bounds: { min: [-2, -2, 0], max: [2, 2, 4] },
  faceCount: 6,
  edgeCount: 12,
}

/** Current named solids, independent producers, and one authored owner per producer. */
export function bodyCatalogueFixture(featureCount = 4, bodiesPerFeature = 3) {
  const features = Array.from({ length: featureCount }, (_, index) =>
    featureRecordSchema.parse({
      schemaVersion: 0,
      id: `0195b5ac-b220-7a2c-8c33-${(index + 1).toString(16).padStart(12, "0")}`,
      type: boxFeatureType.type,
      parameters: {
        width: createLengthQuantity(4),
        depth: createLengthQuantity(4),
        height: createLengthQuantity(4),
        centered: false,
      },
      dependencies: [],
      references: [],
      suppressed: false,
      label: `Producer ${index + 1}`,
    }),
  )
  const snapshot = documentSnapshotSchema.parse({
    schemaVersion: 0,
    id: "0195b5ac-b220-7a2c-8c33-000000ffffff",
    revision: 7,
    name: "Body catalogue",
    createdAt: "2026-10-25T00:00:00Z",
    updatedAt: "2026-10-25T00:00:00Z",
    features,
  })
  const geometry = features.map((feature) => ({
    featureId: feature.id,
    contentHash: catalogueHash,
    geometry: {
      shape: {
        ...catalogueShape,
        solidCount: bodiesPerFeature,
        volume: bodiesPerFeature * catalogueShape.volume,
      },
      bodies: Array.from({ length: bodiesPerFeature }, (_, body) => ({
        outputRole: `pattern.instance.${body}`,
        shape: catalogueShape,
        representation: "exact-solid" as const,
      })),
    },
  }))
  // The collector consumes shape/body evidence, not mesh, engine, or request envelope fields.
  const rebuild = {
    ok: true,
    response: {
      evaluation: {
        records: features.map(({ id }) => ({
          featureId: id,
          status: "succeeded",
          contentHash: catalogueHash,
        })),
        dirtyFeatureIds: [],
        evaluatedFeatureIds: features.map(({ id }) => id),
        reusedFeatureIds: [],
      },
      geometry,
    },
  } as unknown as Extract<DocumentRebuildOutcome, { ok: true }>
  const parts = features.map((feature, index) => ({
    part: {
      id: feature.id,
      name: `Part ${index + 1}`,
      bodyHistory: geometry[index]?.geometry.bodies.map(({ outputRole }) => ({
        schemaVersion: 0,
        featureId: feature.id,
        outputRole,
      })),
    },
    body: null,
    status: "unavailable",
  })) as unknown as readonly ResolvedAuthoredPart[]
  return { snapshot, rebuild, parts }
}
