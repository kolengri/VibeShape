import type { FeatureRecord } from "@vibeshape/domain"

export function terminalFeatureIds(
  features: readonly Pick<FeatureRecord, "dependencies" | "id">[],
): ReadonlySet<string> {
  const dependencyIds = new Set(features.flatMap(({ dependencies }) => dependencies))
  return new Set(features.filter(({ id }) => !dependencyIds.has(id)).map(({ id }) => id))
}
