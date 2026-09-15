import { type ModelBodyGeometry, terminalBodyGeometry } from "@vibeshape/application/model-bodies"
import {
  type FeatureId,
  type FeatureRecord,
  featureEvaluationRecordSchema,
  featureIdSchema,
} from "@vibeshape/domain"
import type { DocumentWorkerResponse } from "@vibeshape/protocol"

export type { ModelBodyGeometry } from "@vibeshape/application/model-bodies"

export type ModelBodySelection = Readonly<{
  featureId: FeatureId
  outputRole?: string
}>

export type ModelBodyView = Readonly<{
  feature: FeatureRecord
  geometry: ModelBodyGeometry
}>

type RebuildResponse = Extract<DocumentWorkerResponse, { type: "documentRebuilt" }>

/** Projects rebuild output into the exact terminal bodies available to the web model tree. */
export function terminalModelBodies(
  features: readonly FeatureRecord[],
  rebuild: RebuildResponse,
  excludedFeatureIds: readonly string[] = [],
): readonly ModelBodyView[] | null {
  if (!rebuild.evaluation || !rebuild.geometry) return null
  const excluded = new Set(excludedFeatureIds)
  const scopedFeatures = features.filter((feature) => !excluded.has(feature.id))
  try {
    const scopedEvaluation = {
      records: rebuild.evaluation.records
        .filter((record) => !excluded.has(record.featureId))
        .map((record) => featureEvaluationRecordSchema.parse(record)),
      dirtyFeatureIds: rebuild.evaluation.dirtyFeatureIds
        .filter((featureId) => !excluded.has(featureId))
        .map((featureId) => featureIdSchema.parse(featureId)),
      evaluatedFeatureIds: rebuild.evaluation.evaluatedFeatureIds
        .filter((featureId) => !excluded.has(featureId))
        .map((featureId) => featureIdSchema.parse(featureId)),
      reusedFeatureIds: rebuild.evaluation.reusedFeatureIds
        .filter((featureId) => !excluded.has(featureId))
        .map((featureId) => featureIdSchema.parse(featureId)),
    }
    const scopedGeometry = rebuild.geometry
      .filter((record) => !excluded.has(record.featureId))
      .map((record) => ({
        ...record,
        featureId: featureIdSchema.parse(record.featureId),
      }))
    const geometry = terminalBodyGeometry({
      features: scopedFeatures,
      evaluation: scopedEvaluation,
      geometry: scopedGeometry,
    })
    if (!geometry) return null

    const featuresById = new Map(scopedFeatures.map((feature) => [feature.id, feature]))
    const views: ModelBodyView[] = []
    for (const body of geometry) {
      const feature = featuresById.get(body.featureId)
      if (!feature) return null
      views.push({ feature, geometry: body })
    }
    return views
  } catch {
    return null
  }
}
