import { canonicalJson, type FeatureRecord } from "@vibeshape/domain"

type Mode = { kind: "create" } | { kind: "edit"; feature: FeatureRecord }

/** Untouched forms retain authored quantity sources and their original schema. */
export function featureEditPreview(
  mode: Mode,
  values: unknown,
  originalValues: unknown,
  candidate: FeatureRecord | null,
) {
  if (!candidate || mode.kind !== "edit") return candidate
  if (canonicalJson(values) !== canonicalJson(originalValues)) return candidate
  const original = mode.feature
  if (canonicalJson(candidate.dependencies) !== canonicalJson(original.dependencies))
    return candidate
  if (canonicalJson(candidate.references) !== canonicalJson(original.references)) return candidate
  // Modifying schema upgrades may introduce exact body scope and need a fresh preview.
  if (
    canonicalJson(candidate.type) !== canonicalJson(original.type) &&
    candidate.parameters.operation !== "new"
  )
    return candidate
  return original
}
