import { featureIdSchema } from "@vibeshape/domain/identifiers"
import {
  createTopologyReferenceResolver,
  type TopoRef,
  topologyCandidateSchema,
} from "@vibeshape/domain/topology"
import type { TopologyCandidate as ProtocolTopologyCandidate } from "@vibeshape/protocol"

type SelectedReference = Readonly<{
  schemaVersion: 0
  kind: "edge"
  semanticRole?: string | undefined
  lineageToken?: string | undefined
  signature: TopoRef["signature"]
  intent?: TopoRef["intent"] | undefined
  inputIndex: number
}>

export function resolveSelectedEdgeCandidates(
  references: readonly SelectedReference[],
  candidates: readonly ProtocolTopologyCandidate[],
  sourceFeatureId: string,
): readonly string[] {
  if (references.length === 0 || references.length > 256) {
    throw new Error("Selected edge treatment requires 1–256 references.")
  }
  const domainCandidates = candidates.map(
    ({ candidateId, kind, semanticRole, lineageTokens, signature }) =>
      topologyCandidateSchema.parse({ candidateId, kind, semanticRole, lineageTokens, signature }),
  )
  const resolver = createTopologyReferenceResolver(domainCandidates)
  const featureId = featureIdSchema.parse(sourceFeatureId)
  const selectedIds: string[] = []
  const resolvedCandidateIds = new Set<string>()
  for (const reference of references) {
    if (reference.inputIndex !== 0 || reference.kind !== "edge") {
      throw new Error("Selected edge treatment references must target edges in input 0.")
    }
    const { inputIndex: _inputIndex, ...topologyReference } = reference
    const resolution = resolver({ ...topologyReference, featureId })
    if (resolution.status === "ambiguous") {
      throw new Error("Selected edge treatment reference is ambiguous and requires repair.")
    }
    if (resolution.status === "missing") {
      throw new Error(
        "Selected edge treatment reference is missing from the exact source topology.",
      )
    }
    if (resolvedCandidateIds.has(resolution.candidateId)) {
      throw new Error("Selected edge treatment references resolve to duplicate edges.")
    }
    resolvedCandidateIds.add(resolution.candidateId)
    selectedIds.push(resolution.candidateId)
  }
  return selectedIds
}
