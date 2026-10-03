import {
  expectedSketchFeatureDependencyIds,
  expectedSketchFeatureReferences,
} from "@vibeshape/application/feature-rebuild"
import {
  type DocumentSnapshot,
  type FeatureId,
  type FeatureRecord,
  featureRecordSchema,
  type SketchEntityId,
  type SketchProfileSelector,
  type SketchRecord,
} from "@vibeshape/domain"
import {
  loftFeatureParametersSchema,
  loftFeatureType,
  MAX_LOFT_SECTIONS,
  readLoftFeatureParameters,
} from "@vibeshape/domain/part-design-loft"
import {
  readSweepFeatureParameters,
  sweepFeatureParametersSchema,
  sweepFeatureType,
} from "@vibeshape/domain/part-design-sweep"
import { sketchProfileSelectorKey } from "@vibeshape/domain/sketch-profile-selector"

export type ProfileOption = Readonly<{
  selector: SketchProfileSelector
  label: string
  key: string
}>
export type PathCurveOption = Readonly<{
  id: SketchEntityId
  label: string
  startPointId: SketchEntityId
  endPointId: SketchEntityId
}>
export type PathPointOption = Readonly<{ id: SketchEntityId; label: string }>
export type PathSketchOption = Readonly<{
  sketch: SketchRecord
  curves: readonly PathCurveOption[]
  points: readonly PathPointOption[]
}>
export type SweepLoftOperation = "sweep" | "loft"
export type SweepLoftFormMode =
  | Readonly<{
      kind: "create"
      operation: SweepLoftOperation
      createFeatureId: () => FeatureId
      featureLabel: string
    }>
  | Readonly<{ kind: "edit"; operation: SweepLoftOperation; feature: FeatureRecord }>
export type SweepLoftFormValues = {
  sections: SketchProfileSelector[]
  ruled: boolean
  profileKey: string
  pathSketchId: string
  entityIds: SketchEntityId[]
  startPointId: string
}
export function sweepLoftFormValues(mode: SweepLoftFormMode): SweepLoftFormValues {
  const loft = mode.kind === "edit" ? readLoftFeatureParameters(mode.feature) : null
  const sweep = mode.kind === "edit" ? readSweepFeatureParameters(mode.feature) : null
  return {
    sections: [...(loft?.sections ?? [])],
    ruled: loft?.ruled ?? false,
    profileKey: sweep ? sketchProfileSelectorKey(sweep.profile) : "",
    pathSketchId: sweep?.path.sketchId ?? "",
    entityIds: [...(sweep?.path.entityIds ?? [])],
    startPointId: sweep?.path.startPointId ?? "",
  }
}
export function reorderLoftSection(
  sections: readonly SketchProfileSelector[],
  index: number,
  direction: -1 | 1,
): SketchProfileSelector[] {
  const target = index + direction
  const source = sections[index]
  const destination = sections[target]
  if (!source || !destination) return [...sections]
  const result = [...sections]
  result[index] = destination
  result[target] = source
  return result
}
export function selectedPathPointIds(
  path: PathSketchOption | undefined,
  entityIds: readonly SketchEntityId[],
): ReadonlySet<string> {
  return new Set(
    path?.curves
      .filter(({ id }) => entityIds.includes(id))
      .flatMap(({ startPointId, endPointId }) => [startPointId, endPointId]) ?? [],
  )
}
function sweepParameters(
  values: SweepLoftFormValues,
  profiles: readonly ProfileOption[],
  paths: readonly PathSketchOption[],
) {
  const profile = profiles.find(({ key }) => key === values.profileKey)?.selector
  const path = paths.find(({ sketch }) => sketch.id === values.pathSketchId)
  if (
    !profile ||
    !path ||
    values.entityIds.some((id) => !path.curves.some((curve) => curve.id === id)) ||
    !selectedPathPointIds(path, values.entityIds).has(values.startPointId)
  )
    return null
  const parsed = sweepFeatureParametersSchema.safeParse({
    profile,
    path: {
      schemaVersion: 0,
      sketchId: values.pathSketchId,
      entityIds: [...values.entityIds].sort(),
      startPointId: values.startPointId,
    },
  })
  return parsed.success ? parsed.data : null
}
function loftParameters(values: SweepLoftFormValues, profiles: readonly ProfileOption[]) {
  if (
    values.sections.some(
      (selector) => !profiles.some(({ key }) => key === sketchProfileSelectorKey(selector)),
    )
  )
    return null
  const parsed = loftFeatureParametersSchema.safeParse({
    sections: values.sections,
    ruled: values.ruled,
  })
  return parsed.success ? parsed.data : null
}
export function sweepLoftFeatureRecord(
  mode: SweepLoftFormMode,
  featureId: FeatureId,
  values: SweepLoftFormValues,
  profiles: readonly ProfileOption[],
  paths: readonly PathSketchOption[],
  snapshot: DocumentSnapshot,
): FeatureRecord | null {
  const parameters =
    mode.operation === "loft"
      ? loftParameters(values, profiles)
      : sweepParameters(values, profiles, paths)
  if (!parameters) return null
  const sketchIds =
    "sections" in parameters
      ? parameters.sections.map(({ sketchId }) => sketchId)
      : [parameters.profile.sketchId, parameters.path.sketchId]
  const references = expectedSketchFeatureReferences(snapshot, sketchIds)
  const dependencies = expectedSketchFeatureDependencyIds(
    snapshot,
    sketchIds,
    references.map(({ featureId }) => featureId),
  )
  if (dependencies.length > (mode.operation === "loft" ? MAX_LOFT_SECTIONS : 8)) return null
  const type = mode.operation === "loft" ? loftFeatureType.type : sweepFeatureType.type
  const parsed = featureRecordSchema.safeParse(
    mode.kind === "edit"
      ? { ...mode.feature, type, parameters, dependencies, references }
      : {
          schemaVersion: 0,
          id: featureId,
          type,
          parameters,
          dependencies,
          references,
          suppressed: false,
          label: mode.featureLabel,
        },
  )
  return parsed.success ? parsed.data : null
}
