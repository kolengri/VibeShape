import type { ResolvedAuthoredPart } from "@vibeshape/application/authored-parts"
import type { DocumentRebuildOutcome } from "@vibeshape/application/persistent-document-session"
import type { DocumentSnapshot, FeatureRecord } from "@vibeshape/domain"
import { type BodyReference, bodyReferenceSchema } from "@vibeshape/domain/body-reference"
import { readRevolveFeatureParameters } from "@vibeshape/domain/part-design"
import { readBooleanFeatureParametersV2 } from "@vibeshape/domain/part-design-subtract"
import type { FeatureEvaluatedResponse } from "@vibeshape/protocol"
import { terminalModelBodies } from "./model-bodies"

export type ExactBodyOption = Readonly<{ id: string; label: string; body: BodyReference }>
export function exactBodyOptionId(body: BodyReference) {
  return JSON.stringify([body.featureId, body.outputRole])
}
function savedBodies(feature: FeatureRecord | undefined): readonly BodyReference[] {
  if (!feature) return []
  const boolean = readBooleanFeatureParametersV2(feature)
  if (boolean) return [boolean.targetBody, boolean.toolBody]
  const revolve = readRevolveFeatureParameters(feature)
  if (revolve?.targetBody) return [revolve.targetBody]
  return feature.dependencies.map((featureId) => ({
    schemaVersion: 0,
    featureId,
    outputRole: "result",
  }))
}
function bodyLabel(
  body: BodyReference,
  feature: FeatureRecord,
  parts: readonly ResolvedAuthoredPart[],
  unnamed: string,
) {
  const owners = parts.filter(({ part }) =>
    part.bodyHistory.some(
      (ref) => ref.featureId === body.featureId && ref.outputRole === body.outputRole,
    ),
  )
  return owners.length === 1
    ? (owners[0]?.part.name ?? unnamed)
    : `${feature.label ?? unnamed} · ${body.outputRole}`
}
type GeometryBody = NonNullable<FeatureEvaluatedResponse["bodies"]>[number]
function selectableBody(geometry: GeometryBody) {
  return (
    geometry.shape.valid &&
    geometry.shape.solidCount === 1 &&
    geometry.shape.volume > 0 &&
    geometry.representation !== "triangle-mesh"
  )
}
function featureBodyOptions(
  feature: FeatureRecord,
  bodies: readonly GeometryBody[],
  visible: Set<string>,
  parts: readonly ResolvedAuthoredPart[],
  unnamed: string,
): readonly ExactBodyOption[] {
  return bodies.filter(selectableBody).flatMap((geometry) => {
    const body = bodyReferenceSchema.parse({
      schemaVersion: 0,
      featureId: feature.id,
      outputRole: geometry.outputRole,
    })
    const id = exactBodyOptionId(body)
    return visible.has(id) ? [{ id, body, label: bodyLabel(body, feature, parts, unnamed) }] : []
  })
}
/** Retains explicit edit inputs while excluding later History and non-solid outputs. */
export function exactSolidBodyOptions(
  snapshot: DocumentSnapshot,
  rebuild: DocumentRebuildOutcome | undefined,
  editingFeatureId: string | undefined,
  parts: readonly ResolvedAuthoredPart[],
  unnamed: string,
): readonly ExactBodyOption[] {
  if (!rebuild?.ok) return []
  const stop = editingFeatureId
    ? snapshot.features.findIndex(({ id }) => id === editingFeatureId)
    : -1
  const excluded = new Set(stop < 0 ? [] : snapshot.features.slice(stop).map(({ id }) => id))
  const available = terminalModelBodies(snapshot.features, rebuild.response, [...excluded]) ?? []
  const visible = new Set([
    ...savedBodies(snapshot.features.find(({ id }) => id === editingFeatureId)).map(
      exactBodyOptionId,
    ),
    ...available.map((entry) =>
      exactBodyOptionId({
        schemaVersion: 0,
        featureId: entry.feature.id,
        outputRole: entry.geometry.outputRole ?? "result",
      }),
    ),
  ])
  return snapshot.features
    .filter((feature) => !feature.suppressed && !excluded.has(feature.id))
    .flatMap((feature) => {
      const record = rebuild.response.geometry.find(({ featureId }) => featureId === feature.id)
      const current = rebuild.response.evaluation.records.some(
        (entry) =>
          entry.featureId === feature.id &&
          entry.status === "succeeded" &&
          entry.contentHash === record?.contentHash,
      )
      return current
        ? featureBodyOptions(feature, record?.geometry.bodies ?? [], visible, parts, unnamed)
        : []
    })
}
