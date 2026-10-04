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
export function featureBodyDependencyIds(feature: FeatureRecord): readonly FeatureId[] {
  if (mirrorPreservesSource(feature)) return []
  if (independentBodyReaders.some((read) => read(feature) !== null)) return []
  if (featureTypeKey(feature.type) === featureTypeKey(booleanFeatureType.type))
    return booleanFeatureParametersSchema.safeParse(feature.parameters).data?.keepTools
      ? feature.dependencies.slice(0, 1)
      : feature.dependencies
  if (
    readHoleFeatureParameters(feature) ||
    readThreadFeatureParameters(feature) ||
    edgeModifierTypes.has(featureTypeKey(feature.type))
  )
    return feature.dependencies.slice(0, 1)
  if (
    readMirrorFeatureParametersV3(feature) ||
    readSplitFeatureParametersV2(feature) ||
    readPatternFeatureParametersV2(feature)
  )
    return feature.dependencies.slice(0, 1)
  const revolve = readRevolveFeatureParameters(feature)
  if (revolve) return revolve.operation === "new" ? [] : feature.dependencies.slice(0, 1)
  const extrusion = readExtrusionFeatureParameters(feature)
  if (!extrusion) return feature.dependencies
  return extrusion.operation === "new" ? [] : feature.dependencies.slice(0, 1)
}

export function featureBodyDependencies(
  feature: FeatureRecord,
): readonly { featureId: FeatureId; outputRole?: string }[] {
  const compound = readCompoundFeatureParameters(feature)
  if (compound) return compound.slots.map(({ targetBody }) => targetBody)
  const union = readUnionFeatureParameters(feature)
  if (union) return union.bodies
  for (const readTarget of exactBodyTargetReaders) {
    const target = readTarget(feature)
    if (target) return [{ featureId: target.featureId, outputRole: target.outputRole }]
  }
  return featureBodyDependencyIds(feature).map((featureId) => ({ featureId }))
}

const exactBodyTargetReaders = [
  (feature: FeatureRecord) => readExtrusionFeatureParameters(feature)?.targetBody,
  (feature: FeatureRecord) => readThreadFeatureParameters(feature)?.targetBody,
  readHoleBodyTarget,
  (feature: FeatureRecord) => readPlacementFeatureParameters(feature)?.targetBody,
  (feature: FeatureRecord) =>
    (readMirrorFeatureParameters(feature) ?? readMirrorFeatureParametersV3(feature))?.targetBody,
  (feature: FeatureRecord) =>
    (readPatternFeatureParameters(feature) ?? readPatternFeatureParametersV2(feature))?.targetBody,
  (feature: FeatureRecord) => readShellFeatureParameters(feature)?.targetBody,
  (feature: FeatureRecord) =>
    (readSplitFeatureParameters(feature) ?? readSplitFeatureParametersV2(feature))?.targetBody,
]

/** Exact geometry inputs include retained end supports without consuming their bodies. */
export function featureGeometryDependencies(feature: FeatureRecord) {
  const bodies = featureBodyDependencies(feature)
  const end = readExtrusionFeatureParameters(feature)?.endCondition
  return end &&
    end.kind !== "distance" &&
    !bodies.some(({ featureId }) => featureId === end.targetBody.featureId)
    ? [...bodies, end.targetBody]
    : bodies
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
