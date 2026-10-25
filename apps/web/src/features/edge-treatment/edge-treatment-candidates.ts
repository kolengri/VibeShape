import {
  canonicalJson,
  createTopologyReferenceResolver,
  type EdgeTopoRef,
  edgeTopoRefSchema,
  featureIdSchema,
  type TopologyCandidate,
  topologyCandidateSchema,
  topoRefSchema,
} from "@vibeshape/domain"
import type { BodyTopoRef } from "@vibeshape/domain/body-topology-reference"
import {
  createBodyTopologyReferenceProjector,
  createBodyTopologyReferenceResolver,
} from "@vibeshape/domain/model-body-topology"
import { createEdgeReferenceProjector } from "@vibeshape/domain/model-edges"
import type { EdgeTreatmentTargetOption } from "./edge-treatment-options"

type WireCandidate = TopologyCandidate &
  Readonly<{ edgePolyline?: readonly [number, number, number][] | undefined }>
export type EdgeTreatmentGeometry = Readonly<{
  featureId: string
  geometry: Readonly<{
    topologyCandidates: readonly WireCandidate[]
    bodies?:
      | readonly Readonly<{
          outputRole: string
          topologyCandidates: readonly WireCandidate[]
        }>[]
      | undefined
  }>
}>

export type SelectedEdgeCandidate = Readonly<{
  candidateId: string
  label: string
  reference: EdgeTopoRef
  candidate: TopologyCandidate
  edgePolyline: readonly [number, number, number][] | undefined
}>

export function selectedEdgeCandidates(
  geometry: readonly EdgeTreatmentGeometry[],
  targetFeatureId: string,
  label: (ordinal: number) => string,
): readonly SelectedEdgeCandidate[] {
  const parsedTarget = featureIdSchema.safeParse(targetFeatureId)
  const record = parsedTarget.success
    ? geometry.find(({ featureId }) => featureId === targetFeatureId)
    : undefined
  if (!record || !parsedTarget.success) return []
  const edges = record.geometry.topologyCandidates.filter(({ kind }) => kind === "edge")
  const projectReference = createEdgeReferenceProjector(parsedTarget.data, edges)
  return edges.map((candidate, index) => {
    const domainCandidate = topologyCandidateSchema.parse({
      candidateId: candidate.candidateId,
      kind: candidate.kind,
      ...(candidate.meshFaceId === undefined ? {} : { meshFaceId: candidate.meshFaceId }),
      ...(candidate.semanticRole ? { semanticRole: candidate.semanticRole } : {}),
      lineageTokens: candidate.lineageTokens,
      signature: candidate.signature,
    })
    const edgePolyline = candidate.edgePolyline
    return {
      candidateId: candidate.candidateId,
      label: label(index + 1),
      reference: projectReference(domainCandidate),
      candidate: domainCandidate,
      edgePolyline,
    }
  })
}

export type EdgeTreatmentCandidate = Readonly<{
  candidateId: string
  id: string
  optionId: string
  label: string
  reference: EdgeTopoRef | BodyTopoRef
  candidate: TopologyCandidate
  resolveStatus: () => "resolved" | "missing" | "ambiguous"
  edgePolyline?: readonly [number, number, number][] | undefined
}>

function cachedStatus(
  read: EdgeTreatmentCandidate["resolveStatus"],
): EdgeTreatmentCandidate["resolveStatus"] {
  let status: ReturnType<EdgeTreatmentCandidate["resolveStatus"]> | undefined
  return () => (status ??= read())
}

export function edgeTreatmentCandidates(
  options: readonly EdgeTreatmentTargetOption[],
  geometry: readonly EdgeTreatmentGeometry[],
  label: (kind: "edge" | "face", ordinal: number, option: EdgeTreatmentTargetOption) => string,
  kind?: "edge" | "face",
): readonly EdgeTreatmentCandidate[] {
  return options.flatMap<EdgeTreatmentCandidate>((option) => {
    if (!option.body) {
      if (kind === "face") return []
      const legacy = selectedEdgeCandidates(geometry, option.id, (n) => label("edge", n, option))
      const resolve = createTopologyReferenceResolver(legacy.map(({ candidate }) => candidate))
      return legacy.map((entry) => ({
        ...entry,
        id: JSON.stringify([option.id, entry.candidateId]),
        optionId: option.id,
        resolveStatus: cachedStatus(() => resolve(entry.reference).status),
      }))
    }
    const source = geometry.find(({ featureId }) => featureId === option.body?.featureId)
    const wire = source?.geometry.bodies?.find(
      ({ outputRole }) => outputRole === option.body?.outputRole,
    )
    const displayCandidates = new Map(
      wire?.topologyCandidates.map((candidate) => [candidate.candidateId, candidate]),
    )
    return [option.edgeEvidence, option.faceEvidence].flatMap((evidence) => {
      if (!evidence || (kind && kind !== evidence.kind)) return []
      const project = createBodyTopologyReferenceProjector(evidence)
      const resolve = createBodyTopologyReferenceResolver(evidence)
      return evidence.candidates.map((candidate, ordinal) => {
        const reference = project(candidate)
        const display = displayCandidates.get(candidate.candidateId)
        return {
          candidateId: candidate.candidateId,
          id: JSON.stringify([option.id, candidate.candidateId]),
          optionId: option.id,
          label: label(evidence.kind, ordinal + 1, option),
          reference,
          candidate: {
            ...candidate,
            ...(candidate.kind === "face" && display?.meshFaceId !== undefined
              ? { meshFaceId: display.meshFaceId }
              : {}),
          },
          resolveStatus: cachedStatus(() => resolve(reference).status),
          edgePolyline: display?.edgePolyline,
        }
      })
    })
  })
}

export function legacyEdgeReference(reference: EdgeTopoRef | BodyTopoRef): EdgeTopoRef | null {
  if (
    reference.kind !== "edge" ||
    (reference.schemaVersion === 1 && reference.outputRole !== "result")
  )
    return null
  const { schemaVersion: _version, ...value } = reference
  const { outputRole: _role, ...legacy } = { outputRole: "result", ...value }
  return edgeTopoRefSchema.parse({ ...legacy, schemaVersion: 0 })
}

export function sameTreatmentReference(
  left: EdgeTopoRef | BodyTopoRef,
  right: EdgeTopoRef | BodyTopoRef,
) {
  if (left.featureId !== right.featureId || left.kind !== right.kind) return false
  if (left.schemaVersion === 1 && right.schemaVersion === 1 && left.outputRole !== right.outputRole)
    return false
  if (
    (left.schemaVersion === 0 && right.schemaVersion === 1 && right.outputRole !== "result") ||
    (right.schemaVersion === 0 && left.schemaVersion === 1 && left.outputRole !== "result")
  )
    return false
  if (left.semanticRole || right.semanticRole)
    return Boolean(left.semanticRole && left.semanticRole === right.semanticRole)
  if (left.lineageToken || right.lineageToken)
    return Boolean(left.lineageToken && left.lineageToken === right.lineageToken)
  return canonicalJson(left.signature) === canonicalJson(right.signature)
}

type TreatmentReference = EdgeTopoRef | BodyTopoRef
type TreatmentReferenceResolution =
  | { status: "resolved"; candidate: EdgeTreatmentCandidate }
  | { status: "missing" | "ambiguous" }

/** Own one immutable catalogue per invocation or mounted owner; validate only queried scopes. */
export function prepareTreatmentReferenceResolution(candidates: readonly EdgeTreatmentCandidate[]) {
  const scopes = new Map<
    string,
    {
      resolve: ReturnType<typeof createTopologyReferenceResolver>
      byId: ReadonlyMap<string, EdgeTreatmentCandidate>
    }
  >()
  const resolve = (
    reference: TreatmentReference,
    optionId?: string,
  ): TreatmentReferenceResolution => {
    const role = reference.schemaVersion === 1 ? reference.outputRole : "result"
    const key = JSON.stringify([optionId ?? null, reference.featureId, reference.kind, role])
    let scope = scopes.get(key)
    if (!scope) {
      // Keep every same-body peer, including unresolved ones, in the confidence comparison.
      const scoped = candidates.filter(
        (entry) =>
          (optionId === undefined || entry.optionId === optionId) &&
          entry.reference.featureId === reference.featureId &&
          entry.reference.kind === reference.kind &&
          (entry.reference.schemaVersion === 1 ? entry.reference.outputRole : "result") === role,
      )
      const resolve = createTopologyReferenceResolver(scoped.map(({ candidate }) => candidate))
      const byId = new Map<string, EdgeTreatmentCandidate>()
      for (const entry of scoped) {
        if (!byId.has(entry.candidateId)) byId.set(entry.candidateId, entry)
      }
      scope = { resolve, byId }
      scopes.set(key, scope)
    }
    const { outputRole: _role, ...legacy } = { outputRole: "result", ...reference }
    const result = scope.resolve(topoRefSchema.parse({ ...legacy, schemaVersion: 0 }))
    if (result.status !== "resolved") return { status: result.status }
    const candidate = scope.byId.get(result.candidateId)
    return candidate ? { status: "resolved", candidate } : { status: "missing" }
  }
  return {
    resolve,
    matchesCandidate(reference: TreatmentReference, candidate: EdgeTreatmentCandidate) {
      if (reference.kind !== candidate.reference.kind) return false
      const resolved = resolve(reference)
      return resolved.status === "resolved" && resolved.candidate.id === candidate.id
    },
  }
}

export type PreparedTreatmentReferenceResolution = ReturnType<
  typeof prepareTreatmentReferenceResolution
>

/** Resolve against the whole exact body, so neighboring anonymous edges retain their margin. */
export function resolveTreatmentReference(
  reference: TreatmentReference,
  candidates: readonly EdgeTreatmentCandidate[],
) {
  return prepareTreatmentReferenceResolution(candidates).resolve(reference)
}

/** Compare stored intent with a current candidate only after resolving its complete catalogue. */
export function treatmentReferenceMatchesCandidate(
  reference: TreatmentReference,
  candidate: EdgeTreatmentCandidate,
  candidates: readonly EdgeTreatmentCandidate[],
) {
  return prepareTreatmentReferenceResolution(candidates).matchesCandidate(reference, candidate)
}

/** Toggle the resolved current edge, preserving other unresolved authored references for repair. */
export function toggleSelectedEdgeReference(
  references: readonly EdgeTopoRef[],
  picked: EdgeTopoRef,
  candidates: readonly Pick<SelectedEdgeCandidate, "reference" | "candidate">[],
): readonly EdgeTopoRef[] {
  const owner = candidates[0]?.reference.featureId
  if (
    !owner ||
    picked.featureId !== owner ||
    references.some((reference) => reference.featureId !== owner)
  )
    return references
  const resolve = createTopologyReferenceResolver(candidates.map(({ candidate }) => candidate))
  const chosen = resolve(picked)
  if (chosen.status !== "resolved") return references
  const remaining = references.filter((reference) => {
    const result = resolve(reference)
    return result.status !== "resolved" || result.candidateId !== chosen.candidateId
  })
  if (remaining.length !== references.length) return remaining
  return references.length < 256 ? [...references, picked] : references
}
