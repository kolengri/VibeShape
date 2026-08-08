import { createFeatureGraph, type FeatureRecord } from "./feature-graph"

export type FeatureCollectionDiagnostic = Readonly<{
  code: "feature-already-exists" | "feature-not-found" | "invalid-feature-graph"
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

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "undefined"
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`

  const record = value as Record<string, unknown>
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(",")}}`
}

export function featureRecordsEqual(left: FeatureRecord, right: FeatureRecord) {
  return canonicalJson(left) === canonicalJson(right)
}
