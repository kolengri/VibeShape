import { z } from "zod"
import { bodyOutputRoleSchema } from "./body-reference"
import { canonicalJson } from "./canonical-json"
import { sha256Schema } from "./feature-content-identity"
import { documentIdSchema, featureIdSchema, revisionSchema } from "./identifiers"
import {
  createTopologyReferenceResolver,
  type TopologyCandidate,
  type TopologyResolution,
  topologyCandidateSchema,
  topoRefSchema,
} from "./topology"

const inspectedTopologyKindSchema = z.enum(["edge", "face"])

export const bodyTopoRefSchema = z
  .object({
    ...topoRefSchema.shape,
    schemaVersion: z.literal(1),
    outputRole: bodyOutputRoleSchema,
    kind: inspectedTopologyKindSchema,
  })
  .strict()
  .refine((reference) => reference.kind === reference.signature.kind, {
    message: "Body TopoRef kind must match its signature kind.",
    path: ["signature", "kind"],
  })

const bodyTopologyCandidatesSchema = z
  .array(topologyCandidateSchema)
  .max(10_000)
  .superRefine((candidates, context) => {
    const ids = new Set<string>()
    const kind = candidates[0]?.kind
    for (const [index, candidate] of candidates.entries()) {
      if (ids.has(candidate.candidateId)) {
        context.addIssue({
          code: "custom",
          path: [index, "candidateId"],
          message: "Body topology candidate IDs must be unique.",
        })
      }
      ids.add(candidate.candidateId)
      if (kind !== undefined && candidate.kind !== kind) {
        context.addIssue({
          code: "custom",
          path: [index, "kind"],
          message: "Body topology evidence must contain one topology kind.",
        })
      }
    }
  })

export const modelBodyTopologyEvidenceSchema = z
  .object({
    schemaVersion: z.literal(1),
    documentId: documentIdSchema,
    revision: revisionSchema,
    generation: revisionSchema,
    rebuildId: z.string().min(1).max(128),
    featureId: featureIdSchema,
    contentHash: sha256Schema,
    outputRole: bodyOutputRoleSchema,
    kind: inspectedTopologyKindSchema,
    candidates: bodyTopologyCandidatesSchema,
  })
  .strict()
  .superRefine((evidence, context) => {
    for (const [index, candidate] of evidence.candidates.entries()) {
      if (candidate.kind !== evidence.kind) {
        context.addIssue({
          code: "custom",
          path: ["candidates", index, "kind"],
          message: "Body topology candidate kind must match evidence kind.",
        })
      }
    }
  })

export const modelBodyTopologyEvidenceResultSchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), evidence: modelBodyTopologyEvidenceSchema }).strict(),
  z
    .object({
      ok: z.literal(false),
      code: z.enum([
        "geometry-unavailable",
        "stale-geometry",
        "invalid-geometry-evidence",
        "body-not-found",
      ]),
    })
    .strict(),
])

export type BodyTopoRef = Readonly<z.infer<typeof bodyTopoRefSchema>>
export type ModelBodyTopologyEvidence = Readonly<z.infer<typeof modelBodyTopologyEvidenceSchema>>
export type ModelBodyTopologyEvidenceResult = Readonly<
  z.infer<typeof modelBodyTopologyEvidenceResultSchema>
>

export type BodyTopologyResolution =
  | TopologyResolution
  | {
      status: "missing"
      reason: "body-scope-mismatch"
      bestScore: null
    }

function countsForKind(
  candidates: readonly TopologyCandidate[],
  kind: ModelBodyTopologyEvidence["kind"],
) {
  const semanticCounts = new Map<string, number>()
  const lineageCounts = new Map<string, number>()
  for (const candidate of candidates) {
    if (candidate.kind !== kind) continue
    if (candidate.semanticRole) {
      semanticCounts.set(
        candidate.semanticRole,
        (semanticCounts.get(candidate.semanticRole) ?? 0) + 1,
      )
    }
    for (const token of candidate.lineageTokens) {
      lineageCounts.set(token, (lineageCounts.get(token) ?? 0) + 1)
    }
  }
  return { semanticCounts, lineageCounts }
}

export function createBodyTopologyReferenceProjector(evidenceInput: ModelBodyTopologyEvidence) {
  const evidence = modelBodyTopologyEvidenceSchema.parse(evidenceInput)
  const { semanticCounts, lineageCounts } = countsForKind(evidence.candidates, evidence.kind)
  const candidateIdentity = new Map(
    evidence.candidates.map((candidate) => [candidate.candidateId, canonicalJson(candidate)]),
  )
  return (candidateInput: TopologyCandidate): BodyTopoRef => {
    const candidate = topologyCandidateSchema.parse(candidateInput)
    if (candidateIdentity.get(candidate.candidateId) !== canonicalJson(candidate)) {
      throw new Error("Body topology candidate does not belong to the exact evidence set.")
    }
    const semanticRole =
      candidate.semanticRole && semanticCounts.get(candidate.semanticRole) === 1
        ? candidate.semanticRole
        : undefined
    const lineageToken = candidate.lineageTokens.find((token) => lineageCounts.get(token) === 1)
    return bodyTopoRefSchema.parse({
      schemaVersion: 1,
      featureId: evidence.featureId,
      outputRole: evidence.outputRole,
      kind: candidate.kind,
      ...(semanticRole ? { semanticRole } : {}),
      ...(lineageToken ? { lineageToken } : {}),
      signature: candidate.signature,
    })
  }
}

export function createBodyTopologyReferenceResolver(evidenceInput: ModelBodyTopologyEvidence) {
  const evidence = modelBodyTopologyEvidenceSchema.parse(evidenceInput)
  const resolveV0 = createTopologyReferenceResolver(evidence.candidates)
  return (referenceInput: BodyTopoRef): BodyTopologyResolution => {
    const reference = bodyTopoRefSchema.parse(referenceInput)
    if (
      reference.featureId !== evidence.featureId ||
      reference.outputRole !== evidence.outputRole ||
      reference.kind !== evidence.kind
    ) {
      return { status: "missing", reason: "body-scope-mismatch", bestScore: null }
    }
    const legacyReference = topoRefSchema.parse({
      schemaVersion: 0,
      featureId: reference.featureId,
      kind: reference.kind,
      ...(reference.semanticRole ? { semanticRole: reference.semanticRole } : {}),
      ...(reference.lineageToken ? { lineageToken: reference.lineageToken } : {}),
      signature: reference.signature,
      ...(reference.intent ? { intent: reference.intent } : {}),
    })
    return resolveV0(legacyReference)
  }
}
