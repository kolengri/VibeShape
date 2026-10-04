import type { TopologyCandidate } from "@vibeshape/domain/topology"
import type { TopologyCandidate as WorkerTopologyCandidate } from "@vibeshape/protocol"

/** Resolution consumes semantic evidence; analytical frame recipes stay worker-owned. */
export function projectTopologyCandidate({
  candidateId,
  kind,
  semanticRole,
  lineageTokens,
  signature,
}: WorkerTopologyCandidate): TopologyCandidate {
  return { candidateId, kind, ...(semanticRole ? { semanticRole } : {}), lineageTokens, signature }
}
