import { bodyFaceRefSchema } from "@vibeshape/domain/body-topology-reference"
import { canonicalJson } from "@vibeshape/domain/canonical-json"
import {
  createTopologyReferenceResolver,
  topologyCandidateSchema,
  topoRefSchema,
} from "@vibeshape/domain/topology"
import type { ShellFeatureContentParameters, TopologyCandidate } from "@vibeshape/protocol"

export type ShellOpeningResolution =
  | { ok: true; candidateIds: readonly string[] }
  | { ok: false; reason: "missing" | "ambiguous" | "changed" | "duplicate" }

/** Shell v1 never repairs or rebinds persisted openings automatically. */
export function resolveShellOpeningCandidates(
  references: ShellFeatureContentParameters["openings"],
  candidates: readonly TopologyCandidate[],
  scope: { featureId: string; outputRole: string },
): ShellOpeningResolution {
  const faces = candidates
    .filter(({ kind }) => kind === "face")
    .map(({ candidateId, kind, semanticRole, lineageTokens, signature }) =>
      topologyCandidateSchema.parse({ candidateId, kind, semanticRole, lineageTokens, signature }),
    )
  const resolver = createTopologyReferenceResolver(faces)
  const selected = new Set<string>()
  for (const reference of references) {
    const parsed = bodyFaceRefSchema.parse({ ...reference, featureId: scope.featureId })
    if (parsed.outputRole !== scope.outputRole) return { ok: false, reason: "missing" }
    const { outputRole: _outputRole, ...topologyReference } = parsed
    const resolution = resolver(topoRefSchema.parse({ ...topologyReference, schemaVersion: 0 }))
    if (resolution.status !== "resolved") return { ok: false, reason: resolution.status }
    const candidate = faces.find(({ candidateId }) => candidateId === resolution.candidateId)
    if (!candidate || canonicalJson(candidate.signature) !== canonicalJson(reference.signature))
      return { ok: false, reason: "changed" }
    if (selected.has(resolution.candidateId)) return { ok: false, reason: "duplicate" }
    selected.add(resolution.candidateId)
  }
  return selected.size > 0
    ? { ok: true, candidateIds: [...selected] }
    : { ok: false, reason: "missing" }
}
