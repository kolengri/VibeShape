import type { BodyReference } from "@vibeshape/domain/body-reference"
import type { AuthoredDocumentSnapshot } from "@vibeshape/domain/document-v2"
import { featureEvaluationRecordSchema } from "@vibeshape/domain/feature-graph"
import { featureIdSchema } from "@vibeshape/domain/identifiers"
import type { PartRecord } from "@vibeshape/domain/parts"
import type { DocumentExportBodies } from "@vibeshape/protocol"
import { featureGeometryRecordSchema } from "./feature-rebuild"
import { type ModelBodyGeometry, terminalBodyGeometry } from "./model-bodies"
import type { PersistentDocumentSessionReport } from "./persistent-document-session"

export type ResolvedAuthoredPart = Readonly<{
  part: PartRecord
  body: ModelBodyGeometry | null
  status: "available" | "upstream" | "consumed" | "unavailable"
}>

function bodyKey(body: Pick<BodyReference, "featureId"> & { outputRole?: string | undefined }) {
  return `${body.featureId}:${body.outputRole ?? "result"}`
}

function currentTerminalBodies(report: PersistentDocumentSessionReport) {
  if (!report.rebuild.ok) return null
  const response = report.rebuild.response
  try {
    return terminalBodyGeometry({
      features: report.snapshot.features,
      geometry: response.geometry.map((record) => featureGeometryRecordSchema.parse(record)),
      evaluation: {
        records: response.evaluation.records.map((record) =>
          featureEvaluationRecordSchema.parse(record),
        ),
        dirtyFeatureIds: response.evaluation.dirtyFeatureIds.map((id) => featureIdSchema.parse(id)),
        evaluatedFeatureIds: response.evaluation.evaluatedFeatureIds.map((id) =>
          featureIdSchema.parse(id),
        ),
        reusedFeatureIds: response.evaluation.reusedFeatureIds.map((id) =>
          featureIdSchema.parse(id),
        ),
      },
    })
  } catch {
    return null
  }
}

function resolvePart(
  part: PartRecord,
  bodies: ReadonlyMap<string, ModelBodyGeometry>,
): ResolvedAuthoredPart {
  for (let index = part.bodyHistory.length - 1; index >= 0; index -= 1) {
    const binding = part.bodyHistory[index]
    if (!binding) continue
    const body = bodies.get(bodyKey(binding))
    if (body)
      return {
        part,
        body,
        status: index === part.bodyHistory.length - 1 ? "available" : "upstream",
      }
  }
  return { part, body: null, status: part.consumedBy ? "consumed" : "unavailable" }
}

/** Pure view projection: failed downstream operations may expose an earlier body of the same part. */
export function resolveAuthoredParts(
  authority: AuthoredDocumentSnapshot,
  report: PersistentDocumentSessionReport,
): readonly ResolvedAuthoredPart[] | null {
  if (
    authority.id !== report.snapshot.id ||
    authority.revision !== report.snapshot.revision ||
    !report.rebuild.ok
  )
    return null
  const response = report.rebuild.response
  if (response.documentId !== authority.id || response.revision !== authority.revision) return null
  const terminal = currentTerminalBodies(report)
  if (!terminal) return null
  const bodies = new Map(
    terminal
      .filter((body) => body.shape.valid && body.shape.solidCount === 1 && body.shape.volume > 0)
      .map((body) => [bodyKey(body), body]),
  )
  return authority.parts.map((part) => resolvePart(part, bodies))
}

/** Unmanaged legacy aggregates retain their existing visibility until explicit constituent support. */
export function visibleAuthoredBodies(
  bodies: readonly ModelBodyGeometry[],
  parts: readonly ResolvedAuthoredPart[],
): readonly ModelBodyGeometry[] {
  const hidden = new Set(
    parts.flatMap(({ part }) => (part.visible ? [] : part.bodyHistory.map(bodyKey))),
  )
  return bodies.filter((body) => !hidden.has(bodyKey(body)))
}

/** Resolve stable part identity at the captured revision; hidden bodies remain exportable. */
export function authoredPartExportBodies(
  authority: AuthoredDocumentSnapshot,
  report: PersistentDocumentSessionReport,
  partId?: string,
): DocumentExportBodies | null {
  const parts = resolveAuthoredParts(authority, report)
  const terminal = currentTerminalBodies(report)
  if (!parts || !terminal) return null
  const names = new Map(
    parts.flatMap(({ part, body }) => (body ? [[bodyKey(body), part.name] as const] : [])),
  )
  const selected = partId ? parts.find(({ part }) => part.id === partId)?.body : null
  if (partId && !selected) return null
  const bodies = selected ? [selected] : terminal
  return bodies.map(({ featureId, outputRole }) => {
    const name = names.get(bodyKey({ featureId, outputRole }))
    return {
      featureId,
      ...(outputRole === undefined ? {} : { outputRole }),
      ...(name ? { name } : {}),
    }
  })
}
