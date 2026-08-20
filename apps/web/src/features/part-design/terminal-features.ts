import { type FeatureRecord, featureBodyDependencyIds } from "@vibeshape/domain"

export function terminalFeatureIds(features: readonly FeatureRecord[]): ReadonlySet<string> {
  const dependencyIds = new Set(features.flatMap(featureBodyDependencyIds))
  return new Set(features.filter(({ id }) => !dependencyIds.has(id)).map(({ id }) => id))
}
