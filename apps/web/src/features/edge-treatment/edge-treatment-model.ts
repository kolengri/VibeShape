import {
  chamferFeatureParametersSchema,
  chamferFeatureType,
  chamferFeatureTypeV2,
  createAngleQuantity,
  type DocumentDisplayUnits,
  type EdgeTopoRef,
  evaluateExpression,
  evaluateVariableDefinitions,
  type FeatureId,
  type FeatureRecord,
  featureIdSchema,
  featureRecordSchema,
  filletFeatureParametersSchema,
  filletFeatureType,
  filletFeatureTypeV2,
  type VariableDefinition,
} from "@vibeshape/domain"
import type { BodyTopoRef } from "@vibeshape/domain/body-topology-reference"
import {
  type ChamferFeatureParametersV3,
  chamferFeatureParametersV3Schema,
  chamferFeatureTypeV3,
} from "@vibeshape/domain/part-design"
import { normalizeExpressionWithDisplayUnit } from "../../document/document-display-units"
import { parsePrimitiveLengthExpression } from "../part-design/primitive-form"
import {
  type EdgeTreatmentCandidate,
  legacyEdgeReference,
  resolveTreatmentReference,
  sameTreatmentReference,
  toggleSelectedEdgeReference,
  treatmentReferenceMatchesCandidate,
} from "./edge-treatment-candidates"
import type {
  EdgeTreatmentFormCopy,
  EdgeTreatmentFormMode,
  EdgeTreatmentOperation,
} from "./edge-treatment-form"
import {
  type EdgeTreatmentTargetOption,
  edgeTreatmentOptionOwner,
  edgeTreatmentRequiresV3,
} from "./edge-treatment-options"

export type ChamferTarget = ChamferFeatureParametersV3["targets"][number]
export type TreatmentValues = {
  distance: string
  targetFeatureId: string
  scope: "all" | "selected"
  references: readonly EdgeTopoRef[]
  targets: readonly ChamferTarget[]
  retainV3: boolean
  mode: ChamferFeatureParametersV3["mode"]
  secondDistance: string
  angle: string
  measurement: "offset" | "tangent"
  flip: boolean
  tangentPropagation: boolean
  directionOverrides: ChamferFeatureParametersV3["directionOverrides"]
}
export type TreatmentIssues = Partial<Record<keyof TreatmentValues, string>>
type TreatmentValidationCopy = EdgeTreatmentFormCopy & {
  missingCatalogue: string
  missingSideFace: string
  planarOnly: string
  invalidAngle: string
  invalidAdvancedRange: string
}

export function treatmentUsesV3(
  values: TreatmentValues,
  option: EdgeTreatmentTargetOption | undefined,
) {
  return (
    values.retainV3 ||
    values.flip ||
    values.directionOverrides.length > 0 ||
    values.mode !== "equal-distance" ||
    values.measurement !== "offset" ||
    values.tangentPropagation ||
    values.targets.some(({ kind }) => kind === "face") ||
    edgeTreatmentRequiresV3(option)
  )
}

export { initialTreatmentValues } from "./edge-treatment-initial"

export function clearTreatmentSelection(
  values: TreatmentValues,
  targetFeatureId = values.targetFeatureId,
): TreatmentValues {
  return { ...values, targetFeatureId, references: [], targets: [], directionOverrides: [] }
}

export function treatmentReferences(
  values: TreatmentValues,
  v3: boolean,
): readonly (EdgeTopoRef | BodyTopoRef)[] {
  if (!v3) return values.references
  const targets = values.targets.map((target) =>
    target.kind === "edge" ? target.edge : target.face,
  )
  return [
    ...targets,
    ...values.references.filter(
      (reference) => !targets.some((target) => sameTreatmentReference(reference, target)),
    ),
  ]
}

export function promoteTreatmentTargets(
  values: TreatmentValues,
  candidates: readonly EdgeTreatmentCandidate[],
): TreatmentValues {
  const targets = [...values.targets]
  for (const reference of values.references) {
    if (
      targets.some(
        (target) => target.kind === "edge" && sameTreatmentReference(reference, target.edge),
      )
    )
      continue
    const target = projectedEdgeTarget(reference, values.targetFeatureId, candidates)
    if (target) targets.push(target)
  }
  return { ...values, targets }
}

function projectedEdgeTarget(
  reference: EdgeTopoRef,
  optionId: string,
  candidates: readonly EdgeTreatmentCandidate[],
): ChamferTarget | null {
  const resolved = resolveTreatmentReference(
    reference,
    candidates.filter((candidate) => candidate.optionId === optionId),
  )
  if (resolved.status !== "resolved") return null
  const candidate = resolved.candidate
  if (
    candidate?.resolveStatus() !== "resolved" ||
    candidate.reference.schemaVersion !== 1 ||
    candidate.reference.kind !== "edge"
  )
    return null
  return {
    kind: "edge",
    edge: { ...reference, schemaVersion: 1, outputRole: candidate.reference.outputRole },
  }
}

export function toggleTreatmentCandidate(
  values: TreatmentValues,
  picked: EdgeTreatmentCandidate,
  candidates: readonly EdgeTreatmentCandidate[],
): TreatmentValues {
  const next =
    values.targetFeatureId === picked.optionId
      ? values
      : clearTreatmentSelection(values, picked.optionId)
  const reference = picked.reference
  const matches = (stored: EdgeTopoRef | BodyTopoRef) =>
    treatmentReferenceMatchesCandidate(stored, picked, candidates)
  const selected =
    next.targets.some((target) => matches(target.kind === "edge" ? target.edge : target.face)) ||
    next.references.some(matches)
  let targets = next.targets
  if (reference.schemaVersion === 1) {
    targets = selected
      ? targets.filter((target) => !matches(target.kind === "edge" ? target.edge : target.face))
      : [
          ...targets,
          reference.kind === "face"
            ? { kind: "face", face: { ...reference, kind: "face" } }
            : { kind: "edge", edge: { ...reference, kind: "edge" } },
        ]
  }
  const legacy = legacyEdgeReference(reference)
  const edges = candidates
    .filter(({ optionId }) => optionId === picked.optionId)
    .flatMap((entry) => {
      const reference = legacyEdgeReference(entry.reference)
      return reference ? [{ reference, candidate: entry.candidate }] : []
    })
  const references = legacy
    ? selected
      ? next.references.filter((ref) => !matches(ref))
      : toggleSelectedEdgeReference(next.references, legacy, edges)
    : next.references
  return {
    ...next,
    scope: "selected",
    references,
    targets,
    directionOverrides: selected
      ? next.directionOverrides.filter((ref) => !matches(ref))
      : next.directionOverrides,
  }
}

function referenceIssue(
  reference: EdgeTopoRef | BodyTopoRef,
  candidates: readonly EdgeTreatmentCandidate[],
  copy: TreatmentValidationCopy,
) {
  const resolved = resolveTreatmentReference(reference, candidates)
  if (resolved.status !== "resolved")
    return resolved.status === "ambiguous" ? copy.ambiguousEdge : copy.missingEdge
  const match = resolved.candidate
  if (match?.resolveStatus() === "ambiguous") return copy.ambiguousEdge
  return match?.resolveStatus() === "resolved" ? undefined : copy.missingEdge
}

function planarReference(reference: EdgeTopoRef | BodyTopoRef) {
  if (reference.kind === "face") return reference.signature.geometryClass === "PLANE"
  return (
    reference.signature.geometryClass === "LINE" &&
    reference.signature.adjacentGeometryClasses.length > 0 &&
    reference.signature.adjacentGeometryClasses.every((geometry) => geometry === "PLANE")
  )
}

function selectionIssue(
  values: TreatmentValues,
  v3: boolean,
  candidates: readonly EdgeTreatmentCandidate[],
  copy: TreatmentValidationCopy,
) {
  if (values.scope === "all" && !v3) return undefined
  const references = treatmentReferences(values, v3)
  if (!references.length || references.length > 256) return copy.missingEdge
  for (const reference of references) {
    const issue = selectedReferenceIssue(reference, v3, candidates, copy)
    if (issue) return issue
  }
  return undefined
}

function selectedReferenceIssue(
  reference: EdgeTopoRef | BodyTopoRef,
  v3: boolean,
  candidates: readonly EdgeTreatmentCandidate[],
  copy: TreatmentValidationCopy,
) {
  const issue = referenceIssue(reference, candidates, copy)
  if (issue) return issue
  if (!v3) return undefined
  if (reference.schemaVersion !== 1) return copy.missingCatalogue
  return planarReference(reference) ? undefined : copy.planarOnly
}

function planarCandidateIssue(
  reference: EdgeTopoRef | BodyTopoRef,
  candidates: readonly EdgeTreatmentCandidate[],
  copy: TreatmentValidationCopy,
) {
  return (
    referenceIssue(reference, candidates, copy) ??
    (planarReference(reference) ? undefined : copy.planarOnly)
  )
}

function sideFaceIssue(
  target: ChamferTarget,
  mode: TreatmentValues["mode"],
  candidates: readonly EdgeTreatmentCandidate[],
  copy: TreatmentValidationCopy,
) {
  if (target.kind !== "edge") return undefined
  if (target.sideFace) return planarCandidateIssue(target.sideFace, candidates, copy)
  return mode === "equal-distance" ? undefined : copy.missingSideFace
}

function sideIssue(
  values: TreatmentValues,
  candidates: readonly EdgeTreatmentCandidate[],
  copy: TreatmentValidationCopy,
) {
  for (const target of values.targets) {
    const issue = sideFaceIssue(target, values.mode, candidates, copy)
    if (issue) return issue
  }
  for (const reference of values.directionOverrides) {
    const issue = planarCandidateIssue(reference, candidates, copy)
    if (issue) return issue
  }
  return undefined
}

function chamferAngle(
  raw: string,
  variables: readonly VariableDefinition[],
  copy: TreatmentValidationCopy,
) {
  const variablesResult = evaluateVariableDefinitions(variables)
  if (!variablesResult.ok) return { ok: false as const, message: copy.invalidExpression }
  const expression = normalizeExpressionWithDisplayUnit(raw, "deg")
  const result = evaluateExpression(expression, variablesResult.valuesByName)
  if (!result.ok) return { ok: false as const, message: copy.invalidExpression }
  if (result.value.dimension !== "angle")
    return { ok: false as const, message: copy.invalidDimension }
  if (result.value.value <= 0 || result.value.value >= Math.PI / 2)
    return { ok: false as const, message: copy.invalidAngle }
  return { ok: true as const, quantity: createAngleQuantity(result.value.value, "rad", expression) }
}

type TreatmentContext = {
  featureId: FeatureId
  mode: EdgeTreatmentFormMode
  operation: EdgeTreatmentOperation
  options: readonly EdgeTreatmentTargetOption[]
  candidates: readonly EdgeTreatmentCandidate[]
  variables: readonly VariableDefinition[]
  unit: DocumentDisplayUnits["length"]
  copy: TreatmentValidationCopy
}
type ParametersResult = { ok: true; parameters: unknown } | { ok: false; issues: TreatmentIssues }

function parseTreatmentLength(raw: string, context: TreatmentContext, v3: boolean) {
  const schema =
    context.operation === "fillet"
      ? filletFeatureParametersSchema.shape.radius
      : chamferFeatureParametersSchema.shape.distance
  return parsePrimitiveLengthExpression(
    raw,
    context.variables,
    {
      ...context.copy,
      invalidRange: v3 ? context.copy.invalidAdvancedRange : context.copy.invalidRange,
    },
    (quantity) =>
      schema.safeParse(quantity).success &&
      (!v3 || (quantity.value >= 0.001 && quantity.value <= 100_000)),
    context.unit,
  )
}

function parseTreatmentBase(
  values: TreatmentValues,
  context: TreatmentContext,
  option: EdgeTreatmentTargetOption | undefined,
  v3: boolean,
) {
  const distance = parseTreatmentLength(values.distance, context, v3)
  const target = featureIdSchema.safeParse(edgeTreatmentOptionOwner(option))
  const issues: TreatmentIssues = {}
  if (!distance.ok) issues.distance = distance.message
  if (!target.success) issues.targetFeatureId = context.copy.missingTarget
  const selection = selectionIssue(values, v3, context.candidates, context.copy)
  if (selection) issues.references = selection
  if (!distance.ok || !target.success || Object.keys(issues).length)
    return { ok: false as const, issues }
  return { ok: true as const, distance: distance.quantity, target: target.data }
}

function directionalQuantities(values: TreatmentValues, context: TreatmentContext) {
  if (values.mode === "two-distances") {
    const result = parseTreatmentLength(values.secondDistance, context, true)
    return result.ok
      ? { ok: true as const, values: { secondDistance: result.quantity } }
      : { ok: false as const, issues: { secondDistance: result.message } }
  }
  if (values.mode === "distance-angle") {
    const result = chamferAngle(values.angle, context.variables, context.copy)
    return result.ok
      ? { ok: true as const, values: { angle: result.quantity } }
      : { ok: false as const, issues: { angle: result.message } }
  }
  return { ok: true as const, values: {} }
}

function v3Parameters(
  values: TreatmentValues,
  context: TreatmentContext,
  option: EdgeTreatmentTargetOption | undefined,
  distance: ReturnType<typeof chamferFeatureParametersSchema.parse>["distance"],
): ParametersResult {
  if (!option?.body || !option.edgeEvidence || !option.faceEvidence)
    return { ok: false, issues: { references: context.copy.missingCatalogue } }
  const side = sideIssue(values, context.candidates, context.copy)
  if (side) return { ok: false, issues: { references: side } }
  const quantities = directionalQuantities(values, context)
  if (!quantities.ok) return quantities
  const parsed = chamferFeatureParametersV3Schema.safeParse({
    targetBody: option.body,
    mode: values.mode,
    distance,
    ...quantities.values,
    measurement: values.measurement,
    flip: values.flip,
    tangentPropagation: values.tangentPropagation,
    targets: values.targets,
    directionOverrides: values.directionOverrides,
  })
  return parsed.success
    ? { ok: true, parameters: parsed.data }
    : { ok: false, issues: { references: context.copy.validationSummary } }
}

function authoredTreatment(
  context: TreatmentContext,
  values: TreatmentValues,
  target: FeatureId,
  parameters: unknown,
  v3: boolean,
) {
  const types =
    context.operation === "fillet"
      ? { all: filletFeatureType, selected: filletFeatureTypeV2 }
      : { all: chamferFeatureType, selected: chamferFeatureTypeV2 }
  const base =
    context.mode.kind === "edit"
      ? context.mode.feature
      : {
          schemaVersion: 0,
          id: context.featureId,
          label: context.mode.featureLabel,
          suppressed: false,
        }
  return featureRecordSchema.parse({
    ...base,
    type: v3 ? chamferFeatureTypeV3.type : types[values.scope].type,
    parameters,
    dependencies: [target],
    references: v3 || values.scope === "all" ? [] : values.references,
  })
}

export function treatmentFeature(
  values: TreatmentValues,
  fullContext: TreatmentContext,
): { ok: true; feature: FeatureRecord } | { ok: false; issues: TreatmentIssues } {
  const option = fullContext.options.find(({ id }) => id === values.targetFeatureId)
  const context = {
    ...fullContext,
    candidates: fullContext.candidates.filter(
      ({ optionId }) => optionId === values.targetFeatureId,
    ),
  }
  const v3 = context.operation === "chamfer" && treatmentUsesV3(values, option)
  const base = parseTreatmentBase(values, context, option, v3)
  if (!base.ok) return base
  const legacyParameters =
    context.operation === "fillet" ? { radius: base.distance } : { distance: base.distance }
  const result = v3
    ? v3Parameters(values, context, option, base.distance)
    : { ok: true as const, parameters: legacyParameters }
  if (!result.ok) return result
  return {
    ok: true,
    feature: authoredTreatment(context, values, base.target, result.parameters, v3),
  }
}
