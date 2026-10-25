import {
  createModelBodyTopologyEvidenceResolver,
  type ModelBodyTopologyEvidenceResolver,
} from "@vibeshape/application/model-body-topology"
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
type Geometry = Rebuilt["response"]["geometry"][number]
type Body = NonNullable<Geometry["geometry"]["bodies"]>[number]
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
    topology: ModelBodyTopologyEvidenceResolver
    feature: FeatureRecord
    body: Body
    kind: "face" | "edge"
  },
  options: MutableOptions,
) {
  const { topology, feature, body, kind } = context
  const result = topology({
    featureId: feature.id,
    outputRole: body.outputRole,
    kind,
  })
  if (!result.ok) return
  const eligible = result.evidence.candidates.filter(({ kind, signature }) =>
    kind === "face"
      ? signature.geometryClass === "PLANE" &&
        signature.directionMode === "oriented" &&
        Boolean(signature.direction)
      : signature.geometryClass === "LINE" && Boolean(signature.direction),
  )
  if (eligible.length === 0) return
  // Identity and ambiguity depend on the complete validated evidence, including ineligible peers.
  const project = createBodyTopologyReferenceProjector(result.evidence)
  const resolve = createBodyTopologyReferenceResolver(result.evidence)
  const meshFaceIds = new Map<string, number | undefined>()
  if (kind === "face")
    for (const candidate of body.topologyCandidates) {
      // Preserve the original find's first match across topology kinds, even without a mesh ID.
      if (!meshFaceIds.has(candidate.candidateId))
        meshFaceIds.set(candidate.candidateId, candidate.meshFaceId)
    }
  for (const candidate of eligible) {
    const reference = project(candidate),
      resolved = resolve(reference)
    if (resolved.status !== "resolved" || resolved.candidateId !== candidate.candidateId) continue
    addCandidateOptions(feature, body, candidate, reference, options, meshFaceIds)
  }
}
function addCandidateOptions(
  feature: FeatureRecord,
  body: Body,
  candidate: ModelBodyTopologyEvidence["candidates"][number],
  reference: BodyTopoRef,
  options: MutableOptions,
  meshFaceIds: ReadonlyMap<string, number | undefined>,
) {
  const key = JSON.stringify([feature.id, body.outputRole, candidate.candidateId])
  const label = `${feature.label ?? feature.type.typeId} · ${body.outputRole} · ${candidate.semanticRole ?? candidate.candidateId}`
  if (candidate.kind === "face") {
    const plane = referencePlaneSchema.safeParse({ kind: "planar-face", reference })
    if (plane.success) {
      const meshFaceId = meshFaceIds.get(candidate.candidateId)
      options.planes.push({
        key,
        label,
        support: plane.data,
        ...(meshFaceId === undefined ? {} : { meshFaceId }),
      })
    }
  } else {
    const axis = referenceAxisSchema.safeParse({ kind: "linear-edge", reference })
    if (axis.success) options.axes.push({ key, label, support: axis.data })
  }
}
function addFeatureOptions(
  topology: ModelBodyTopologyEvidenceResolver,
  geometries: ReadonlyMap<string, Geometry>,
  feature: FeatureRecord,
  options: MutableOptions,
) {
  if (feature.suppressed) return
  const record = geometries.get(feature.id)
  if (!record) return
  if (readDatumPlaneFeatureParameters(feature)) addDatumOptions(feature, options)
  for (const body of record.geometry.bodies ?? [])
    for (const kind of ["face", "edge"] as const)
      addBodyOptions({ topology, feature, body, kind }, options)
}
export function referenceFrameOptions(
  snapshot: DocumentSnapshot,
  rebuild: DocumentRebuildOutcome,
  excludedFeatureId?: string,
): ReferenceFrameOptions {
  const options: MutableOptions = { planes: [], axes: [] }
  if (!rebuild.ok) return options
  const topology = createModelBodyTopologyEvidenceResolver(snapshot, rebuild)
  const geometries = new Map<string, Geometry>()
  for (const record of rebuild.response.geometry) {
    // Keep the first raw record, including on invalid evidence paths where datum options still exist.
    if (!geometries.has(record.featureId)) geometries.set(record.featureId, record)
  }
  const stop = excludedFeatureId
    ? snapshot.features.findIndex(({ id }) => id === excludedFeatureId)
    : -1
  const features = stop >= 0 ? snapshot.features.slice(0, stop) : snapshot.features
  for (const feature of features) addFeatureOptions(topology, geometries, feature, options)
  return options
}
