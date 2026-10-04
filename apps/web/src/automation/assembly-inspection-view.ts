import {
  type AssemblyInspectionView,
  assemblyInspectionViewSchema,
} from "@vibeshape/automation-api/assembly-tools"
import { canonicalJson } from "@vibeshape/domain/canonical-json"
import {
  createTopologyReferenceResolver,
  topologySignatureSchema,
  topoRefSchema,
} from "@vibeshape/domain/topology"
import type { AssemblyInspection, TopologyCandidate } from "@vibeshape/protocol"

type TopologyPage = { instanceId: string; sourceIndex: number; offset: number; limit: number }
const frameRecipes: Partial<
  Record<
    NonNullable<TopologyCandidate["referenceGeometry"]>["kind"],
    "planar-face" | "cylindrical-face" | "spherical-face" | "circular-edge" | "vertex"
  >
> = {
  "plane-face": "planar-face",
  "cylinder-face": "cylindrical-face",
  "sphere-face": "spherical-face",
  "circle-edge": "circular-edge",
  "arc-edge": "circular-edge",
  vertex: "vertex",
}
function topologyPage(inspection: AssemblyInspection, input: TopologyPage) {
  const occurrence = inspection.occurrences.find(
    ({ instanceId, sourceIndex }) =>
      instanceId === input.instanceId && sourceIndex === input.sourceIndex,
  )
  if (!occurrence) throw new Error("The requested pinned occurrence/source is unavailable.")
  if (occurrence.representation !== "exact-solid")
    throw new Error("Topology frame references require an exact source body.")
  const candidates = occurrence.topologyCandidates ?? []
  const resolve = createTopologyReferenceResolver(
    candidates.map(({ candidateId, kind, semanticRole, lineageTokens, signature }) => ({
      candidateId,
      kind,
      ...(semanticRole ? { semanticRole } : {}),
      lineageTokens,
      signature: topologySignatureSchema.strip().parse(signature),
    })),
  )
  const references = candidates
    .flatMap((candidate) => {
      const geometry = candidate.referenceGeometry
        ? frameRecipes[candidate.referenceGeometry.kind]
        : undefined
      if (!geometry) return []
      const reference = topoRefSchema.parse({
        schemaVersion: 0,
        featureId: occurrence.selectedBody.featureId,
        kind: candidate.kind,
        ...(candidate.semanticRole ? { semanticRole: candidate.semanticRole } : {}),
        ...(!candidate.semanticRole && candidate.lineageTokens[0]
          ? { lineageToken: candidate.lineageTokens[0] }
          : {}),
        signature: topologySignatureSchema.strip().parse(candidate.signature),
      })
      return [{ reference, geometry, resolution: resolve(reference).status }]
    })
    .sort((left, right) =>
      canonicalJson(left.reference).localeCompare(canonicalJson(right.reference), "en"),
    )
  if (input.offset > references.length)
    throw new Error("The topology page offset exceeds this frozen source.")
  return {
    instanceId: occurrence.instanceId,
    sourceIndex: occurrence.sourceIndex,
    pinRevision: occurrence.pinRevision,
    body: occurrence.selectedBody,
    total: references.length,
    nextOffset: input.offset + input.limit < references.length ? input.offset + input.limit : null,
    references: references.slice(input.offset, input.offset + input.limit),
  }
}

/** Serializable inspection omits meshes, kernel handles and immutable source bytes. */
export function assemblyInspectionView(
  documentId: string,
  revision: number,
  inspection: AssemblyInspection,
  topology?: TopologyPage,
): AssemblyInspectionView {
  return assemblyInspectionViewSchema.parse({
    schemaVersion: 1,
    documentId,
    revision,
    ...(inspection.kinematics ? { kinematics: inspection.kinematics } : {}),
    occurrences: inspection.occurrences.map(
      ({ mesh: _mesh, topologyCandidates: _topology, ...occurrence }) => occurrence,
    ),
    interference: inspection.interference,
    ...(topology ? { topology: topologyPage(inspection, topology) } : {}),
  })
}
