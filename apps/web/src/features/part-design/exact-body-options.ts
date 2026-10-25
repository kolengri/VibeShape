import type { ResolvedAuthoredPart } from "@vibeshape/application/authored-parts"
import type { DocumentRebuildOutcome } from "@vibeshape/application/persistent-document-session"
import {
  booleanFeatureType,
  type DocumentSnapshot,
  type FeatureRecord,
  featureTypeKey,
} from "@vibeshape/domain"
import { type BodyReference, bodyReferenceSchema } from "@vibeshape/domain/body-reference"
import { readRevolveFeatureParameters } from "@vibeshape/domain/part-design"
import { readFdmFeatureParameters } from "@vibeshape/domain/part-design-fdm"
import { readBooleanFeatureParametersV2 } from "@vibeshape/domain/part-design-subtract"
import type { FeatureEvaluatedResponse } from "@vibeshape/protocol"
import { useMemo } from "react"
import { terminalModelBodies } from "./model-bodies"

export type ExactBodyOption = Readonly<{ id: string; label: string; body?: BodyReference }>
export function exactBodyOptionId(body: BodyReference) {
  return JSON.stringify([body.featureId, body.outputRole])
}
function savedBodies(feature: FeatureRecord | undefined): readonly BodyReference[] {
  if (!feature) return []
  const fdm = readFdmFeatureParameters(feature)
  if (fdm && "targetBody" in fdm && fdm.targetBody) return [fdm.targetBody]
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
function bodyOwners(parts: readonly ResolvedAuthoredPart[], unnamed: string) {
  const owners = new Map<string, string | null>()
  for (const { part } of parts) {
    // A repeated history entry in one part is still one owner.
    const seen = new Set<string>()
    for (const body of part.bodyHistory) {
      const id = exactBodyOptionId(body)
      if (seen.has(id)) continue
      seen.add(id)
      owners.set(id, owners.has(id) ? null : (part.name ?? unnamed))
    }
  }
  return owners
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
function currentGeometries(rebuild: Extract<DocumentRebuildOutcome, { ok: true }>) {
  const first = new Map<string, (typeof rebuild.response.geometry)[number]>()
  for (const record of rebuild.response.geometry) {
    if (!first.has(record.featureId)) first.set(record.featureId, record)
  }
  const current = new Map<string, (typeof rebuild.response.geometry)[number]["geometry"]>()
  for (const entry of rebuild.response.evaluation.records) {
    const record = first.get(entry.featureId)
    if (record && entry.status === "succeeded" && entry.contentHash === record.contentHash)
      current.set(entry.featureId, record.geometry)
  }
  return current
}
function legacyProducerIds(feature: FeatureRecord | undefined): readonly string[] {
  if (!feature) return []
  if (featureTypeKey(feature.type) === featureTypeKey(booleanFeatureType.type))
    return feature.dependencies.slice(0, 2)
  const revolve = readRevolveFeatureParameters(feature)
  return revolve && !revolve.targetBody && revolve.operation !== "new"
    ? feature.dependencies.slice(0, 1)
    : []
}
function featureBodyOptions(
  feature: FeatureRecord,
  bodies: readonly GeometryBody[],
  visible: Set<string>,
  owners: ReadonlyMap<string, string | null>,
  unnamed: string,
  retainedProducer: boolean,
): readonly ExactBodyOption[] {
  return bodies.filter(selectableBody).flatMap((geometry) => {
    const body = bodyReferenceSchema.parse({
      schemaVersion: 0,
      featureId: feature.id,
      outputRole: geometry.outputRole,
    })
    const id = exactBodyOptionId(body)
    return visible.has(id) || retainedProducer
      ? [{ id, body, label: owners.get(id) ?? `${feature.label ?? unnamed} · ${body.outputRole}` }]
      : []
  })
}
function bodyScope(
  snapshot: DocumentSnapshot,
  rebuild: Extract<DocumentRebuildOutcome, { ok: true }>,
  editingFeatureId: string | undefined,
) {
  const stop = editingFeatureId
    ? snapshot.features.findIndex(({ id }) => id === editingFeatureId)
    : -1
  const excluded = new Set(stop < 0 ? [] : snapshot.features.slice(stop).map(({ id }) => id))
  const available = terminalModelBodies(snapshot.features, rebuild.response, [...excluded]) ?? []
  const edited = snapshot.features.find(({ id }) => id === editingFeatureId)
  const visible = new Set([
    ...savedBodies(edited).map(exactBodyOptionId),
    ...available.map((entry) =>
      JSON.stringify([entry.feature.id, entry.geometry.outputRole ?? "result"]),
    ),
  ])
  return { excluded, visible, legacyIds: new Set(legacyProducerIds(edited)) }
}

/** Retains explicit edit inputs while excluding later History and non-solid outputs. */
export function exactSolidBodyOptions(
  snapshot: DocumentSnapshot,
  rebuild: DocumentRebuildOutcome | undefined,
  editingFeatureId: string | undefined,
  parts: readonly ResolvedAuthoredPart[],
  unnamed: string,
  legacyLabel: (name: string) => string = (name) => name,
): readonly ExactBodyOption[] {
  if (!rebuild?.ok) return []
  const { excluded, visible, legacyIds } = bodyScope(snapshot, rebuild, editingFeatureId)
  const geometryByFeature = currentGeometries(rebuild)
  const owners = bodyOwners(parts, unnamed)
  return snapshot.features
    .filter((feature) => !feature.suppressed && !excluded.has(feature.id))
    .flatMap((feature) => {
      const geometry = geometryByFeature.get(feature.id)
      if (!geometry) return []
      const legacy =
        legacyIds.has(feature.id) &&
        geometry.shape.valid &&
        geometry.shape.solidCount >= 1 &&
        geometry.shape.volume > 0
          ? [{ id: feature.id, label: legacyLabel(feature.label ?? unnamed) }]
          : []
      return [
        ...legacy,
        ...featureBodyOptions(
          feature,
          geometry.bodies ?? [],
          visible,
          owners,
          unnamed,
          legacyIds.has(feature.id),
        ),
      ]
    })
}

/** Boolean creation uses the same current body and consumption rules without building labels. */
export function hasMultipleExactSolidBodies(
  snapshot: DocumentSnapshot,
  rebuild: DocumentRebuildOutcome | undefined,
): boolean {
  if (!rebuild?.ok) return false
  const { visible } = bodyScope(snapshot, rebuild, undefined)
  const geometryByFeature = currentGeometries(rebuild)
  let count = 0
  for (const feature of snapshot.features) {
    if (feature.suppressed) continue
    for (const geometry of geometryByFeature.get(feature.id)?.bodies ?? []) {
      if (!selectableBody(geometry)) continue
      // Preserve the collector's validation even for a malformed, nonterminal body.
      const featureId = bodyReferenceSchema.shape.featureId.parse(feature.id)
      const outputRole = bodyReferenceSchema.shape.outputRole.parse(geometry.outputRole)
      if (visible.has(JSON.stringify([featureId, outputRole]))) count += 1
    }
  }
  return count >= 2
}

/** Cache only within the mounted task; document reports publish replacement immutable sources. */
export function useExactSolidBodyOptions(
  snapshot: DocumentSnapshot | undefined,
  rebuild: DocumentRebuildOutcome | undefined,
  editingFeatureId: string | undefined,
  parts: readonly ResolvedAuthoredPart[],
  unnamed: string,
  legacyLabel?: (name: string) => string,
  enabled = true,
): readonly ExactBodyOption[] {
  return useMemo(
    () =>
      snapshot && enabled
        ? exactSolidBodyOptions(snapshot, rebuild, editingFeatureId, parts, unnamed, legacyLabel)
        : [],
    [snapshot, rebuild, editingFeatureId, parts, unnamed, legacyLabel, enabled],
  )
}
