import type { FeatureRecord } from "./feature-graph"
import type { FeatureId } from "./identifiers"
import { readExtrusionFeatureParameters, readRevolveFeatureParameters } from "./part-design"
import { readDatumPlaneFeatureParameters } from "./reference-geometry"

export function featureBodyDependencyIds(feature: FeatureRecord): readonly FeatureId[] {
  if (readDatumPlaneFeatureParameters(feature)) return []
  const revolve = readRevolveFeatureParameters(feature)
  if (revolve) return revolve.operation === "new" ? [] : feature.dependencies.slice(0, 1)
  const extrusion = readExtrusionFeatureParameters(feature)
  if (!extrusion) return feature.dependencies
  return extrusion.operation === "new" ? [] : feature.dependencies.slice(0, 1)
}
