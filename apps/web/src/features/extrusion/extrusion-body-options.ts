import type { DocumentRebuildOutcome } from "@vibeshape/application/persistent-document-session"
import type { DocumentSnapshot, FeatureId } from "@vibeshape/domain"
import { terminalBodyOutputs } from "@vibeshape/domain/model-bodies"
import { referenceFrameOptions } from "../reference-geometry/reference-frame-options"
import type { ExtrusionTargetOption } from "./extrusion-form"

export function extrusionBodyOptions(
  snapshot: DocumentSnapshot,
  rebuild: DocumentRebuildOutcome,
  excludedFeatureId: string | undefined,
  label: (name: string | undefined, role: string) => string,
): readonly ExtrusionTargetOption[] {
  if (!rebuild.ok) return []
  const stop = excludedFeatureId
    ? snapshot.features.findIndex(({ id }) => id === excludedFeatureId)
    : -1
  const features = stop >= 0 ? snapshot.features.slice(0, stop) : snapshot.features
  const planes = referenceFrameOptions(snapshot, rebuild, excludedFeatureId).planes
  const byFeature = new Map<string, (ExtrusionTargetOption & { featureId: FeatureId })[]>()
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
        faces: planes.flatMap((plane) =>
          plane.support.kind === "planar-face" &&
          plane.support.reference.featureId === feature.id &&
          plane.support.reference.outputRole === body.outputRole
            ? [{ label: plane.label, reference: plane.support.reference }]
            : [],
        ),
      }))
    byFeature.set(feature.id, options)
  }
  return terminalBodyOutputs(features, byFeature) ?? []
}
