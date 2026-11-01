import { canonicalJson } from "@vibeshape/domain"
import { sha256Text } from "@vibeshape/persistence"
import type { AssemblyInspection } from "@vibeshape/protocol"

/** Identity of the actual solved exact sources and frames, independent of display tessellation. */
export function assemblyClearancePoseDigest(inspection: AssemblyInspection) {
  const poses = inspection.occurrences.map(
    ({
      instanceId,
      definitionId,
      pinRevision,
      sourceIndex,
      selectedBody,
      contentHash,
      representation,
      geometryFrame,
    }) => ({
      instanceId,
      definitionId,
      pinRevision,
      sourceIndex,
      selectedBody,
      contentHash,
      representation,
      geometryFrame,
    }),
  )
  poses.sort(
    (left, right) =>
      left.instanceId.localeCompare(right.instanceId) || left.sourceIndex - right.sourceIndex,
  )
  return sha256Text(canonicalJson(poses))
}
