import { createModelBodyTopologyEvidence } from "@vibeshape/application/model-body-topology"
import type { DocumentRebuildOutcome } from "@vibeshape/application/persistent-document-session"
import type { DocumentSnapshot, FeatureRecord } from "@vibeshape/domain"
import { readDatumPlaneFeatureParameters } from "@vibeshape/domain"
import {
  type BodyTopoRef,
  createBodyTopologyReferenceProjector,
  createBodyTopologyReferenceResolver,
  type ModelBodyTopologyEvidence,
} from "@vibeshape/domain/model-body-topology"
import {
  type ReferenceAxis,
  type ReferencePlane,
  referenceAxisSchema,
  referencePlaneSchema,
} from "@vibeshape/domain/reference-frame"

export type ReferenceFrameOption<T> = Readonly<{
  key: string
  label: string
  support: T
  meshFaceId?: number
}>
export type ReferenceFrameOptions = Readonly<{
  planes: readonly ReferenceFrameOption<ReferencePlane>[]
  axes: readonly ReferenceFrameOption<ReferenceAxis>[]
}>
type MutableOptions = {
  planes: ReferenceFrameOption<ReferencePlane>[]
  axes: ReferenceFrameOption<ReferenceAxis>[]
}
type Rebuilt = Extract<DocumentRebuildOutcome, { ok: true }>
type Body = NonNullable<Rebuilt["response"]["geometry"][number]["geometry"]["bodies"]>[number]
function addDatumOptions(feature: FeatureRecord, options: MutableOptions) {
  const label = feature.label ?? feature.type.typeId
  options.planes.push({
    key: `datum:${feature.id}`,
    label,
    support: { kind: "datum-plane", featureId: feature.id },
  })
  for (const axis of ["x", "y", "normal"] as const)
    options.axes.push({
      key: `datum:${feature.id}:${axis}`,
      label: `${label} · ${axis}`,
      support: { kind: "datum-axis", featureId: feature.id, axis },
    })
}
function addBodyOptions(
  context: {
    snapshot: DocumentSnapshot
    rebuild: Rebuilt
    feature: FeatureRecord
    body: Body
    kind: "face" | "edge"
  },
  options: MutableOptions,
) {
  const { snapshot, rebuild, feature, body, kind } = context
  const result = createModelBodyTopologyEvidence(snapshot, rebuild, {
    featureId: feature.id,
    outputRole: body.outputRole,
    kind,
  })
  if (!result.ok) return
  const project = createBodyTopologyReferenceProjector(result.evidence)
  const resolve = createBodyTopologyReferenceResolver(result.evidence)
  for (const candidate of result.evidence.candidates) {
    const reference = project(candidate),
      resolved = resolve(reference)
    if (resolved.status !== "resolved" || resolved.candidateId !== candidate.candidateId) continue
    addCandidateOptions(feature, body, candidate, reference, options)
  }
}
function addCandidateOptions(
  feature: FeatureRecord,
  body: Body,
  candidate: ModelBodyTopologyEvidence["candidates"][number],
  reference: BodyTopoRef,
  options: MutableOptions,
) {
  const key = JSON.stringify([feature.id, body.outputRole, candidate.candidateId])
  const label = `${feature.label ?? feature.type.typeId} · ${body.outputRole} · ${candidate.semanticRole ?? candidate.candidateId}`
  const plane = referencePlaneSchema.safeParse({ kind: "planar-face", reference })
  if (plane.success) {
    const meshFaceId = body.topologyCandidates.find(
      ({ candidateId }) => candidateId === candidate.candidateId,
    )?.meshFaceId
    options.planes.push({
      key,
      label,
      support: plane.data,
      ...(meshFaceId === undefined ? {} : { meshFaceId }),
    })
  }
  const axis = referenceAxisSchema.safeParse({ kind: "linear-edge", reference })
  if (axis.success) options.axes.push({ key, label, support: axis.data })
}
function addFeatureOptions(
  snapshot: DocumentSnapshot,
  rebuild: Rebuilt,
  feature: FeatureRecord,
  options: MutableOptions,
) {
  if (feature.suppressed) return
  const record = rebuild.response.geometry.find(({ featureId }) => featureId === feature.id)
  if (!record) return
  if (readDatumPlaneFeatureParameters(feature)) addDatumOptions(feature, options)
  for (const body of record.geometry.bodies ?? [])
    for (const kind of ["face", "edge"] as const)
      addBodyOptions({ snapshot, rebuild, feature, body, kind }, options)
}
export function referenceFrameOptions(
  snapshot: DocumentSnapshot,
  rebuild: DocumentRebuildOutcome,
  excludedFeatureId?: string,
): ReferenceFrameOptions {
  const options: MutableOptions = { planes: [], axes: [] }
  if (!rebuild.ok) return options
  const stop = excludedFeatureId
    ? snapshot.features.findIndex(({ id }) => id === excludedFeatureId)
    : -1
  const features = stop >= 0 ? snapshot.features.slice(0, stop) : snapshot.features
  for (const feature of features) addFeatureOptions(snapshot, rebuild, feature, options)
  return options
}
