import type { FeatureRecord } from "./feature-graph"
import type { FeatureId } from "./identifiers"
import {
  chamferFeatureType,
  chamferFeatureTypeV2,
  filletFeatureType,
  filletFeatureTypeV2,
  readExtrusionFeatureParameters,
  readRevolveFeatureParameters,
} from "./part-design"
import { readHoleBodyTarget, readHoleFeatureParameters } from "./part-design-hole"
import { readDatumPlaneFeatureParameters } from "./reference-geometry"

export function featureBodyDependencyIds(feature: FeatureRecord): readonly FeatureId[] {
  if (readDatumPlaneFeatureParameters(feature)) return []
  if (readHoleFeatureParameters(feature)) return feature.dependencies.slice(0, 1)
  if (
    feature.type &&
    [
      filletFeatureType.type,
      chamferFeatureType.type,
      filletFeatureTypeV2.type,
      chamferFeatureTypeV2.type,
    ].some(
      (type) =>
        feature.type?.moduleId === type.moduleId &&
        feature.type.moduleVersion === type.moduleVersion &&
        feature.type.typeId === type.typeId &&
        feature.type.schemaVersion === type.schemaVersion,
    )
  ) {
    return feature.dependencies.slice(0, 1)
  }
  const revolve = readRevolveFeatureParameters(feature)
  if (revolve) return revolve.operation === "new" ? [] : feature.dependencies.slice(0, 1)
  const extrusion = readExtrusionFeatureParameters(feature)
  if (!extrusion) return feature.dependencies
  return extrusion.operation === "new" ? [] : feature.dependencies.slice(0, 1)
}

export function featureBodyDependencies(
  feature: FeatureRecord,
): readonly { featureId: FeatureId; outputRole?: string }[] {
  const target = readHoleBodyTarget(feature)
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
