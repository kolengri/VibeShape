import { readDatumPlaneFeatureParameters } from "@vibeshape/domain"
import { terminalBodyOutputs } from "@vibeshape/domain/model-bodies"
import type { FeatureRecord } from "@vibeshape/domain/feature-graph"
import type { FeatureEvaluationEngineResult } from "@vibeshape/protocol"
import type { FeatureGeometryRecord, FeatureRebuildState } from "./feature-rebuild"

export type ModelBodyGeometry = Readonly<{
  featureId: FeatureRecord["id"]
  contentHash: string
  outputRole?: string
  shape: FeatureEvaluationEngineResult["shape"]
  mesh: FeatureEvaluationEngineResult["mesh"]
  topologyCandidates: FeatureEvaluationEngineResult["topologyCandidates"]
}>

type BodyState = Pick<FeatureRebuildState, "features" | "geometry" | "evaluation">

function featureBodies(feature: FeatureRecord, record: FeatureGeometryRecord): ModelBodyGeometry[] {
  if (readDatumPlaneFeatureParameters(feature) || record.geometry.shape.solidCount === 0) return []
  const { featureId, contentHash, geometry } = record
  const bodies = geometry.bodies
  if (bodies?.length) return bodies.map((body) => ({ featureId, contentHash, ...body }))
  return [
    {
      featureId,
      contentHash,
      shape: geometry.shape,
      mesh: geometry.mesh,
      topologyCandidates: geometry.topologyCandidates,
    },
  ]
}

function currentFeatureBodies(state: BodyState) {
  const records = new Map(state.evaluation.records.map((record) => [record.featureId, record]))
  const geometry = new Map(state.geometry.map((record) => [record.featureId, record]))
  if (records.size !== state.features.length || geometry.size !== state.geometry.length) return null
  const byFeature = new Map<string, ModelBodyGeometry[]>()
  let successful = 0
  for (const feature of state.features) {
    const result = records.get(feature.id)
    if (!result) return null
    if (result.status !== "succeeded") continue
    successful += 1
    const record = geometry.get(feature.id)
    if (!record || record.contentHash !== result.contentHash) return null
    byFeature.set(feature.id, featureBodies(feature, record))
  }
  return successful === geometry.size ? byFeature : null
}

/** Terminal exact bodies; failed or suppressed consumers leave their source bodies available. */
export function terminalBodyGeometry(state: BodyState): readonly ModelBodyGeometry[] | null {
  const byFeature = currentFeatureBodies(state)
  if (!byFeature) return null
  return terminalBodyOutputs(state.features, byFeature)
}
