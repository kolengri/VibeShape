import type {
  DocumentDisplayUnits,
  FeatureId,
  FeatureRecord,
  VariableDefinition,
} from "@vibeshape/domain"
import type { BodyReference } from "@vibeshape/domain/body-reference"
import type { ModelBodyTopologyEvidence } from "@vibeshape/domain/model-body-topology"
import {
  readThickenFeatureParameters,
  THICKEN_MAX_FACES,
  type ThickenOperation,
  type ThickenSide,
  thickenFeatureParametersSchema,
  thickenFeatureType,
  thickenThicknessSchema,
} from "@vibeshape/domain/part-design-thicken"
import { defaultLengthExpression } from "../../document/document-display-units"
import { type BodyFeatureFormMode, bodyFeatureRecord } from "../part-design/body-feature-record"
import {
  type PrimitiveLengthCopy,
  parsePrimitiveLengthExpression,
  quantityExpression,
} from "../part-design/primitive-form"
import {
  projectBodyFaceSelection,
  restoreBodyFaceSelection,
  toggleBodyFace,
} from "../shell/body-face-form-model"

/** An edit may target a History replacement body; its saved faces then need explicit reselection. */
export type ThickenFormMode =
  | Extract<BodyFeatureFormMode, { kind: "create" }>
  | Readonly<{ kind: "edit"; feature: FeatureRecord; repairTarget?: BodyReference }>
export type ThickenFormValues = {
  faceIds: string[]
  thickness: string
  side: ThickenSide
  operation: ThickenOperation
}

export function thickenTargetBody(mode: ThickenFormMode): BodyReference {
  if (mode.kind === "create") return mode.targetBody
  return (
    mode.repairTarget ?? thickenFeatureParametersSchema.parse(mode.feature.parameters).targetBody
  )
}

/** Restores saved faces on the current body; any unresolved face requires explicit reselection. */
export function thickenInitialSelection(
  mode: ThickenFormMode,
  evidence: ModelBodyTopologyEvidence | null,
  allowSemanticRebinding = true,
): { repair: boolean; faceIds: string[] } {
  if (mode.kind === "create") return { repair: false, faceIds: [] }
  const parameters = readThickenFeatureParameters(mode.feature)
  return restoreBodyFaceSelection(
    parameters?.faces,
    parameters?.targetBody,
    evidence,
    allowSemanticRebinding,
  )
}

export function thickenInitialValues(
  mode: ThickenFormMode,
  evidence: ModelBodyTopologyEvidence | null,
  units: DocumentDisplayUnits,
  allowSemanticRebinding = true,
): ThickenFormValues {
  const saved = mode.kind === "edit" ? readThickenFeatureParameters(mode.feature) : null
  return {
    faceIds: thickenInitialSelection(mode, evidence, allowSemanticRebinding).faceIds,
    thickness: saved
      ? quantityExpression(saved.thickness)
      : defaultLengthExpression(2, units.length),
    side: saved?.side ?? "outward",
    operation: saved?.operation ?? "new",
  }
}

function parseThickness(
  raw: string,
  variables: readonly VariableDefinition[],
  units: DocumentDisplayUnits,
  copy: PrimitiveLengthCopy,
) {
  return parsePrimitiveLengthExpression(
    raw,
    variables,
    copy,
    (quantity) => thickenThicknessSchema.safeParse(quantity).success,
    units.length,
  )
}

export function thickenFormFeature(
  input: Readonly<{
    mode: ThickenFormMode
    featureId: FeatureId
    values: ThickenFormValues
    evidence: ModelBodyTopologyEvidence | null
    variables: readonly VariableDefinition[]
    units: DocumentDisplayUnits
    copy: PrimitiveLengthCopy
    allowSemanticRebinding?: boolean
  }>,
): FeatureRecord | null {
  const { evidence, values } = input
  if (evidence?.kind !== "face") return null
  if (values.faceIds.length === 0 || values.faceIds.length > THICKEN_MAX_FACES) return null
  const targetBody = thickenTargetBody(input.mode)
  if (evidence.featureId !== targetBody.featureId || evidence.outputRole !== targetBody.outputRole)
    return null
  const thickness = parseThickness(values.thickness, input.variables, input.units, input.copy)
  if (!thickness.ok) return null
  const faces = projectBodyFaceSelection(
    evidence,
    values.faceIds,
    input.allowSemanticRebinding !== false,
  )
  if (!faces) return null
  const parameters = thickenFeatureParametersSchema.safeParse({
    targetBody,
    faces,
    thickness: thickness.quantity,
    side: values.side,
    operation: values.operation,
  })
  if (!parameters.success) return null
  return bodyFeatureRecord(input.mode, input.featureId, {
    type: thickenFeatureType.type,
    parameters: parameters.data,
    dependencies: [targetBody.featureId],
  })
}

/** Toggles one picked face; returns null when the pick is stale or exceeds the face limit. */
export function toggleThickenFace(
  faceIds: readonly string[],
  candidateId: string,
  evidence: ModelBodyTopologyEvidence | null,
): string[] | null {
  return toggleBodyFace(faceIds, candidateId, evidence, THICKEN_MAX_FACES)
}

/** Form-level validation: a thickness issue is attached to its field, anything else to the form. */
export function thickenFormIssues(
  thicknessExpression: string,
  feature: FeatureRecord | null,
  variables: readonly VariableDefinition[],
  units: DocumentDisplayUnits,
  copy: PrimitiveLengthCopy & Readonly<{ validationSummary: string }>,
) {
  const thickness = parseThickness(thicknessExpression, variables, units, copy)
  if (!thickness.ok)
    return { form: copy.validationSummary, fields: { thickness: thickness.message } }
  return feature ? undefined : copy.validationSummary
}
