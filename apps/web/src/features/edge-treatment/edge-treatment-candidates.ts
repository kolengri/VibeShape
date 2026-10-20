import {
  createTopologyReferenceResolver,
  type EdgeTopoRef,
  edgeTopoRefSchema,
  featureIdSchema,
  type TopologyCandidate,
  topologyCandidateSchema,
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
  if (reference.kind !== "edge") return null
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
  const resolve = createTopologyReferenceResolver([
    {
      candidateId: "current",
      kind: right.kind,
      signature: right.signature,
      ...(right.semanticRole ? { semanticRole: right.semanticRole } : {}),
      lineageTokens: right.lineageToken ? [right.lineageToken] : [],
    },
  ])
  const { outputRole: _role, ...legacy } = { outputRole: "result", ...left }
  return resolve({ ...legacy, schemaVersion: 0 }).status === "resolved"
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
