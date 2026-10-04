import type { DocumentRebuildOutcome } from "@vibeshape/application/persistent-document-session"
import type { DocumentSnapshot, FeatureRecord } from "@vibeshape/domain"
import { exactSolidBodyOptions } from "./exact-body-options"

/** Exercises the production collector with current per-body and aggregate cache evidence. */
export function currentBodyOptions(
  features: readonly FeatureRecord[],
  edited: FeatureRecord,
  roles: readonly string[],
) {
  const contentHash = "a".repeat(64)
  const shape = {
    valid: true,
    solidCount: 1,
    volume: 64,
    surfaceArea: 96,
    bounds: { min: [-2, -2, 0], max: [2, 2, 4] },
  }
  const outcome = {
    ok: true,
    response: {
      evaluation: {
        records: features.map(({ id }) => ({
          featureId: id,
          status: "succeeded",
          contentHash,
        })),
      },
      geometry: features.map(({ id }) => ({
        featureId: id,
        contentHash,
        geometry: {
          shape: { ...shape, solidCount: roles.length, volume: roles.length * shape.volume },
          bodies: roles.map((outputRole) => ({ outputRole, shape })),
        },
      })),
    },
  } as unknown as Extract<DocumentRebuildOutcome, { ok: true }>
  return exactSolidBodyOptions(
    { features } as DocumentSnapshot,
    outcome,
    edited.id,
    [],
    "Body",
    (name) => `${name} · all bodies (legacy scope)`,
  )
}
