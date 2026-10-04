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
  loftFeatureParametersV2Schema,
  loftFeatureType,
  loftFeatureTypeV2,
  loftHoleCorrespondenceSchema,
  MAX_LOFT_SECTIONS,
  readLoftFeatureParameters,
} from "@vibeshape/domain/part-design-loft"
import {
  type LoftFeatureParametersV3,
  loftFeatureParametersV3Schema,
  loftFeatureTypeV3,
  loftV3SketchIds,
  loftV3SupportBodies,
  MAX_LOFT_V3_DEPENDENCIES,
  readLoftFeatureParametersV3,
} from "@vibeshape/domain/part-design-loft-v3"
import {
  readSweepFeatureParameters,
  sweepFeatureParametersSchema,
  sweepFeatureType,
} from "@vibeshape/domain/part-design-sweep"
import { sketchProfileSelectorKey } from "@vibeshape/domain/sketch-profile-selector"
import {
  type LoftConstraintValues,
  type LoftSupportOption,
  loftConstraintValues,
  loftSupportKey,
} from "./loft-constraint-model"

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
export type SweepLoftFormValues = LoftConstraintValues & {
  sections: SketchProfileSelector[]
  holeCorrespondence: { sectionBoundaryEntityIds: SketchEntityId[][] }[]
  ruled: boolean
  profileKey: string
  pathSketchId: string
  entityIds: SketchEntityId[]
  startPointId: string
}
export function sweepLoftFormValues(mode: SweepLoftFormMode): SweepLoftFormValues {
  const loft =
    mode.kind === "edit"
      ? (readLoftFeatureParametersV3(mode.feature) ?? readLoftFeatureParameters(mode.feature))
      : null
  const sweep = mode.kind === "edit" ? readSweepFeatureParameters(mode.feature) : null
  return {
    ...loftConstraintValues(mode),
    sections: [...(loft?.sections ?? [])],
    holeCorrespondence:
      loft && "holeCorrespondence" in loft
        ? loftHoleCorrespondenceSchema.parse(loft.holeCorrespondence)
        : [],
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
function loftParameters(
  values: SweepLoftFormValues,
  profiles: readonly ProfileOption[],
  preserveV2: boolean,
  supports: readonly LoftSupportOption[],
): NonNullable<ReturnType<typeof readLoftFeatureParameters>> | LoftFeatureParametersV3 | null {
  if (
    values.sections.some(
      (selector) => !profiles.some(({ key }) => key === sketchProfileSelectorKey(selector)),
    )
  )
    return null
  if (values.constrained) {
    if (values.ruled) return null
    if (
      [...values.start, ...values.end].some(
        ({ support }) => !support || !supports.some(({ key }) => key === loftSupportKey(support)),
      )
    )
      return null
    const parsed = loftFeatureParametersV3Schema.safeParse({
      sections: values.sections,
      ruled: false,
      outerCorrespondence: values.outerCorrespondence,
      rails: values.rails.map(({ path, ...rail }) => ({
        ...rail,
        path: { schemaVersion: 0, ...path },
      })),
      guides: values.guides.map(({ path, ...guide }) => ({
        ...guide,
        path: { schemaVersion: 0, ...path },
      })),
      start: values.start,
      end: values.end,
    })
    return parsed.success ? parsed.data : null
  }
  const withHoles = values.sections.some(
    ({ holeBoundaryEntityIds }) => holeBoundaryEntityIds.length > 0,
  )
  const parsed =
    withHoles || preserveV2
      ? loftFeatureParametersV2Schema.safeParse({
          sections: values.sections,
          ruled: values.ruled,
          holeCorrespondence: values.holeCorrespondence,
        })
      : loftFeatureParametersSchema.safeParse({ sections: values.sections, ruled: values.ruled })
  return parsed.success ? parsed.data : null
}
export function sweepLoftFeatureRecord(
  mode: SweepLoftFormMode,
  featureId: FeatureId,
  values: SweepLoftFormValues,
  profiles: readonly ProfileOption[],
  paths: readonly PathSketchOption[],
  snapshot: DocumentSnapshot,
  supports: readonly LoftSupportOption[] = [],
): FeatureRecord | null {
  const parameters =
    mode.operation === "loft"
      ? loftParameters(
          values,
          profiles,
          mode.kind === "edit" && mode.feature.type.schemaVersion === 2,
          supports,
        )
      : sweepParameters(values, profiles, paths)
  if (!parameters) return null
  const constrained = loftFeatureParametersV3Schema.safeParse(parameters)
  const constrainedParameters = constrained.success ? constrained.data : null
  const { sketchIds, type, maximumDependencies } = sweepLoftParameterIdentity(
    parameters,
    constrainedParameters,
  )
  const references = expectedSketchFeatureReferences(snapshot, sketchIds)
  const dependencies = expectedSketchFeatureDependencyIds(snapshot, sketchIds, [
    ...references.map(({ featureId }) => featureId),
    ...(constrainedParameters
      ? loftV3SupportBodies(constrainedParameters).map(({ featureId }) => featureId)
      : []),
  ])
  if (dependencies.length > maximumDependencies) return null
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

type SweepLoftParameters =
  | NonNullable<ReturnType<typeof loftParameters>>
  | NonNullable<ReturnType<typeof sweepParameters>>
function sweepLoftParameterIdentity(
  parameters: SweepLoftParameters,
  constrained: LoftFeatureParametersV3 | null,
) {
  if (constrained)
    return {
      sketchIds: loftV3SketchIds(constrained),
      type: loftFeatureTypeV3.type,
      maximumDependencies: MAX_LOFT_V3_DEPENDENCIES,
    }
  if ("sections" in parameters)
    return {
      sketchIds: parameters.sections.map(({ sketchId }) => sketchId),
      type: "holeCorrespondence" in parameters ? loftFeatureTypeV2.type : loftFeatureType.type,
      maximumDependencies: MAX_LOFT_SECTIONS,
    }
  return {
    sketchIds: [parameters.profile.sketchId, parameters.path.sketchId],
    type: sweepFeatureType.type,
    maximumDependencies: 8,
  }
}
