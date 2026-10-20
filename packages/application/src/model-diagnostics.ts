import { inspectSketchReferenceHealth, readDatumPlaneFeatureParameters } from "@vibeshape/domain"
import type { DocumentSnapshot } from "@vibeshape/domain/document"
import {
  type ModelDiagnosticsEvidence,
  type modelDiagnosticEntrySchema,
  modelDiagnosticsEvidenceSchema,
} from "@vibeshape/domain/model-diagnostics"
import type { DocumentWorkerResponse } from "@vibeshape/protocol"
import { createModelMeasurementSource } from "./model-measurements"
import type { DocumentRebuildOutcome } from "./persistent-document-session"
import { datumPlaneFrame, sketchFrame } from "./support-frame"
import { inspectPlanarSupportHealth } from "./support-health"

type Entry = import("zod").input<typeof modelDiagnosticEntrySchema>
type RebuiltResponse = Extract<DocumentWorkerResponse, { type: "documentRebuilt" }>
function featureDiagnostics(current: RebuiltResponse): Entry[] {
  const entries: Entry[] = []
  for (const record of current.evaluation.records) {
    if (record.status === "failed")
      for (const diagnostic of record.diagnostics)
        entries.push({
          entity: { kind: "feature", id: record.featureId },
          ...diagnostic,
          action: "inspect-feature",
        })
    if (record.status === "blocked")
      entries.push({
        entity: { kind: "feature", id: record.featureId },
        code: "org.vibeshape.feature.dependency-blocked",
        values: {},
        blockedBy: record.blockedBy,
        action: "repair-dependency",
      })
  }
  return entries
}
function supportEntry(
  entity: Entry["entity"],
  reference: Parameters<typeof inspectPlanarSupportHealth>[0],
  frameAvailable: boolean,
  current: RebuiltResponse,
  entries: Entry[],
) {
  const health = inspectPlanarSupportHealth(reference, current)
  const status = health?.status === "resolved" && !frameAvailable ? "missing" : health?.status
  if (!status || status === "resolved") return
  entries.push({
    entity,
    code: `org.vibeshape.${entity.kind === "sketch" ? "sketch" : "datum-plane"}.support-${status}`,
    values: {},
    supportFeatureId: reference.featureId,
    resolution: status,
    action: "reselect-support",
  })
}

function datumDiagnostics(snapshot: DocumentSnapshot, current: RebuiltResponse): Entry[] {
  const entries: Entry[] = []
  for (const feature of snapshot.features) {
    if (feature.suppressed) continue
    const datum = readDatumPlaneFeatureParameters(feature)
    if (datum?.support.kind === "feature-face")
      supportEntry(
        { kind: "feature", id: feature.id },
        datum.support.reference,
        datumPlaneFrame(feature, snapshot, snapshot.features, new Set(), current.geometry) !== null,
        current,
        entries,
      )
  }
  return entries
}
function sketchSupportDiagnostics(snapshot: DocumentSnapshot, current: RebuiltResponse): Entry[] {
  const entries: Entry[] = []
  for (const sketch of snapshot.sketches) {
    if (sketch.support)
      supportEntry(
        { kind: "sketch", id: sketch.id },
        sketch.support.reference,
        sketchFrame(sketch, snapshot, snapshot.features, new Set(), current.geometry) !== null,
        current,
        entries,
      )
  }
  return entries
}
function referenceDiagnostics(snapshot: DocumentSnapshot, current: RebuiltResponse): Entry[] {
  const entries: Entry[] = []
  const byReference = new Map(
    current.modelReferenceEvidence.map((entry) => [
      `${entry.sketchId}:${entry.referenceId}`,
      entry.status,
    ]),
  )
  const health = inspectSketchReferenceHealth(
    snapshot.sketches,
    undefined,
    (sketchId, reference) => byReference.get(`${sketchId}:${reference.id}`) ?? "unknown",
  )
  for (const sketch of snapshot.sketches) {
    const references = health.get(sketch.id)
    if (!references) continue
    for (const [ids, resolution] of [
      [references.directBrokenReferenceIds, "broken"],
      [references.transitiveBrokenReferenceIds, "broken"],
      [references.unknownReferenceIds, "unknown"],
    ] as const)
      for (const referenceId of ids)
        entries.push({
          entity: { kind: "sketch", id: sketch.id },
          code: `org.vibeshape.sketch.reference-${resolution}`,
          values: {},
          referenceId,
          resolution,
          action: "repair-reference",
        })
  }
  return entries
}

export function createModelDiagnosticsEvidence(
  snapshot: DocumentSnapshot,
  rebuild: DocumentRebuildOutcome,
):
  | { ok: true; evidence: ModelDiagnosticsEvidence }
  | { ok: false; code: "geometry-unavailable" | "stale-geometry" | "invalid-geometry-evidence" } {
  const measured = createModelMeasurementSource(snapshot, rebuild)
  if (!measured.ok) return measured
  const current = measured.response
  const entries = [
    ...featureDiagnostics(current),
    ...datumDiagnostics(snapshot, current),
    ...sketchSupportDiagnostics(snapshot, current),
    ...referenceDiagnostics(snapshot, current),
  ]
  const status = entries.some((entry) => entry.resolution !== "unknown")
    ? "invalid"
    : entries.length
      ? "unknown"
      : "valid"
  const evidence = modelDiagnosticsEvidenceSchema.safeParse({
    schemaVersion: 1,
    documentId: snapshot.id,
    revision: snapshot.revision,
    generation: current.generation,
    status,
    truncated: false,
    entries,
  })
  return evidence.success
    ? { ok: true, evidence: evidence.data }
    : { ok: false, code: "invalid-geometry-evidence" }
}
