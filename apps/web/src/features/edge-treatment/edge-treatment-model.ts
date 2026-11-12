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
  filletFeatureTypeV3,
} from "@vibeshape/domain/part-design"
import { normalizeExpressionWithDisplayUnit } from "../../document/document-display-units"
import { parsePrimitiveLengthExpression } from "../part-design/primitive-form"
import {
  type EdgeTreatmentCandidate,
  legacyEdgeReference,
  type PreparedTreatmentReferenceResolution,
  prepareTreatmentReferenceResolution,
  sameTreatmentReference,
  toggleSelectedEdgeReference,
} from "./edge-treatment-candidates"
import {
  type FilletVariableRadiusDraft,
  filletUsesV3,
  filletV3Parameters,
  variableRadiusIssue,
} from "./edge-treatment-fillet"
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
  /** Fillet only: linear radius laws keyed by their selected edge target. */
  variableRadii: readonly FilletVariableRadiusDraft[]
}
export type TreatmentIssues = Partial<Record<keyof TreatmentValues, string>>
type TreatmentValidationCopy = EdgeTreatmentFormCopy & {
  missingCatalogue: string
  missingSideFace: string
  planarOnly: string
  plainContourOnly: string
  invalidAngle: string
  invalidAdvancedRange: string
  variableRadiusEqual: string
  variableRadiusClosed: string
}

/** Schema route owner for both treatments; each operation has exactly one route function. */
export function treatmentUsesV3(
  values: TreatmentValues,
  option: EdgeTreatmentTargetOption | undefined,
  formMode: EdgeTreatmentFormMode,
  operation: EdgeTreatmentOperation,
) {
  return operation === "fillet"
    ? filletUsesV3(values, option)
    : chamferUsesV3(values, option, formMode)
}

/**
 * Single owner of the Chamfer schema route. All edges stays on V1, body-bound new selections and
 * saved V3 records author V3, and saved V1/V2 intent migrates only while advanced intent is present.
 */
function chamferUsesV3(
  values: TreatmentValues,
  option: EdgeTreatmentTargetOption | undefined,
  formMode: EdgeTreatmentFormMode,
) {
  if (edgeTreatmentRequiresV3(option)) return true
  if (values.scope === "all" || usesLegacyContourChamfer(values, option, formMode)) return false
  return values.retainV3 || chamferAdvancedIntent(values)
}

/** Any authored control that only V3 can represent. */
function chamferAdvancedIntent(values: TreatmentValues) {
  return (
    values.flip ||
    values.directionOverrides.length > 0 ||
    values.mode !== "equal-distance" ||
    values.measurement !== "offset" ||
    values.tangentPropagation ||
    values.targets.some(({ kind }) => kind === "face")
  )
}

export { initialTreatmentValues } from "./edge-treatment-initial"

export function clearTreatmentSelection(
  values: TreatmentValues,
  targetFeatureId = values.targetFeatureId,
): TreatmentValues {
  return {
    ...values,
    targetFeatureId,
    references: [],
    targets: [],
    directionOverrides: [],
    variableRadii: [],
  }
}

/** All edges shows and saves neutral controls; returning restores the intent it replaced. */
export function withTreatmentScope(
  values: TreatmentValues,
  scope: TreatmentValues["scope"],
  selected: TreatmentValues | null,
): TreatmentValues {
  if (scope === "all")
    return {
      ...values,
      scope,
      mode: "equal-distance",
      measurement: "offset",
      flip: false,
      tangentPropagation: false,
      directionOverrides: [],
      targets: [],
      variableRadii: [],
    }
  if (!selected) return { ...values, scope }
  const {
    mode,
    measurement,
    flip,
    tangentPropagation,
    directionOverrides,
    targets,
    variableRadii,
  } = selected
  return {
    ...values,
    scope,
    mode,
    measurement,
    flip,
    tangentPropagation,
    // Exact targets belong to one body and never transfer to another.
    ...(selected.targetFeatureId === values.targetFeatureId
      ? { directionOverrides, targets, variableRadii }
      : {}),
  }
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
  const resolution = prepareTreatmentReferenceResolution(candidates)
  for (const reference of values.references) {
    if (
      targets.some(
        (target) => target.kind === "edge" && sameTreatmentReference(reference, target.edge),
      )
    )
      continue
    const target = projectedEdgeTarget(reference, values.targetFeatureId, resolution)
    if (target) targets.push(target)
  }
  return { ...values, targets }
}

function projectedEdgeTarget(
  reference: EdgeTopoRef,
  optionId: string,
  resolution: PreparedTreatmentReferenceResolution,
): ChamferTarget | null {
  const resolved = resolution.resolve(reference, optionId)
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
  resolution = prepareTreatmentReferenceResolution(candidates),
): TreatmentValues {
  const next =
    values.targetFeatureId === picked.optionId
      ? values
      : clearTreatmentSelection(values, picked.optionId)
  const reference = picked.reference
  const matches = (stored: EdgeTopoRef | BodyTopoRef) => resolution.matchesCandidate(stored, picked)
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
    variableRadii: selected
      ? next.variableRadii.filter(({ edge }) => !matches(edge))
      : next.variableRadii,
  }
}

function referenceIssue(
  reference: EdgeTopoRef | BodyTopoRef,
  resolution: PreparedTreatmentReferenceResolution,
  copy: TreatmentValidationCopy,
) {
  const resolved = resolution.resolve(reference)
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

function circularOffsetReference(reference: EdgeTopoRef | BodyTopoRef, values: TreatmentValues) {
  const signature = reference.signature
  return (
    values.mode === "equal-distance" &&
    values.measurement === "offset" &&
    reference.kind === "edge" &&
    signature.geometryClass === "CIRCLE" &&
    (signature.boundaryCount === 0 || signature.boundaryCount === 2) &&
    signature.adjacentGeometryClasses.length === 2 &&
    signature.adjacentGeometryClasses.includes("PLANE") &&
    signature.adjacentGeometryClasses.includes("CYLINDRE")
  )
}

function measurableReference(reference: EdgeTopoRef | BodyTopoRef, values: TreatmentValues) {
  return planarReference(reference) || circularOffsetReference(reference, values)
}

function nativeContourControls(values: TreatmentValues) {
  return (
    values.mode === "equal-distance" &&
    values.measurement === "offset" &&
    values.tangentPropagation &&
    !values.flip &&
    values.directionOverrides.length === 0 &&
    values.targets.every((target) => target.kind === "edge" && !target.sideFace)
  )
}

function legacyContourBody(
  option: EdgeTreatmentTargetOption | undefined,
  formMode: EdgeTreatmentFormMode,
) {
  return (
    formMode.kind === "create" && option?.legacy === true && option.body?.outputRole === "result"
  )
}

/**
 * The legacy builder already treats whole native contours without a measured-setback claim, so a
 * new plain selection that V3 cannot measure keeps that route. Saved or advanced intent never does.
 */
function usesLegacyContourChamfer(
  values: TreatmentValues,
  option: EdgeTreatmentTargetOption | undefined,
  formMode: EdgeTreatmentFormMode,
) {
  if (!legacyContourBody(option, formMode) || !nativeContourControls(values)) return false
  // Scan signatures first: measurable selections never pay for the pairing below.
  if (values.references.every((reference) => measurableReference(reference, values))) return false
  return values.targets.every((target) => {
    const legacy = target.kind === "edge" ? legacyEdgeReference(target.edge) : null
    return (
      legacy !== null && values.references.some((stored) => sameTreatmentReference(stored, legacy))
    )
  })
}

function selectionIssue(
  values: TreatmentValues,
  v3: boolean,
  context: ResolvedTreatmentContext,
  option: EdgeTreatmentTargetOption | undefined,
) {
  if (values.scope === "all" && !v3) return undefined
  const references = treatmentReferences(values, v3)
  if (!references.length || references.length > 256) return context.copy.missingEdge
  // Name the recovery when the plain legacy contour route would still build this edge.
  const unsupportedEdge = legacyContourBody(option, context.mode)
    ? context.copy.plainContourOnly
    : context.copy.planarOnly
  for (const reference of references) {
    const issue = selectedReferenceIssue(reference, v3, context, values, unsupportedEdge)
    if (issue) return issue
  }
  return undefined
}

function selectedReferenceIssue(
  reference: EdgeTopoRef | BodyTopoRef,
  v3: boolean,
  context: ResolvedTreatmentContext,
  values: TreatmentValues,
  unsupportedEdge: string,
) {
  const issue = referenceIssue(reference, context.resolution, context.copy)
  if (issue) return issue
  if (!v3) return undefined
  if (reference.schemaVersion !== 1) return context.copy.missingCatalogue
  // Fillet V3 follows native contours on any sharp edge; only Chamfer measures its setbacks.
  if (context.operation === "fillet" || measurableReference(reference, values)) return undefined
  return reference.kind === "edge" ? unsupportedEdge : context.copy.planarOnly
}

function planarCandidateIssue(
  reference: EdgeTopoRef | BodyTopoRef,
  resolution: PreparedTreatmentReferenceResolution,
  copy: TreatmentValidationCopy,
) {
  return (
    referenceIssue(reference, resolution, copy) ??
    (planarReference(reference) ? undefined : copy.planarOnly)
  )
}

function sideFaceIssue(
  target: ChamferTarget,
  mode: TreatmentValues["mode"],
  resolution: PreparedTreatmentReferenceResolution,
  copy: TreatmentValidationCopy,
) {
  if (target.kind !== "edge") return undefined
  if (target.sideFace) return planarCandidateIssue(target.sideFace, resolution, copy)
  return mode === "equal-distance" ? undefined : copy.missingSideFace
}

function sideIssue(
  values: TreatmentValues,
  resolution: PreparedTreatmentReferenceResolution,
  copy: TreatmentValidationCopy,
) {
  for (const target of values.targets) {
    const issue = sideFaceIssue(target, values.mode, resolution, copy)
    if (issue) return issue
  }
  for (const reference of values.directionOverrides) {
    const issue = planarCandidateIssue(reference, resolution, copy)
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

export type TreatmentContext = {
  featureId: FeatureId
  mode: EdgeTreatmentFormMode
  operation: EdgeTreatmentOperation
  options: readonly EdgeTreatmentTargetOption[]
  candidates: readonly EdgeTreatmentCandidate[]
  variables: readonly VariableDefinition[]
  unit: DocumentDisplayUnits["length"]
  copy: TreatmentValidationCopy
}
type ResolvedTreatmentContext = TreatmentContext & {
  resolution: PreparedTreatmentReferenceResolution
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
  context: ResolvedTreatmentContext,
  option: EdgeTreatmentTargetOption | undefined,
  v3: boolean,
) {
  const distance = parseTreatmentLength(values.distance, context, v3)
  const target = featureIdSchema.safeParse(edgeTreatmentOptionOwner(option))
  const issues: TreatmentIssues = {}
  if (!distance.ok) issues.distance = distance.message
  if (!target.success) issues.targetFeatureId = context.copy.missingTarget
  const selection = selectionIssue(values, v3, context, option)
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
  context: ResolvedTreatmentContext,
  option: EdgeTreatmentTargetOption | undefined,
  distance: ReturnType<typeof chamferFeatureParametersSchema.parse>["distance"],
): ParametersResult {
  if (!option?.body || !option.edgeEvidence || !option.faceEvidence)
    return { ok: false, issues: { references: context.copy.missingCatalogue } }
  const side = sideIssue(values, context.resolution, context.copy)
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
      ? { all: filletFeatureType, selected: filletFeatureTypeV2, v3: filletFeatureTypeV3 }
      : { all: chamferFeatureType, selected: chamferFeatureTypeV2, v3: chamferFeatureTypeV3 }
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
    type: (v3 ? types.v3 : types[values.scope]).type,
    parameters,
    dependencies: [target],
    references: v3 || values.scope === "all" ? [] : values.references,
  })
}

function authoredParameters(
  values: TreatmentValues,
  context: ResolvedTreatmentContext,
  option: EdgeTreatmentTargetOption | undefined,
  size: ReturnType<typeof chamferFeatureParametersSchema.parse>["distance"],
  v3: boolean,
): ParametersResult {
  if (context.operation === "chamfer")
    return v3
      ? v3Parameters(values, context, option, size)
      : { ok: true, parameters: { distance: size } }
  if (!v3) return { ok: true, parameters: { radius: size } }
  return filletV3Parameters(
    values,
    option,
    size,
    (raw) => parseTreatmentLength(raw, context, true),
    context.copy,
  )
}

/** Per-row Fillet law issue, parsed with the same rules as the authored V3 feature. */
export function treatmentVariableRadiusIssue(
  values: TreatmentValues,
  reference: EdgeTopoRef | BodyTopoRef,
  context: TreatmentContext,
) {
  return variableRadiusIssue(
    values,
    reference,
    (raw) => parseTreatmentLength(raw, context, true),
    context.copy,
  )
}

export function treatmentFeature(
  values: TreatmentValues,
  fullContext: TreatmentContext,
): { ok: true; feature: FeatureRecord } | { ok: false; issues: TreatmentIssues } {
  const option = fullContext.options.find(({ id }) => id === values.targetFeatureId)
  const context = {
    ...fullContext,
    resolution: prepareTreatmentReferenceResolution(
      fullContext.candidates.filter(({ optionId }) => optionId === values.targetFeatureId),
    ),
  }
  const v3 = treatmentUsesV3(values, option, context.mode, context.operation)
  const base = parseTreatmentBase(values, context, option, v3)
  if (!base.ok) return base
  const result = authoredParameters(values, context, option, base.distance, v3)
  if (!result.ok) return result
  return {
    ok: true,
    feature: authoredTreatment(context, values, base.target, result.parameters, v3),
  }
}
