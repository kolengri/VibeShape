import { createModelBodyTopologyEvidenceResolver } from "@vibeshape/application/model-body-topology"
import type { DocumentSnapshot } from "@vibeshape/domain"
import { bodyFaceRefSchema } from "@vibeshape/domain/body-topology-reference"
import { createBodyTopologyReferenceProjector } from "@vibeshape/domain/model-body-topology"
import type { DocumentWorkerResponse } from "@vibeshape/protocol"
import { type LoftSupportOption, loftSupportKey } from "./loft-constraint-model"

type Rebuild =
  | { ok: false }
  | { ok: true; response: Extract<DocumentWorkerResponse, { type: "documentRebuilt" }> }
export function loftSupportCatalogue(
  snapshot: DocumentSnapshot,
  rebuild: Rebuild,
  editingId: string | null,
  label: (
    body: string,
    role: string,
    number: number,
    centroid: readonly [number, number, number],
  ) => string,
): LoftSupportOption[] {
  if (!rebuild.ok) return []
  const topology = createModelBodyTopologyEvidenceResolver(snapshot, rebuild)
  const index = editingId
    ? snapshot.features.findIndex(({ id }) => id === editingId)
    : snapshot.features.length
  const prior = new Map<string, DocumentSnapshot["features"][number]>(
    snapshot.features.slice(0, index).map((feature) => [feature.id, feature]),
  )
  return rebuild.response.geometry.flatMap((geometry) => {
    const feature = prior.get(geometry.featureId)
    if (!feature) return []
    return (
      geometry.geometry.bodies?.flatMap(({ outputRole }) => {
        const result = topology({
          featureId: feature.id,
          outputRole,
          kind: "face",
        })
        if (!result.ok) return []
        const project = createBodyTopologyReferenceProjector(result.evidence)
        return result.evidence.candidates.map((candidate, number) => {
          const reference = bodyFaceRefSchema.parse(project(candidate))
          return {
            key: loftSupportKey(reference),
            reference,
            label: label(
              feature.label ?? feature.id,
              outputRole,
              number + 1,
              candidate.signature.centroid,
            ),
          }
        })
      }) ?? []
    )
  })
}
