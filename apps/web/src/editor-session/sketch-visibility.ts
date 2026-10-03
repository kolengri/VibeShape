import {
  type DocumentSnapshot,
  readExtrusionProfileSet,
  type SketchId,
  sketchIdSchema,
} from "@vibeshape/domain"
import { z } from "zod"

type VisibilityReport = Readonly<{
  snapshot: Pick<DocumentSnapshot, "id" | "revision" | "features" | "sketches">
  rebuild:
    | { ok: false }
    | {
        ok: true
        response: {
          documentId: string
          revision: number
          evaluation: {
            records: readonly {
              featureId: string
              status: "succeeded" | "failed" | "blocked" | "suppressed"
            }[]
          }
        }
      }
}>

export type SketchVisibilityOverrides = Readonly<Record<string, boolean>>
const MAX_OVERRIDES = 10000
const visibilitySchema = z
  .record(sketchIdSchema, z.boolean())
  .refine((value) => Object.keys(value).length <= MAX_OVERRIDES)
const storageKey = (documentId: string) => `vibeshape.sketch-visibility.v1.${documentId}`
type VisibilityStorage = Pick<Storage, "getItem" | "setItem">

export function loadSketchVisibility(
  storage: VisibilityStorage | null,
  documentId: string,
): SketchVisibilityOverrides {
  try {
    const raw = storage?.getItem(storageKey(documentId))
    if (!raw || raw.length > 500000) return {}
    const parsed = visibilitySchema.safeParse(JSON.parse(raw))
    return parsed.success ? parsed.data : {}
  } catch {
    return {}
  }
}

export function saveSketchVisibility(
  storage: VisibilityStorage | null,
  documentId: string,
  overrides: SketchVisibilityOverrides,
) {
  const parsed = visibilitySchema.safeParse(overrides)
  if (!parsed.success) return
  try {
    storage?.setItem(storageKey(documentId), JSON.stringify(parsed.data))
  } catch {
    /* Visibility remains usable when browser storage is unavailable. */
  }
}

/** Auto visibility is derived from the current committed evaluation, never a sticky side effect. */
export function effectiveHiddenSketchIds(
  report: VisibilityReport | null,
  overrides: SketchVisibilityOverrides,
  autoHideConsumedSketches: boolean,
  editingSketchId: SketchId | null,
): readonly SketchId[] {
  if (!report) return []
  const { snapshot, rebuild } = report
  const consumed = new Set<SketchId>()
  if (
    autoHideConsumedSketches &&
    rebuild.ok &&
    rebuild.response.documentId === snapshot.id &&
    rebuild.response.revision === snapshot.revision
  ) {
    const succeeded = new Set(
      rebuild.response.evaluation.records
        .filter((record) => record.status === "succeeded")
        .map(({ featureId }) => featureId),
    )
    for (const feature of snapshot.features) {
      if (feature.suppressed || !succeeded.has(feature.id)) continue
      const profiles = readExtrusionProfileSet(feature)
      for (const profile of profiles?.profiles ?? []) consumed.add(profile.sketchId)
    }
  }
  return snapshot.sketches
    .filter(
      ({ id }) =>
        id !== editingSketchId && (overrides[id] === undefined ? consumed.has(id) : !overrides[id]),
    )
    .map(({ id }) => id)
}
