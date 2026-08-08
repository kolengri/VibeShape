import { z } from "zod"
import { featureIdSchema } from "./identifiers"

const finiteNumberSchema = z.number().finite()
const vector3Schema = z.tuple([finiteNumberSchema, finiteNumberSchema, finiteNumberSchema])
const geometryClassSchema = z.string().min(1).max(64)
const semanticRoleSchema = z.string().min(1).max(256)
const lineageTokenSchema = z.string().min(1).max(256)

function isNormalized(vector: readonly number[]) {
  return Math.abs(Math.hypot(...vector) - 1) <= 1e-6
}

export const topologyKindSchema = z.enum(["vertex", "edge", "face"])

export const topologySignatureSchema = z
  .object({
    kind: topologyKindSchema,
    geometryClass: geometryClassSchema,
    measure: finiteNumberSchema.nonnegative(),
    centroid: vector3Schema,
    bounds: z
      .object({
        min: vector3Schema,
        max: vector3Schema,
      })
      .strict(),
    direction: vector3Schema.optional(),
    directionMode: z.enum(["oriented", "axis"]).optional(),
    boundaryCount: z.number().int().nonnegative(),
    adjacentGeometryClasses: z.array(geometryClassSchema).max(256),
  })
  .strict()
  .superRefine((signature, context) => {
    if (signature.direction && !signature.directionMode) {
      context.addIssue({
        code: "custom",
        message: "A signature direction requires an explicit direction mode.",
        path: ["directionMode"],
      })
    }
    if (!signature.direction && signature.directionMode) {
      context.addIssue({
        code: "custom",
        message: "A signature direction mode requires a direction.",
        path: ["direction"],
      })
    }
    if (signature.direction) {
      if (!isNormalized(signature.direction)) {
        context.addIssue({
          code: "custom",
          message: "Signature directions must be normalized.",
          path: ["direction"],
        })
      }
    }
    for (let axis = 0; axis < 3; axis += 1) {
      if ((signature.bounds.min[axis] as number) > (signature.bounds.max[axis] as number)) {
        context.addIssue({
          code: "custom",
          message: "Signature bounds must be ordered.",
          path: ["bounds"],
        })
        break
      }
    }
  })

export const topologyIntentSchema = z
  .object({
    nearPoint: vector3Schema.optional(),
    expectedDirection: vector3Schema.optional(),
  })
  .strict()
  .refine((intent) => !intent.expectedDirection || isNormalized(intent.expectedDirection), {
    message: "Intent directions must be normalized.",
    path: ["expectedDirection"],
  })

export const topoRefSchema = z
  .object({
    schemaVersion: z.literal(0),
    featureId: featureIdSchema,
    kind: topologyKindSchema,
    semanticRole: semanticRoleSchema.optional(),
    lineageToken: lineageTokenSchema.optional(),
    signature: topologySignatureSchema,
    intent: topologyIntentSchema.optional(),
  })
  .strict()
  .refine((reference) => reference.kind === reference.signature.kind, {
    message: "TopoRef kind must match its signature kind.",
    path: ["signature", "kind"],
  })

export const topologyCandidateSchema = z
  .object({
    candidateId: z.string().min(1).max(256),
    kind: topologyKindSchema,
    semanticRole: semanticRoleSchema.optional(),
    lineageTokens: z.array(lineageTokenSchema).max(256),
    signature: topologySignatureSchema,
  })
  .strict()
  .refine((candidate) => candidate.kind === candidate.signature.kind, {
    message: "Topology candidate kind must match its signature kind.",
    path: ["signature", "kind"],
  })

export const topologyResolutionPolicySchema = z
  .object({
    version: z.literal(1),
    absoluteTolerance: finiteNumberSchema.positive(),
    maximumScore: finiteNumberSchema.positive().max(1),
    ambiguityMargin: finiteNumberSchema.nonnegative().max(1),
    weights: z
      .object({
        measure: finiteNumberSchema.nonnegative(),
        centroid: finiteNumberSchema.nonnegative(),
        direction: finiteNumberSchema.nonnegative(),
        bounds: finiteNumberSchema.nonnegative(),
        boundary: finiteNumberSchema.nonnegative(),
        adjacency: finiteNumberSchema.nonnegative(),
      })
      .strict(),
  })
  .strict()
  .refine(
    (policy) => Object.values(policy.weights).reduce((sum, weight) => sum + weight, 0) > 0,
    "Topology resolution weights must have a positive sum.",
  )

export const TOPOLOGY_RESOLUTION_POLICY = topologyResolutionPolicySchema.parse({
  version: 1,
  absoluteTolerance: 1e-7,
  maximumScore: 0.22,
  ambiguityMargin: 0.035,
  weights: {
    measure: 0.2,
    centroid: 0.25,
    direction: 0.2,
    bounds: 0.15,
    boundary: 0.1,
    adjacency: 0.1,
  },
})

export type TopoRef = Readonly<z.infer<typeof topoRefSchema>>
export type TopologySignature = Readonly<z.infer<typeof topologySignatureSchema>>
export type TopologyCandidate = Readonly<z.infer<typeof topologyCandidateSchema>>
export type TopologyResolutionPolicy = Readonly<z.infer<typeof topologyResolutionPolicySchema>>

export type TopologyResolution =
  | {
      status: "resolved"
      candidateId: string
      method: "semantic" | "history" | "signature"
      score: number
      confidenceMargin: number | null
    }
  | {
      status: "ambiguous"
      candidateIds: string[]
      method: "semantic" | "history" | "signature"
      bestScore: number | null
      confidenceMargin: number | null
    }
  | {
      status: "missing"
      reason:
        | "no-candidate-of-kind"
        | "semantic-role-missing"
        | "lineage-missing"
        | "no-compatible-signature"
        | "score-threshold"
      bestScore: number | null
    }

function distance(left: readonly number[], right: readonly number[]) {
  return Math.hypot(...left.map((value, index) => value - (right[index] as number)))
}

function boundsDiagonal(signature: z.infer<typeof topologySignatureSchema>) {
  return Math.max(distance(signature.bounds.min, signature.bounds.max), Number.EPSILON)
}

function relativeDifference(left: number, right: number, tolerance: number) {
  return Math.min(1, Math.abs(left - right) / Math.max(Math.abs(left), Math.abs(right), tolerance))
}

function directionDifference(
  reference: z.infer<typeof topologySignatureSchema>,
  candidate: z.infer<typeof topologySignatureSchema>,
) {
  if (!reference.direction && !candidate.direction) {
    return 0
  }
  if (!reference.direction || !candidate.direction) {
    return 1
  }
  const dot = reference.direction.reduce(
    (sum, component, index) => sum + component * (candidate.direction?.[index] as number),
    0,
  )
  const normalizedDot = Math.max(-1, Math.min(1, dot))
  const axisMode = reference.directionMode === "axis" || candidate.directionMode === "axis"
  return axisMode ? 1 - Math.abs(normalizedDot) : (1 - normalizedDot) / 2
}

function countValues(values: readonly string[]) {
  const counts = new Map<string, number>()
  for (const value of values) {
    const previous = counts.get(value)
    counts.set(value, previous === undefined ? 1 : previous + 1)
  }
  return counts
}

function multisetDifference(left: readonly string[], right: readonly string[]) {
  const leftCounts = countValues(left)
  const rightCounts = countValues(right)
  const values = new Set([...leftCounts.keys(), ...rightCounts.keys()])
  const counts = [...values].map((value): [number, number] => [
    leftCounts.get(value) ?? 0,
    rightCounts.get(value) ?? 0,
  ])
  const intersection = counts.reduce(
    (sum, [leftCount, rightCount]) => sum + Math.min(leftCount, rightCount),
    0,
  )
  const union = counts.reduce(
    (sum, [leftCount, rightCount]) => sum + Math.max(leftCount, rightCount),
    0,
  )
  return union === 0 ? 0 : 1 - intersection / union
}

function scoreSignature(
  reference: TopoRef,
  candidate: TopologyCandidate,
  policy: TopologyResolutionPolicy,
) {
  if (
    reference.kind !== candidate.kind ||
    reference.signature.geometryClass !== candidate.signature.geometryClass
  ) {
    return null
  }

  const referenceScale = boundsDiagonal(reference.signature)
  const candidateScale = boundsDiagonal(candidate.signature)
  const scale = Math.max(referenceScale, candidateScale, policy.absoluteTolerance)
  const centroidScore = Math.min(
    1,
    distance(reference.signature.centroid, candidate.signature.centroid) / scale,
  )
  const boundsScore = Math.min(
    1,
    (distance(reference.signature.bounds.min, candidate.signature.bounds.min) +
      distance(reference.signature.bounds.max, candidate.signature.bounds.max)) /
      (2 * scale),
  )
  const boundaryScore = relativeDifference(
    reference.signature.boundaryCount,
    candidate.signature.boundaryCount,
    1,
  )
  const components = {
    measure: relativeDifference(
      reference.signature.measure,
      candidate.signature.measure,
      policy.absoluteTolerance,
    ),
    centroid: reference.intent?.nearPoint
      ? Math.min(1, distance(reference.intent.nearPoint, candidate.signature.centroid) / scale)
      : centroidScore,
    direction: reference.intent?.expectedDirection
      ? directionDifference(
          { ...reference.signature, direction: reference.intent.expectedDirection },
          candidate.signature,
        )
      : directionDifference(reference.signature, candidate.signature),
    bounds: boundsScore,
    boundary: boundaryScore,
    adjacency: multisetDifference(
      reference.signature.adjacentGeometryClasses,
      candidate.signature.adjacentGeometryClasses,
    ),
  }
  const totalWeight = Object.values(policy.weights).reduce((sum, weight) => sum + weight, 0)
  return (
    Object.entries(policy.weights).reduce(
      (sum, [component, weight]) => sum + components[component as keyof typeof components] * weight,
      0,
    ) / totalWeight
  )
}

function rankCandidates(
  reference: TopoRef,
  candidates: TopologyCandidate[],
  policy: TopologyResolutionPolicy,
  method: "history" | "signature",
): TopologyResolution {
  const ranked = candidates
    .map((candidate) => ({ candidate, score: scoreSignature(reference, candidate, policy) }))
    .filter((item): item is { candidate: TopologyCandidate; score: number } => item.score !== null)
    .sort(
      (left, right) =>
        left.score - right.score ||
        left.candidate.candidateId.localeCompare(right.candidate.candidateId),
    )

  if (ranked.length === 0) {
    return { status: "missing", reason: "no-compatible-signature", bestScore: null }
  }
  const best = ranked[0] as (typeof ranked)[number]
  if (best.score > policy.maximumScore) {
    return { status: "missing", reason: "score-threshold", bestScore: best.score }
  }
  const second = ranked[1]
  const confidenceMargin = second ? second.score - best.score : null
  if (second && confidenceMargin !== null && confidenceMargin < policy.ambiguityMargin) {
    return {
      status: "ambiguous",
      candidateIds: ranked
        .filter((item) => item.score - best.score < policy.ambiguityMargin)
        .map((item) => item.candidate.candidateId),
      method,
      bestScore: best.score,
      confidenceMargin,
    }
  }
  return {
    status: "resolved",
    candidateId: best.candidate.candidateId,
    method,
    score: best.score,
    confidenceMargin,
  }
}

export function resolveTopologyReference(
  referenceInput: TopoRef,
  candidateInputs: TopologyCandidate[],
  policyInput: TopologyResolutionPolicy = TOPOLOGY_RESOLUTION_POLICY,
): TopologyResolution {
  const reference = topoRefSchema.parse(referenceInput)
  const candidates = candidateInputs.map((candidate) => topologyCandidateSchema.parse(candidate))
  const policy = topologyResolutionPolicySchema.parse(policyInput)
  const candidateIds = new Set(candidates.map((candidate) => candidate.candidateId))
  if (candidateIds.size !== candidates.length) {
    throw new Error("Topology candidates must have unique evaluation-local identifiers.")
  }

  const kindCandidates = candidates.filter((candidate) => candidate.kind === reference.kind)
  if (kindCandidates.length === 0) {
    return { status: "missing", reason: "no-candidate-of-kind", bestScore: null }
  }

  const semanticResult = resolveSemanticReference(reference, kindCandidates)
  if (semanticResult) return semanticResult

  const historyResult = resolveHistoryReference(reference, kindCandidates, policy)
  if (historyResult) return historyResult

  return rankCandidates(reference, kindCandidates, policy, "signature")
}

function resolvedByExactCandidate(
  candidate: TopologyCandidate,
  method: "semantic" | "history",
): TopologyResolution {
  return {
    status: "resolved",
    candidateId: candidate.candidateId,
    method,
    score: 0,
    confidenceMargin: null,
  }
}

function resolveSemanticReference(
  reference: TopoRef,
  candidates: TopologyCandidate[],
): TopologyResolution | null {
  if (!reference.semanticRole) return null
  const matches = candidates.filter(
    (candidate) => candidate.semanticRole === reference.semanticRole,
  )
  if (matches.length === 0) {
    return { status: "missing", reason: "semantic-role-missing", bestScore: null }
  }
  if (matches.length === 1)
    return resolvedByExactCandidate(matches[0] as TopologyCandidate, "semantic")
  return {
    status: "ambiguous",
    candidateIds: matches.map((candidate) => candidate.candidateId).sort(),
    method: "semantic",
    bestScore: null,
    confidenceMargin: null,
  }
}

function resolveHistoryReference(
  reference: TopoRef,
  candidates: TopologyCandidate[],
  policy: TopologyResolutionPolicy,
): TopologyResolution | null {
  if (!reference.lineageToken) return null
  const matches = candidates.filter((candidate) =>
    candidate.lineageTokens.includes(reference.lineageToken as string),
  )
  if (matches.length === 0) {
    return { status: "missing", reason: "lineage-missing", bestScore: null }
  }
  if (matches.length === 1)
    return resolvedByExactCandidate(matches[0] as TopologyCandidate, "history")
  return rankCandidates(reference, matches, policy, "history")
}
