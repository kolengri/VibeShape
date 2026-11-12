import type { EdgeTopoRef, LengthQuantity } from "@vibeshape/domain"
import type { BodyTopoRef } from "@vibeshape/domain/body-topology-reference"
import {
  type FilletFeatureParametersV3,
  type FilletTarget,
  filletFeatureParametersV3Schema,
} from "@vibeshape/domain/part-design"
import { quantityExpression } from "../part-design/primitive-form"
import { sameTreatmentReference } from "./edge-treatment-candidates"
import type { TreatmentIssues, TreatmentValues } from "./edge-treatment-model"
import { type EdgeTreatmentTargetOption, edgeTreatmentRequiresV3 } from "./edge-treatment-options"

/** Draft linear radius law for one edge target; expressions are parsed only when authoring. */
export type FilletVariableRadiusDraft = Readonly<{
  /** The stored row reference: legacy while the feature is V2, body-bound once promoted. */
  edge: EdgeTopoRef | BodyTopoRef
  startRadius: string
  endRadius: string
  reverse: boolean
}>

function selectedEdge(values: TreatmentValues, edge: EdgeTopoRef | BodyTopoRef) {
  return (
    values.targets.some(
      (target) => target.kind === "edge" && sameTreatmentReference(target.edge, edge),
    ) || values.references.some((reference) => sameTreatmentReference(reference, edge))
  )
}

/** Laws whose edge is still selected; removing an edge target removes its law. */
function activeVariableRadii(values: TreatmentValues) {
  return values.variableRadii.filter(({ edge }) => selectedEdge(values, edge))
}

export function variableRadiusFor(values: TreatmentValues, edge: EdgeTopoRef | BodyTopoRef) {
  return values.variableRadii.find((entry) => sameTreatmentReference(entry.edge, edge))
}

export function withoutVariableRadius(
  values: TreatmentValues,
  edge: EdgeTopoRef | BodyTopoRef,
): TreatmentValues["variableRadii"] {
  return values.variableRadii.filter((entry) => !sameTreatmentReference(entry.edge, edge))
}

/** Adds or replaces the law for one stored edge reference, or removes it when `draft` is null. */
export function setVariableRadius(
  values: TreatmentValues,
  edge: EdgeTopoRef | BodyTopoRef,
  draft: Omit<FilletVariableRadiusDraft, "edge"> | null,
): TreatmentValues {
  const rest = withoutVariableRadius(values, edge)
  return { ...values, variableRadii: draft ? [...rest, { ...draft, edge }] : rest }
}

/**
 * Single owner of the Fillet schema route. Named or multi-output bodies, face targets and
 * variable radius author V3; All edges stays V1 and plain selections on a verified single-result
 * body stay V2. A saved V3 feature keeps V3. A failed V3 build is never retried through V2.
 */
export function filletUsesV3(
  values: TreatmentValues,
  option: EdgeTreatmentTargetOption | undefined,
) {
  if (edgeTreatmentRequiresV3(option)) return true
  if (values.scope === "all") return false
  return (
    values.retainV3 ||
    values.targets.some(({ kind }) => kind === "face") ||
    activeVariableRadii(values).length > 0
  )
}

export type FilletV3Copy = Readonly<{
  missingCatalogue: string
  validationSummary: string
  variableRadiusEqual: string
  variableRadiusClosed: string
}>
type LengthParser = (
  raw: string,
) => { ok: true; quantity: LengthQuantity } | { ok: false; message: string }
/** Which part of one edge's law is invalid; `edge` covers the law as a whole. */
export type VariableRadiusIssue = Readonly<{
  field: "startRadius" | "endRadius" | "edge"
  message: string
}>
type FilletV3Result =
  | { ok: true; parameters: FilletFeatureParametersV3 }
  | { ok: false; issues: TreatmentIssues }

function variableRadius(
  draft: FilletVariableRadiusDraft,
  edge: EdgeTopoRef | BodyTopoRef,
  parse: LengthParser,
  copy: FilletV3Copy,
) {
  const fail = (field: VariableRadiusIssue["field"], message: string) =>
    ({ ok: false, issue: { field, message } }) as const
  // Closed edges have no endpoints, so their direction cannot be defined deterministically.
  if (edge.signature.boundaryCount !== 2) return fail("edge", copy.variableRadiusClosed)
  const start = parse(draft.startRadius)
  if (!start.ok) return fail("startRadius", start.message)
  const end = parse(draft.endRadius)
  if (!end.ok) return fail("endRadius", end.message)
  if (start.quantity.value === end.quantity.value) return fail("edge", copy.variableRadiusEqual)
  return {
    ok: true as const,
    law: { startRadius: start.quantity, endRadius: end.quantity, reverse: draft.reverse },
  }
}

export function filletV3Parameters(
  values: TreatmentValues,
  option: EdgeTreatmentTargetOption | undefined,
  radius: LengthQuantity,
  parse: LengthParser,
  copy: FilletV3Copy,
): FilletV3Result {
  if (!option?.body || !option.edgeEvidence || !option.faceEvidence)
    return { ok: false, issues: { references: copy.missingCatalogue } }
  const targets: FilletTarget[] = []
  for (const target of values.targets) {
    if (target.kind === "face") {
      targets.push(target)
      continue
    }
    const draft = variableRadiusFor(values, target.edge)
    if (!draft) {
      targets.push({ kind: "edge", edge: target.edge })
      continue
    }
    const law = variableRadius(draft, target.edge, parse, copy)
    if (!law.ok) return { ok: false, issues: { variableRadii: law.issue.message } }
    targets.push({ kind: "edge", edge: target.edge, variableRadius: law.law })
  }
  const parsed = filletFeatureParametersV3Schema.safeParse({
    targetBody: option.body,
    radius,
    targets,
  })
  return parsed.success
    ? { ok: true, parameters: parsed.data }
    : { ok: false, issues: { references: copy.validationSummary } }
}

/** The first invalid part of one row's law, shown under that row; null when it is valid or off. */
export function variableRadiusIssue(
  values: TreatmentValues,
  edge: EdgeTopoRef | BodyTopoRef,
  parse: LengthParser,
  copy: FilletV3Copy,
): VariableRadiusIssue | null {
  const draft = variableRadiusFor(values, edge)
  const law = draft ? variableRadius(draft, edge, parse, copy) : null
  return law && !law.ok ? law.issue : null
}

/** Saved V3 laws become editable drafts; constant targets stay plain edge targets. */
export function filletDraftTargets(parameters: FilletFeatureParametersV3) {
  const variableRadii: FilletVariableRadiusDraft[] = []
  const targets = parameters.targets.map((target) => {
    if (target.kind === "face" || !target.variableRadius) return target
    const law = target.variableRadius
    variableRadii.push({
      edge: target.edge,
      startRadius: quantityExpression(law.startRadius),
      endRadius: quantityExpression(law.endRadius),
      reverse: law.reverse,
    })
    return { kind: "edge" as const, edge: target.edge }
  })
  return { targets, variableRadii }
}
