import { readDatumPlaneFeatureParameters } from "@vibeshape/domain"
import type { DocumentSnapshot } from "@vibeshape/domain/document"
import { terminalBodyOutputs } from "@vibeshape/domain/model-bodies"
import {
  bodyMeasurementOutputs,
  type ModelBodyMeasurementEvidence,
  modelBodyMeasurementEvidenceSchema,
} from "@vibeshape/domain/model-body-measurements"
import {
  type ModelMeasurementEvidence,
  modelMeasurementEvidenceSchema,
} from "@vibeshape/domain/model-measurements"
import { type DocumentWorkerResponse, documentWorkerResponseSchema } from "@vibeshape/protocol"
import type { DocumentRebuildOutcome } from "./persistent-document-session"

export type ModelMeasurementResult =
  | { ok: true; evidence: ModelMeasurementEvidence }
  | {
      ok: false
      code: "geometry-unavailable" | "stale-geometry" | "invalid-geometry-evidence"
    }

function sameIds(left: readonly string[], right: readonly string[]) {
  if (left.length !== right.length) return false
  const ids = new Set(left)
  return ids.size === left.length && right.every((id) => ids.has(id))
}

function rebuildResponse(
  rebuild: Extract<DocumentRebuildOutcome, { ok: true }>,
): Extract<DocumentWorkerResponse, { type: "documentRebuilt" }> | null {
  const parsed = documentWorkerResponseSchema.safeParse(rebuild.response)
  if (!parsed.success || parsed.data.type !== "documentRebuilt") return null
  return parsed.data
}

type RebuiltResponse = Extract<DocumentWorkerResponse, { type: "documentRebuilt" }>

function projectEntries(response: RebuiltResponse): readonly unknown[] | null {
  const geometryById = new Map(response.geometry.map((record) => [record.featureId, record]))
  const entries: unknown[] = []
  for (const record of response.evaluation.records) {
    if (record.status === "succeeded") {
      const geometry = geometryById.get(record.featureId)
      if (!geometry || geometry.contentHash !== record.contentHash) return null
      entries.push({
        featureId: record.featureId,
        status: "succeeded",
        contentHash: record.contentHash,
        shape: geometry.geometry.shape,
      })
      continue
    }
    if (record.status === "failed") {
      entries.push({
        featureId: record.featureId,
        status: "failed",
        diagnosticCodes: record.diagnostics.map((diagnostic) => diagnostic.code),
      })
      continue
    }
    if (record.status === "blocked") {
      entries.push({
        featureId: record.featureId,
        status: "blocked",
        blockedBy: record.blockedBy,
      })
      continue
    }
    entries.push({ featureId: record.featureId, status: "suppressed" })
  }
  return entries
}

function measurementSource(
  snapshot: DocumentSnapshot,
  rebuild: DocumentRebuildOutcome,
):
  | (Extract<ModelMeasurementResult, { ok: true }> & { response: RebuiltResponse })
  | Extract<ModelMeasurementResult, { ok: false }> {
  if (!rebuild.ok) return { ok: false, code: "geometry-unavailable" }

  const response = rebuildResponse(rebuild)
  if (!response) return { ok: false, code: "invalid-geometry-evidence" }
  if (response.documentId !== snapshot.id || response.revision !== snapshot.revision) {
    return { ok: false, code: "stale-geometry" }
  }

  const snapshotIds = snapshot.features.map((feature) => feature.id)
  const records = response.evaluation.records
  const recordIds = records.map((record) => record.featureId)
  if (!sameIds(snapshotIds, recordIds)) return { ok: false, code: "invalid-geometry-evidence" }

  const entries = projectEntries(response)
  if (!entries) return { ok: false, code: "invalid-geometry-evidence" }

  const parsed = modelMeasurementEvidenceSchema.safeParse({
    schemaVersion: 1,
    documentId: snapshot.id,
    revision: snapshot.revision,
    generation: response.generation,
    features: entries,
  })
  if (!parsed.success) return { ok: false, code: "invalid-geometry-evidence" }
  const succeededIds = parsed.data.features
    .filter((entry) => entry.status === "succeeded")
    .map((entry) => entry.featureId)
  if (
    !sameIds(
      succeededIds,
      response.geometry.map((record) => record.featureId),
    )
  )
    return { ok: false, code: "invalid-geometry-evidence" }
  return { ok: true, evidence: parsed.data, response }
}

export function createModelMeasurementEvidence(
  snapshot: DocumentSnapshot,
  rebuild: DocumentRebuildOutcome,
): ModelMeasurementResult {
  const source = measurementSource(snapshot, rebuild)
  return source.ok ? { ok: true, evidence: source.evidence } : source
}

export type ModelBodyMeasurementResult =
  | { ok: true; evidence: ModelBodyMeasurementEvidence }
  | Extract<ModelMeasurementResult, { ok: false }>

function featureBodyMetrics(record: RebuiltResponse["geometry"][number]) {
  const catalog = record.geometry.bodies?.length
    ? record.geometry.bodies
    : [{ shape: record.geometry.shape }]
  return catalog.map((body) => ({
    featureId: record.featureId,
    contentHash: record.contentHash,
    ...("outputRole" in body ? { outputRole: body.outputRole } : {}),
    shape: body.shape,
  }))
}

function projectBodyEntries(snapshot: DocumentSnapshot, response: RebuiltResponse) {
  const features = new Map(snapshot.features.map((feature) => [String(feature.id), feature]))
  const bodies: unknown[] = []
  for (const record of response.geometry) {
    const feature = features.get(record.featureId)
    if (!feature) return null
    if (readDatumPlaneFeatureParameters(feature) || record.geometry.shape.solidCount === 0) continue
    const catalog = featureBodyMetrics(record)
    if (bodies.length + catalog.length > 100_000) return null
    bodies.push(...catalog)
  }
  return bodies
}

export function createModelBodyMeasurementEvidence(
  snapshot: DocumentSnapshot,
  rebuild: DocumentRebuildOutcome,
): ModelBodyMeasurementResult {
  const source = measurementSource(snapshot, rebuild)
  if (!source.ok) return source
  const bodies = projectBodyEntries(snapshot, source.response)
  if (!bodies) return { ok: false, code: "invalid-geometry-evidence" }
  const parsed = modelBodyMeasurementEvidenceSchema.safeParse({ ...source.evidence, bodies })
  if (!parsed.success) return { ok: false, code: "invalid-geometry-evidence" }
  const outputs = bodyMeasurementOutputs(snapshot.features, parsed.data)
  if (!outputs || !terminalBodyOutputs(snapshot.features, outputs))
    return { ok: false, code: "invalid-geometry-evidence" }
  return { ok: true, evidence: parsed.data }
}
