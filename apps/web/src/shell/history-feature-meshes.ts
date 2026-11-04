import { featureBodyDependencyIds } from "@vibeshape/domain/feature-dependencies"
import type { FeatureRecord } from "@vibeshape/domain/feature-graph"
import type { ViewerMesh } from "@vibeshape/viewer/three-viewport"

/** Resolve History identities against visible outputs without reviving consumed geometry. */
export function historyFeatureMeshes(
  features: readonly FeatureRecord[],
  meshes: readonly ViewerMesh[],
  featureId: string,
): readonly ViewerMesh[] {
  const byId = new Map<string, FeatureRecord>(features.map((feature) => [feature.id, feature]))
  return meshes.filter((mesh) => {
    const pending = [mesh.featureId]
    const visited = new Set<string>()
    while (pending.length) {
      const id = pending.pop()
      if (!id || visited.has(id)) continue
      if (id === featureId) return true
      visited.add(id)
      const feature = byId.get(id)
      if (feature) pending.push(...featureBodyDependencyIds(feature))
    }
    return false
  })
}
