import { canonicalJson } from "./canonical-json"
import { createFeatureGraph, type FeatureRecord } from "./feature-graph"

export type FeatureCollectionDiagnostic = Readonly<{
  code: "feature-already-exists" | "feature-not-found" | "feature-in-use" | "invalid-feature-graph"
  message: string
  issues: readonly { path: string; message: string }[]
}>

export type FeatureCollectionResult =
  | { ok: true; features: readonly FeatureRecord[] }
  | { ok: false; diagnostic: FeatureCollectionDiagnostic }

function collectionFailure(
  code: FeatureCollectionDiagnostic["code"],
  message: string,
  issues: FeatureCollectionDiagnostic["issues"] = [],
): FeatureCollectionResult {
  return { ok: false, diagnostic: { code, message, issues } }
}

function validateFeatures(features: readonly FeatureRecord[]): FeatureCollectionResult {
  const result = createFeatureGraph(features)

  return result.ok
    ? { ok: true, features: result.graph.features }
    : collectionFailure("invalid-feature-graph", result.diagnostic.message, [
        { path: "features", message: result.diagnostic.message },
        ...result.diagnostic.issues,
      ])
}

export function addFeature(
  features: readonly FeatureRecord[],
  feature: FeatureRecord,
): FeatureCollectionResult {
  if (features.some((candidate) => candidate.id === feature.id)) {
    return collectionFailure(
      "feature-already-exists",
      `Feature ${feature.id} already exists in the document.`,
    )
  }

  return validateFeatures([...features, feature])
}

export function updateFeature(
  features: readonly FeatureRecord[],
  feature: FeatureRecord,
): FeatureCollectionResult {
  const index = features.findIndex((candidate) => candidate.id === feature.id)

  if (index < 0) {
    return collectionFailure(
      "feature-not-found",
      `Feature ${feature.id} does not exist in the document.`,
    )
  }

  const next = [...features]
  next[index] = feature
  return validateFeatures(next)
}

export function removeFeature(
  features: readonly FeatureRecord[],
  featureId: FeatureRecord["id"],
): FeatureCollectionResult {
  const index = features.findIndex((candidate) => candidate.id === featureId)

  if (index < 0) {
    return collectionFailure(
      "feature-not-found",
      `Feature ${featureId} does not exist in the document.`,
    )
  }

  const dependents = features.flatMap((feature, featureIndex) =>
    feature.dependencies.includes(featureId)
      ? [
          {
            path: `features.${featureIndex}.dependencies`,
            message: `Feature ${feature.id} depends on ${featureId}.`,
          },
        ]
      : [],
  )
  if (dependents.length > 0) {
    return collectionFailure(
      "feature-in-use",
      `Feature ${featureId} cannot be removed while other features depend on it.`,
      dependents,
    )
  }

  return validateFeatures(features.filter((_, featureIndex) => featureIndex !== index))
}

export function setFeatureSuppressed(
  features: readonly FeatureRecord[],
  featureId: FeatureRecord["id"],
  suppressed: boolean,
): FeatureCollectionResult {
  const feature = features.find((candidate) => candidate.id === featureId)

  return feature
    ? updateFeature(features, { ...feature, suppressed })
    : collectionFailure("feature-not-found", `Feature ${featureId} does not exist in the document.`)
}

export function featureRecordsEqual(left: FeatureRecord, right: FeatureRecord) {
  return canonicalJson(left) === canonicalJson(right)
}
