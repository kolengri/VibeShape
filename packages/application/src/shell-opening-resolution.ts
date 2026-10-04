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
export type ShellOpeningResolutionMode = "exact" | "durable"
export type ShellOpeningResolutionOptions = Readonly<{ allowSemanticRebinding?: boolean }>

function resolveDurableFace(
  reference: ShellFeatureContentParameters["openings"][number],
  faces: readonly TopologyCandidate[],
  allowSemanticRebinding: boolean,
): ShellOpeningResolution {
  const identities = [
    ...(reference.semanticRole && allowSemanticRebinding
      ? [faces.filter(({ semanticRole }) => semanticRole === reference.semanticRole)]
      : []),
    ...(reference.lineageToken
      ? [faces.filter(({ lineageTokens }) => lineageTokens.includes(reference.lineageToken ?? ""))]
      : []),
  ]
  if (identities.length === 0 || identities.some((matches) => matches.length === 0))
    return { ok: false, reason: "missing" }
  if (identities.some((matches) => matches.length !== 1)) return { ok: false, reason: "ambiguous" }
  const candidateIds = new Set(
    identities.flatMap((matches) => matches.map(({ candidateId }) => candidateId)),
  )
  return candidateIds.size === 1
    ? { ok: true, candidateIds: [...candidateIds] }
    : { ok: false, reason: "ambiguous" }
}

function resolveExactFace(
  reference: ShellFeatureContentParameters["openings"][number],
  faces: readonly TopologyCandidate[],
  resolver: ReturnType<typeof createTopologyReferenceResolver>,
): ShellOpeningResolution {
  const { outputRole: _outputRole, ...topologyReference } = reference
  const resolution = resolver(topoRefSchema.parse({ ...topologyReference, schemaVersion: 0 }))
  if (resolution.status !== "resolved") return { ok: false, reason: resolution.status }
  const candidate = faces.find(({ candidateId }) => candidateId === resolution.candidateId)
  if (!candidate || canonicalJson(candidate.signature) !== canonicalJson(reference.signature))
    return { ok: false, reason: "changed" }
  return { ok: true, candidateIds: [resolution.candidateId] }
}

/** Shell v1 never repairs or rebinds persisted openings automatically. */
export function resolveShellOpeningCandidates(
  references: ShellFeatureContentParameters["openings"],
  candidates: readonly TopologyCandidate[],
  scope: { featureId: string; outputRole: string },
  mode: ShellOpeningResolutionMode = "exact",
  options: ShellOpeningResolutionOptions = {},
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
    const resolution =
      mode === "durable"
        ? resolveDurableFace(parsed, faces, options.allowSemanticRebinding !== false)
        : resolveExactFace(parsed, faces, resolver)
    if (!resolution.ok) return resolution
    const candidateId = resolution.candidateIds[0]
    if (!candidateId) return { ok: false, reason: "missing" }
    if (selected.has(candidateId)) return { ok: false, reason: "duplicate" }
    selected.add(candidateId)
  }
  return selected.size > 0
    ? { ok: true, candidateIds: [...selected] }
    : { ok: false, reason: "missing" }
}
