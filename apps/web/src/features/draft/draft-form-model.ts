import { resolveShellOpeningCandidates } from "@vibeshape/application/shell-opening-resolution"
import {
  createAngleQuantity,
  type DocumentDisplayUnits,
  type FeatureId,
  type FeatureRecord,
  type VariableDefinition,
} from "@vibeshape/domain"
import type { BodyReference } from "@vibeshape/domain/body-reference"
import { bodyFaceRefSchema } from "@vibeshape/domain/body-topology-reference"
import {
  createBodyTopologyReferenceProjector,
  type ModelBodyTopologyEvidence,
} from "@vibeshape/domain/model-body-topology"
import {
  DRAFT_MAX_FACES,
  draftAngleSchema,
  draftContentFace,
  draftFeatureParametersSchema,
  draftFeatureType,
  readDraftFeatureParameters,
} from "@vibeshape/domain/part-design-draft"
import { type ReferencePlane, referenceFrameDependencyIds } from "@vibeshape/domain/reference-frame"
import { normalizeExpressionWithDisplayUnit } from "../../document/document-display-units"
import { type BodyFeatureFormMode, bodyFeatureRecord } from "../part-design/body-feature-record"
import { evaluateFormExpression } from "../part-design/primitive-form"

/** An edit may target a History replacement body; its saved faces then need explicit reselection. */
export type DraftFormMode =
  | Extract<BodyFeatureFormMode, { kind: "create" }>
  | Readonly<{ kind: "edit"; feature: FeatureRecord; repairTarget?: BodyReference }>
export type DraftFormValues = { faceIds: string[]; angle: string; flip: boolean }
export type DraftValidationCopy = Readonly<{
  invalidExpression: string
  invalidDimension: string
  invalidRange: string
}>
const defaultDraftNeutralPlane: ReferencePlane = { kind: "origin-plane", plane: "XY" }

export function draftTargetBody(mode: DraftFormMode): BodyReference {
  if (mode.kind === "create") return mode.targetBody
  return mode.repairTarget ?? draftFeatureParametersSchema.parse(mode.feature.parameters).targetBody
}

/** A saved planar-face neutral plane on a replaced body must be chosen again, never transplanted. */
export function draftInitialNeutralPlane(mode: DraftFormMode): ReferencePlane | null {
  const saved = mode.kind === "edit" ? readDraftFeatureParameters(mode.feature)?.neutralPlane : null
  if (!saved) return defaultDraftNeutralPlane
  const target = draftTargetBody(mode)
  return saved.kind === "planar-face" &&
    (saved.reference.featureId !== target.featureId ||
      saved.reference.outputRole !== target.outputRole)
    ? null
    : saved
}

/** Restores saved faces on the current body; any unresolved face requires explicit reselection. */
export function draftInitialSelection(
  mode: DraftFormMode,
  evidence: ModelBodyTopologyEvidence | null,
  allowSemanticRebinding = true,
): { repair: boolean; faceIds: string[] } {
  if (mode.kind === "create") return { repair: false, faceIds: [] }
  const parameters = readDraftFeatureParameters(mode.feature)
  if (
    !parameters ||
    !evidence ||
    evidence.featureId !== parameters.targetBody.featureId ||
    evidence.outputRole !== parameters.targetBody.outputRole
  )
    return { repair: true, faceIds: [] }
  const faceIds: string[] = []
  for (const face of parameters.faces) {
    const durable = Boolean(face.semanticRole || face.lineageToken)
    const resolved = resolveShellOpeningCandidates(
      [draftContentFace(face)],
      evidence.candidates,
      evidence,
      durable ? "durable" : "exact",
      { allowSemanticRebinding },
    )
    const id = resolved.ok ? resolved.candidateIds[0] : undefined
    if (!id || faceIds.includes(id)) return { repair: true, faceIds: [] }
    faceIds.push(id)
  }
  return { repair: false, faceIds }
}

function draftAngleExpression(mode: DraftFormMode, units: DocumentDisplayUnits) {
  const angle = mode.kind === "edit" ? readDraftFeatureParameters(mode.feature)?.angle : undefined
  if (angle) return angle.source.expression ?? `${angle.source.value} ${angle.source.unit}`
  return units.angle === "deg" ? "3 deg" : `${(3 * Math.PI) / 180} rad`
}

export function draftInitialValues(
  mode: DraftFormMode,
  evidence: ModelBodyTopologyEvidence | null,
  units: DocumentDisplayUnits,
  allowSemanticRebinding = true,
): DraftFormValues {
  return {
    faceIds: draftInitialSelection(mode, evidence, allowSemanticRebinding).faceIds,
    angle: draftAngleExpression(mode, units),
    flip: mode.kind === "edit" ? (readDraftFeatureParameters(mode.feature)?.flip ?? false) : false,
  }
}

function parseDraftAngle(
  raw: string,
  variables: readonly VariableDefinition[],
  units: DocumentDisplayUnits,
  copy: DraftValidationCopy,
) {
  const expression = normalizeExpressionWithDisplayUnit(raw, units.angle)
  const evaluated = evaluateFormExpression(expression, variables)
  if (!evaluated) return { ok: false as const, message: copy.invalidExpression }
  if (evaluated.dimension !== "angle") return { ok: false as const, message: copy.invalidDimension }
  const quantity = createAngleQuantity(evaluated.value, "rad", expression)
  return draftAngleSchema.safeParse(quantity).success
    ? { ok: true as const, quantity }
    : { ok: false as const, message: copy.invalidRange }
}

export function draftFormFeature(
  input: Readonly<{
    mode: DraftFormMode
    featureId: FeatureId
    values: DraftFormValues
    neutralPlane: ReferencePlane | null
    evidence: ModelBodyTopologyEvidence | null
    variables: readonly VariableDefinition[]
    units: DocumentDisplayUnits
    copy: DraftValidationCopy
    allowSemanticRebinding?: boolean
  }>,
): FeatureRecord | null {
  const { evidence, values, neutralPlane } = input
  if (evidence?.kind !== "face" || !neutralPlane) return null
  if (values.faceIds.length === 0 || values.faceIds.length > DRAFT_MAX_FACES) return null
  const targetBody = draftTargetBody(input.mode)
  if (evidence.featureId !== targetBody.featureId || evidence.outputRole !== targetBody.outputRole)
    return null
  const angle = parseDraftAngle(values.angle, input.variables, input.units, input.copy)
  if (!angle.ok) return null
  const selected = values.faceIds.flatMap(
    (id) => evidence.candidates.find(({ candidateId }) => candidateId === id) ?? [],
  )
  if (selected.length !== values.faceIds.length) return null
  const project = createBodyTopologyReferenceProjector(evidence)
  const parameters = draftFeatureParametersSchema.safeParse({
    targetBody,
    faces: selected.map((candidate) => {
      const reference = bodyFaceRefSchema.parse(project(candidate))
      if (input.allowSemanticRebinding !== false) return reference
      // Modifier Extrusion face roles are heuristic and cannot be persisted as durable identity.
      const { semanticRole: _semanticRole, ...withoutHeuristicRole } = reference
      return withoutHeuristicRole
    }),
    neutralPlane,
    angle: angle.quantity,
    flip: values.flip,
  })
  if (!parameters.success) return null
  return bodyFeatureRecord(input.mode, input.featureId, {
    type: draftFeatureType.type,
    parameters: parameters.data,
    dependencies: referenceFrameDependencyIds(targetBody.featureId, neutralPlane),
  })
}

/** Toggles one picked face; returns null when the pick is stale or exceeds the face limit. */
export function toggleDraftFace(
  faceIds: readonly string[],
  candidateId: string,
  evidence: ModelBodyTopologyEvidence | null,
): string[] | null {
  if (!evidence?.candidates.some((candidate) => candidate.candidateId === candidateId)) return null
  if (faceIds.includes(candidateId)) return faceIds.filter((id) => id !== candidateId)
  return faceIds.length < DRAFT_MAX_FACES ? [...faceIds, candidateId] : null
}

/** Form-level validation: an angle issue is attached to its field, anything else to the form. */
export function draftFormIssues(
  angleExpression: string,
  feature: FeatureRecord | null,
  variables: readonly VariableDefinition[],
  units: DocumentDisplayUnits,
  copy: DraftValidationCopy & Readonly<{ validationSummary: string }>,
) {
  const angle = parseDraftAngle(angleExpression, variables, units, copy)
  if (!angle.ok) return { form: copy.validationSummary, fields: { angle: angle.message } }
  return feature ? undefined : copy.validationSummary
}
