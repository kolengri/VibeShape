import { z } from "zod"
import { documentIdSchema, type FeatureId, featureIdSchema, revisionSchema } from "./identifiers"
import { edgeTopoRefSchema, type TopologyCandidate, topologyCandidateSchema } from "./topology"

const edgeCandidatesSchema = z
  .array(topologyCandidateSchema)
  .max(10_000)
  .superRefine((candidates, context) => {
    const ids = new Set<string>()
    for (const candidate of candidates) {
      if (candidate.kind !== "edge" || ids.has(candidate.candidateId)) {
        context.addIssue({
          code: "custom",
          message: "Edge evidence requires distinct edge candidates.",
        })
        return
      }
      ids.add(candidate.candidateId)
    }
  })

export const modelEdgeEvidenceSchema = z
  .object({
    schemaVersion: z.literal(1),
    documentId: documentIdSchema,
    revision: revisionSchema,
    generation: revisionSchema,
    rebuildId: z.string().min(1).max(128),
    featureId: featureIdSchema,
    contentHash: z.string().regex(/^[a-f0-9]{64}$/),
    candidates: edgeCandidatesSchema,
  })
  .strict()

export const modelEdgeEvidenceResultSchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), evidence: modelEdgeEvidenceSchema }).strict(),
  z
    .object({
      ok: z.literal(false),
      code: z.enum(["geometry-unavailable", "stale-geometry", "invalid-geometry-evidence"]),
    })
    .strict(),
])
export type ModelEdgeEvidenceResult = z.infer<typeof modelEdgeEvidenceResultSchema>

/** Uniqueness must be calculated across the whole current edge set, never just a page. */
export function createEdgeReferenceProjector(
  featureId: FeatureId,
  candidates: readonly TopologyCandidate[],
) {
  const semanticCounts = new Map<string, number>()
  const lineageCounts = new Map<string, number>()
  for (const candidate of candidates) {
    if (candidate.kind !== "edge") continue
    if (candidate.semanticRole)
      semanticCounts.set(
        candidate.semanticRole,
        (semanticCounts.get(candidate.semanticRole) ?? 0) + 1,
      )
    for (const token of candidate.lineageTokens)
      lineageCounts.set(token, (lineageCounts.get(token) ?? 0) + 1)
  }
  return (candidate: TopologyCandidate) => {
    const semanticRole =
      candidate.semanticRole && semanticCounts.get(candidate.semanticRole) === 1
        ? candidate.semanticRole
        : undefined
    const lineageToken = candidate.lineageTokens.find((token) => lineageCounts.get(token) === 1)
    return edgeTopoRefSchema.parse({
      schemaVersion: 0,
      featureId,
      kind: "edge",
      ...(semanticRole ? { semanticRole } : {}),
      ...(lineageToken ? { lineageToken } : {}),
      signature: candidate.signature,
    })
  }
}
