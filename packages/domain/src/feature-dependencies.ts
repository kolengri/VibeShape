import type { FeatureRecord } from "./feature-graph"
import { featureTypeKey } from "./feature-type-contracts"
import type { FeatureId } from "./identifiers"
import {
  booleanFeatureParametersSchema,
  booleanFeatureType,
  chamferFeatureType,
  chamferFeatureTypeV2,
  filletFeatureType,
  filletFeatureTypeV2,
  readExtrusionFeatureParameters,
  readRevolveFeatureParameters,
} from "./part-design"
import {
  readCompoundFeatureParameters,
  readUnionFeatureParameters,
} from "./part-design-body-combination"
import { readHoleBodyTarget, readHoleFeatureParameters } from "./part-design-hole"
import { readImportedFeatureParameters } from "./part-design-import"
import { readLoftFeatureParameters } from "./part-design-loft"
import { readMeshImportFeatureParameters } from "./part-design-mesh-import"
import {
  mirrorPreservesSource,
  readMirrorFeatureParameters,
  readMirrorFeatureParametersV3,
} from "./part-design-mirror"
import { readPatternFeatureParameters, readPatternFeatureParametersV2 } from "./part-design-pattern"
import { readPlacementFeatureParameters } from "./part-design-placement"
import { readShellFeatureParameters } from "./part-design-shell"
import { readSplitFeatureParameters, readSplitFeatureParametersV2 } from "./part-design-split"
import { booleanBodyDependencyIds, readBooleanFeatureParametersV2 } from "./part-design-subtract"
import { readSweepFeatureParameters } from "./part-design-sweep"
import { readThreadFeatureParameters } from "./part-design-thread"
import { readDatumPlaneFeatureParameters } from "./reference-geometry"

const independentBodyReaders = [
  readDatumPlaneFeatureParameters,
  readImportedFeatureParameters,
  readMeshImportFeatureParameters,
  readLoftFeatureParameters,
  readSweepFeatureParameters,
]
const edgeModifierTypes = new Set(
  [filletFeatureType, chamferFeatureType, filletFeatureTypeV2, chamferFeatureTypeV2].map(
    ({ type }) => featureTypeKey(type),
  ),
)
const exactTargetReaders = [
  (feature: FeatureRecord) => readRevolveFeatureParameters(feature)?.targetBody,
  (feature: FeatureRecord) => readThreadFeatureParameters(feature)?.targetBody,
  readHoleBodyTarget,
  (feature: FeatureRecord) => readPlacementFeatureParameters(feature)?.targetBody,
  (feature: FeatureRecord) => readMirrorFeatureParameters(feature)?.targetBody,
  (feature: FeatureRecord) => readMirrorFeatureParametersV3(feature)?.targetBody,
  (feature: FeatureRecord) => readPatternFeatureParameters(feature)?.targetBody,
  (feature: FeatureRecord) => readPatternFeatureParametersV2(feature)?.targetBody,
  (feature: FeatureRecord) => readShellFeatureParameters(feature)?.targetBody,
  (feature: FeatureRecord) => readSplitFeatureParameters(feature)?.targetBody,
  (feature: FeatureRecord) => readSplitFeatureParametersV2(feature)?.targetBody,
]
const supportAwareTargetReaders = [
  readMirrorFeatureParametersV3,
  readSplitFeatureParametersV2,
  readPatternFeatureParametersV2,
]
function exactBodyTarget(feature: FeatureRecord) {
  for (const read of exactTargetReaders) {
    const target = read(feature)
    if (target) return target
  }
  return null
}
function consumedSubtractBodies(
  parameters: NonNullable<ReturnType<typeof readBooleanFeatureParametersV2>>,
) {
  return parameters.keepTools
    ? [parameters.targetBody]
    : [parameters.targetBody, parameters.toolBody]
}
export function featureBodyDependencyIds(feature: FeatureRecord): readonly FeatureId[] {
  const boolean = readBooleanFeatureParametersV2(feature)
  if (boolean) return booleanBodyDependencyIds(consumedSubtractBodies(boolean))
  if (mirrorPreservesSource(feature)) return []
  if (independentBodyReaders.some((read) => read(feature) !== null)) return []
  if (featureTypeKey(feature.type) === featureTypeKey(booleanFeatureType.type))
    return booleanFeatureParametersSchema.safeParse(feature.parameters).data?.keepTools
      ? feature.dependencies.slice(0, 1)
      : feature.dependencies
  if (readHoleFeatureParameters(feature) || edgeModifierTypes.has(featureTypeKey(feature.type)))
    return feature.dependencies.slice(0, 1)
  if (supportAwareTargetReaders.some((read) => read(feature) !== null))
    return feature.dependencies.slice(0, 1)
  const profile = readRevolveFeatureParameters(feature) ?? readExtrusionFeatureParameters(feature)
  if (!profile) return feature.dependencies
  return profile.operation === "new" ? [] : feature.dependencies.slice(0, 1)
}

export function featureBodyDependencies(
  feature: FeatureRecord,
): readonly { featureId: FeatureId; outputRole?: string }[] {
  const compound = readCompoundFeatureParameters(feature)
  if (compound) return compound.slots.map(({ targetBody }) => targetBody)
  const union = readUnionFeatureParameters(feature)
  if (union) return union.bodies
  const boolean = readBooleanFeatureParametersV2(feature)
  if (boolean) return consumedSubtractBodies(boolean)
  const target = exactBodyTarget(feature)
  if (target) return [{ featureId: target.featureId, outputRole: target.outputRole }]
  return featureBodyDependencyIds(feature).map((featureId) => ({ featureId }))
}

/** Feature outputs that remain after downstream body-consuming operations. */
export function terminalFeatureIds(features: readonly FeatureRecord[]): ReadonlySet<string> {
  const consumed = new Set(features.flatMap(featureBodyDependencyIds))
  return new Set(
    features
      .filter(
        (feature) => !consumed.has(feature.id) && readDatumPlaneFeatureParameters(feature) === null,
      )
      .map(({ id }) => id),
  )
}
