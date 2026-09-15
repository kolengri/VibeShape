import { featureBodyDependencies } from "./feature-dependencies"
import type { FeatureRecord } from "./feature-graph"

type BodyOutput = { featureId: string; outputRole?: string | undefined }

function dependencyBodies<T extends BodyOutput>(
  dependency: ReturnType<typeof featureBodyDependencies>[number],
  byFeature: ReadonlyMap<string, readonly T[]>,
) {
  const source = byFeature.get(dependency.featureId)
  if (!source) return null
  if (dependency.outputRole === undefined) return source
  const selected = source.filter((body) => body.outputRole === dependency.outputRole)
  return selected.length === 1 ? selected : null
}

function consumeFeatureBodies<T extends BodyOutput>(
  feature: FeatureRecord,
  byFeature: ReadonlyMap<string, readonly T[]>,
  consumed: Set<T>,
) {
  for (const dependency of featureBodyDependencies(feature)) {
    const selected = dependencyBodies(dependency, byFeature)
    if (!selected) return false
    for (const body of selected) consumed.add(body)
  }
  return true
}

/** Applies body consumption to validated current outputs; empty and failed consumers retain sources. */
export function terminalBodyOutputs<T extends BodyOutput>(
  features: readonly FeatureRecord[],
  byFeature: ReadonlyMap<string, readonly T[]>,
): readonly T[] | null {
  const consumed = new Set<T>()
  for (const feature of features) {
    if (!byFeature.get(feature.id)?.length) continue
    if (!consumeFeatureBodies(feature, byFeature, consumed)) return null
  }
  return [...byFeature.values()].flat().filter((body) => !consumed.has(body))
}
