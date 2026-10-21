import type { EdgeTopoRef, FeatureId } from "@vibeshape/domain"
import type { BodyTopoRef } from "@vibeshape/domain/body-topology-reference"
import {
  type EdgeTreatmentCandidate,
  resolveTreatmentReference,
  treatmentReferenceMatchesCandidate,
} from "./edge-treatment-candidates"
import { type TreatmentValues, toggleTreatmentCandidate } from "./edge-treatment-model"
import type { EdgeTreatmentTargetOption } from "./edge-treatment-options"

export type EdgeTreatmentPick =
  | { kind: "edges" | "faces" | "overrides" }
  | { kind: "side-face"; index: number }
export type EdgeTreatmentPickingContext = Readonly<{
  featureId: FeatureId
  targetFeatureId: FeatureId | null
  targetOptionId?: string
  references: readonly EdgeTopoRef[]
  scope: "all" | "selected"
  options?: readonly EdgeTreatmentTargetOption[]
  targets?: TreatmentValues["targets"]
  directionOverrides?: TreatmentValues["directionOverrides"]
  pick?: EdgeTreatmentPick | null
}>
export type EdgeTreatmentPickRequest = Readonly<{
  sequence: number
  featureId: FeatureId
  reference?: EdgeTopoRef | BodyTopoRef
  optionId?: string
  pick?: EdgeTreatmentPick
  issue?: "ambiguous" | "missing" | "wrong-body" | "limit"
}>

type PickResult =
  | { values: TreatmentValues }
  | { issue: NonNullable<EdgeTreatmentPickRequest["issue"]> }

function resolvePickedCandidate(
  request: EdgeTreatmentPickRequest,
  candidates: readonly EdgeTreatmentCandidate[],
  options: readonly EdgeTreatmentTargetOption[],
):
  | { candidate: EdgeTreatmentCandidate }
  | { issue: NonNullable<EdgeTreatmentPickRequest["issue"]> } {
  if (request.issue) return { issue: request.issue }
  const reference = request.reference
  if (!reference) return { issue: "missing" as const }
  const resolved = resolveTreatmentReference(
    reference,
    candidates.filter(
      (candidate) => request.optionId === undefined || request.optionId === candidate.optionId,
    ),
  )
  if (resolved.status !== "resolved") return { issue: resolved.status }
  const candidate = resolved.candidate
  if (!candidate || !options.some(({ id }) => id === candidate.optionId))
    return { issue: "missing" as const }
  const status = candidate.resolveStatus()
  if (status !== "resolved") return { issue: status }
  return { candidate }
}

function pickSideFace(
  values: TreatmentValues,
  candidate: EdgeTreatmentCandidate,
  index: number,
): PickResult {
  if (candidate.optionId !== values.targetFeatureId) return { issue: "wrong-body" }
  const reference = candidate.reference
  if (reference.schemaVersion !== 1 || reference.kind !== "face") return { issue: "missing" }
  if (values.targets[index]?.kind !== "edge") return { issue: "missing" }
  const sideFace = { ...reference, kind: "face" as const }
  return {
    values: {
      ...values,
      targets: values.targets.map((target, item) =>
        item === index && target.kind === "edge" ? { ...target, sideFace } : target,
      ),
    },
  }
}

function pickOverride(
  values: TreatmentValues,
  candidate: EdgeTreatmentCandidate,
  candidates: readonly EdgeTreatmentCandidate[],
): PickResult {
  if (candidate.optionId !== values.targetFeatureId) return { issue: "wrong-body" }
  const reference = candidate.reference
  if (reference.schemaVersion !== 1 || reference.kind !== "edge") return { issue: "missing" }
  const edge = { ...reference, kind: "edge" as const }
  const matches = (entry: BodyTopoRef) =>
    treatmentReferenceMatchesCandidate(entry, candidate, candidates)
  const existing = values.directionOverrides.some(matches)
  if (!existing && values.directionOverrides.length >= 256) return { issue: "limit" }
  const directionOverrides = existing
    ? values.directionOverrides.filter((entry) => !matches(entry))
    : [...values.directionOverrides, edge]
  return { values: { ...values, directionOverrides } }
}

export function applyTreatmentPick(
  values: TreatmentValues,
  request: EdgeTreatmentPickRequest,
  candidates: readonly EdgeTreatmentCandidate[],
  options: readonly EdgeTreatmentTargetOption[],
): PickResult {
  const resolved = resolvePickedCandidate(request, candidates, options)
  if ("issue" in resolved) return resolved
  const { candidate } = resolved
  const pick = request.pick ?? { kind: "edges" }
  if (pick.kind === "side-face") return pickSideFace(values, candidate, pick.index)
  if (pick.kind === "overrides") return pickOverride(values, candidate, candidates)
  const kind = pick.kind === "faces" ? "face" : "edge"
  if (candidate.reference.kind !== kind) return { issue: "missing" }
  const next = toggleTreatmentCandidate(values, candidate, candidates)
  if (Math.max(next.references.length, next.targets.length) > 256) return { issue: "limit" }
  return { values: next }
}
