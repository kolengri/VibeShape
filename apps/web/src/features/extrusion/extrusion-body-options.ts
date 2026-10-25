import {
  createModelBodyTopologyEvidenceResolver,
  type ModelBodyTopologyEvidenceResolver,
} from "@vibeshape/application/model-body-topology"
import type { DocumentRebuildOutcome } from "@vibeshape/application/persistent-document-session"
import type { BodyTopoRef, DocumentSnapshot, FeatureId, FeatureRecord } from "@vibeshape/domain"
import { readExtrusionFeatureParameters } from "@vibeshape/domain"
import { terminalBodyOutputs } from "@vibeshape/domain/model-bodies"
import {
  createBodyTopologyReferenceProjector,
  createBodyTopologyReferenceResolver,
} from "@vibeshape/domain/model-body-topology"
import type { TopologyCandidate } from "@vibeshape/protocol"

export type ExtrusionTargetOption = Readonly<{
  id: FeatureId
  label: string
  outputRole?: string
  contentHash?: string
  faces?: readonly { label: string; reference: BodyTopoRef; meshFaceId?: number }[]
}>

type RebuiltBody = NonNullable<
  Extract<
    DocumentRebuildOutcome,
    { ok: true }
  >["response"]["geometry"][number]["geometry"]["bodies"]
>[number]
type BodyOptionSource = ExtrusionTargetOption & {
  featureId: FeatureId
  feature: FeatureRecord
  body: RebuiltBody
}

export function extrusionBodyOptionKey(option: Pick<ExtrusionTargetOption, "id" | "outputRole">) {
  return option.outputRole ? `${option.id}:${option.outputRole}` : option.id
}

export function extrusionBodyOptions(
  snapshot: DocumentSnapshot,
  rebuild: DocumentRebuildOutcome,
  excludedFeatureId: string | undefined,
  label: (name: string | undefined, role: string) => string,
  legacyLabel: (name: string | undefined) => string,
): readonly ExtrusionTargetOption[] {
  if (!rebuild.ok) return []
  const topology = createModelBodyTopologyEvidenceResolver(snapshot, rebuild)
  const stop = excludedFeatureId
    ? snapshot.features.findIndex(({ id }) => id === excludedFeatureId)
    : -1
  const features = stop >= 0 ? snapshot.features.slice(0, stop) : snapshot.features
  const byFeature = new Map<string, BodyOptionSource[]>()
  for (const feature of features) {
    if (feature.suppressed) continue
    const record = rebuild.response.geometry.find(({ featureId }) => featureId === feature.id)
    if (!record) continue
    const options = (record.geometry.bodies ?? [])
      .filter(({ shape }) => shape.valid && shape.solidCount === 1 && shape.volume > 0)
      .map((body) => ({
        id: feature.id,
        featureId: feature.id,
        outputRole: body.outputRole,
        contentHash: record.contentHash,
        label: label(feature.label, body.outputRole),
        feature,
        body,
      }))
    byFeature.set(feature.id, options)
  }
  const options = (terminalBodyOutputs(features, byFeature) ?? []).map(
    ({ feature, body, ...option }) => ({
      ...option,
      faces: finiteEndFaceOptions(topology, feature, body),
    }),
  )
  const legacy = legacyBodyOption(snapshot.features[stop], features, rebuild, legacyLabel)
  return legacy ? [legacy, ...options] : options
}
function uniqueMeshFaceIds(candidates: readonly TopologyCandidate[]) {
  const counts = new Map<number, number>()
  for (const candidate of candidates) {
    if (candidate.kind !== "face" || candidate.meshFaceId === undefined) continue
    counts.set(candidate.meshFaceId, (counts.get(candidate.meshFaceId) ?? 0) + 1)
  }
  const ids = new Map<string, number>()
  // Face candidate IDs have already passed the exact body's uniqueness validation.
  for (const candidate of candidates) {
    if (
      candidate.kind === "face" &&
      candidate.meshFaceId !== undefined &&
      counts.get(candidate.meshFaceId) === 1
    )
      ids.set(candidate.candidateId, candidate.meshFaceId)
  }
  return ids
}

function finiteEndFaceOptions(
  resolveTopology: ModelBodyTopologyEvidenceResolver,
  feature: FeatureRecord,
  body: RebuiltBody,
) {
  const { outputRole } = body
  const topology = resolveTopology({
    featureId: feature.id,
    outputRole,
    kind: "face",
  })
  if (!topology.ok) return []
  const project = createBodyTopologyReferenceProjector(topology.evidence)
  const resolve = createBodyTopologyReferenceResolver(topology.evidence)
  const meshFaceIds = uniqueMeshFaceIds(body.topologyCandidates)
  return topology.evidence.candidates.flatMap((candidate) => {
    // The face-only evidence and projector already validate the complete reference.
    const reference = project(candidate)
    const resolved = resolve(reference)
    if (resolved.status !== "resolved" || resolved.candidateId !== candidate.candidateId) return []
    const meshFaceId = meshFaceIds.get(candidate.candidateId)
    return [
      {
        label: `${feature.label ?? feature.type.typeId} · ${outputRole} · ${candidate.semanticRole ?? candidate.candidateId}`,
        reference,
        ...(meshFaceId === undefined ? {} : { meshFaceId }),
      },
    ]
  })
}

function legacyBodyOption(
  edited: FeatureRecord | undefined,
  features: readonly FeatureRecord[],
  rebuild: Extract<DocumentRebuildOutcome, { ok: true }>,
  label: (name: string | undefined) => string,
) {
  if (!edited || edited.type.schemaVersion >= 6) return null
  const parameters = readExtrusionFeatureParameters(edited)
  if (!parameters || parameters.operation === "new") return null
  const target = features.find(({ id }) => id === edited.dependencies[0])
  if (!target || !wholeProducerAvailable(rebuild, target)) return null
  // Legacy modifiers bind the complete producer, including every constituent body.
  return { id: target.id, label: label(target.label) }
}

function wholeProducerAvailable(
  rebuild: Extract<DocumentRebuildOutcome, { ok: true }>,
  target: FeatureRecord,
) {
  if (target.suppressed) return false
  const shape = rebuild.response.geometry.find(({ featureId }) => featureId === target.id)?.geometry
    .shape
  return Boolean(shape?.valid && shape.solidCount >= 1 && shape.volume > 0)
}
