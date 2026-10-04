import { createModelBodyTopologyEvidence } from "@vibeshape/application/model-body-topology"
import type { DocumentRebuildOutcome } from "@vibeshape/application/persistent-document-session"
import type { DocumentSnapshot } from "@vibeshape/domain"
import { readDatumPlaneFeatureParameters } from "@vibeshape/domain"
import {
  createBodyTopologyReferenceProjector,
  createBodyTopologyReferenceResolver,
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
export function referenceFrameOptions(
  snapshot: DocumentSnapshot,
  rebuild: DocumentRebuildOutcome,
  excludedFeatureId?: string,
): ReferenceFrameOptions {
  const planes: ReferenceFrameOption<ReferencePlane>[] = [],
    axes: ReferenceFrameOption<ReferenceAxis>[] = []
  if (!rebuild.ok) return { planes, axes }
  const stop = excludedFeatureId
    ? snapshot.features.findIndex(({ id }) => id === excludedFeatureId)
    : -1
  const features = stop >= 0 ? snapshot.features.slice(0, stop) : snapshot.features
  for (const feature of features) {
    if (feature.suppressed) continue
    const record = rebuild.response.geometry.find(({ featureId }) => featureId === feature.id)
    if (!record) continue
    if (readDatumPlaneFeatureParameters(feature)) {
      planes.push({
        key: `datum:${feature.id}`,
        label: feature.label ?? feature.type.typeId,
        support: { kind: "datum-plane", featureId: feature.id },
      })
      for (const axis of ["x", "y", "normal"] as const)
        axes.push({
          key: `datum:${feature.id}:${axis}`,
          label: `${feature.label} · ${axis}`,
          support: { kind: "datum-axis", featureId: feature.id, axis },
        })
    }
    for (const body of record.geometry.bodies ?? [])
      for (const kind of ["face", "edge"] as const) {
        const evidence = createModelBodyTopologyEvidence(snapshot, rebuild, {
          featureId: feature.id,
          outputRole: body.outputRole,
          kind,
        })
        if (!evidence.ok) continue
        const project = createBodyTopologyReferenceProjector(evidence.evidence),
          resolve = createBodyTopologyReferenceResolver(evidence.evidence)
        for (const candidate of evidence.evidence.candidates) {
          const reference = project(candidate)
          const resolved = resolve(reference)
          if (resolved.status !== "resolved" || resolved.candidateId !== candidate.candidateId)
            continue
          const key = JSON.stringify([feature.id, body.outputRole, candidate.candidateId])
          const label = `${feature.label} · ${body.outputRole} · ${candidate.semanticRole ?? candidate.candidateId}`
          const plane = referencePlaneSchema.safeParse({ kind: "planar-face", reference })
          if (plane.success) {
            const meshFaceId = body.topologyCandidates.find(
              ({ candidateId }) => candidateId === candidate.candidateId,
            )?.meshFaceId
            planes.push({
              key,
              label,
              support: plane.data,
              ...(meshFaceId === undefined ? {} : { meshFaceId }),
            })
          }
          const axis = referenceAxisSchema.safeParse({ kind: "linear-edge", reference })
          if (axis.success) axes.push({ key, label, support: axis.data })
        }
      }
  }
  return { planes, axes }
}
