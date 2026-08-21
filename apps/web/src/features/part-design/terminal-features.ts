import {
  type FeatureRecord,
  featureBodyDependencyIds,
  readDatumPlaneFeatureParameters,
} from "@vibeshape/domain"

export function terminalFeatureIds(features: readonly FeatureRecord[]): ReadonlySet<string> {
  const dependencyIds = new Set(features.flatMap(featureBodyDependencyIds))
  return new Set(
    features
      .filter(
        (feature) =>
          !dependencyIds.has(feature.id) && readDatumPlaneFeatureParameters(feature) === null,
      )
      .map(({ id }) => id),
  )
}
