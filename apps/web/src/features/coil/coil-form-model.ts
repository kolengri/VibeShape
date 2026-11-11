import {
  type DocumentDisplayUnits,
  evaluateVariableDefinitions,
  type FeatureId,
  type FeatureRecord,
  featureRecordSchema,
  type Quantity,
  type VariableDefinition,
} from "@vibeshape/domain"
import {
  type CoilFeatureParameters,
  coilDependencyIds,
  coilFeatureParametersSchema,
  coilFeatureType,
  coilSectionMillimeters,
  coilSectionSizeSchema,
  readCoilFeatureParameters,
} from "@vibeshape/domain/part-design-coil"
import { minimumCoilPitch } from "@vibeshape/domain/part-design-helix"
import { defaultLengthExpression } from "../../document/document-display-units"
import { type ExactBodyOption, exactBodyOptionId } from "../part-design/exact-body-options"
import {
  type HelixFieldIssues,
  type HelixFormValues,
  type HelixValidationCopy,
  helixFormValues,
  parseHelixForm,
  parseQuantityExpression,
  sourceExpression,
} from "./helix-form-model"

export type CoilOperation = CoilFeatureParameters["operation"]
export type CoilFormValues = HelixFormValues & {
  sectionKind: "circular" | "rectangular"
  diameter: string
  sectionWidth: string
  sectionHeight: string
  operation: CoilOperation
  targetId: string
}
export type CoilFormMode =
  | Readonly<{ kind: "create"; createFeatureId: () => FeatureId; featureLabel: string }>
  | Readonly<{ kind: "edit"; feature: FeatureRecord }>
export type CoilValidationCopy = HelixValidationCopy &
  Readonly<{
    validationSummary: string
    missingTarget: string
    sectionReachesAxis: string
    turnsOutOfRange: string
    selfIntersection: (minimumPitch: number) => string
    selfIntersectionAnyPitch: string
  }>
type SectionField = "diameter" | "sectionWidth" | "sectionHeight"
export type CoilFieldIssues = HelixFieldIssues &
  Partial<Record<SectionField | "targetId" | "extent", string>>

export function coilFormValues(
  mode: CoilFormMode,
  units: DocumentDisplayUnits,
  targets: readonly ExactBodyOption[],
): CoilFormValues {
  const parameters = mode.kind === "edit" ? readCoilFeatureParameters(mode.feature) : null
  const section = parameters?.section
  return {
    ...helixFormValues(parameters, units),
    sectionKind: section?.kind ?? "circular",
    diameter:
      section?.kind === "circular"
        ? sourceExpression(section.diameter)
        : defaultLengthExpression(2, units.length),
    sectionWidth:
      section?.kind === "rectangular"
        ? sourceExpression(section.width)
        : defaultLengthExpression(2, units.length),
    sectionHeight:
      section?.kind === "rectangular"
        ? sourceExpression(section.height)
        : defaultLengthExpression(1, units.length),
    operation: parameters?.operation ?? "new",
    targetId: parameters?.targetBody
      ? exactBodyOptionId(parameters.targetBody)
      : (targets[0]?.id ?? ""),
  }
}

function sectionValues(
  values: CoilFormValues,
  variables: readonly VariableDefinition[],
  units: DocumentDisplayUnits,
  copy: CoilValidationCopy,
) {
  const evaluated = evaluateVariableDefinitions(variables)
  if (!evaluated.ok) return { issues: { diameter: copy.invalidExpression } as CoilFieldIssues }
  const fields: readonly SectionField[] =
    values.sectionKind === "circular" ? ["diameter"] : ["sectionWidth", "sectionHeight"]
  const issues: CoilFieldIssues = {}
  const quantities: Partial<Record<SectionField, Quantity>> = {}
  for (const field of fields) {
    const result = parseQuantityExpression(
      values[field],
      "length",
      coilSectionSizeSchema,
      evaluated.valuesByName,
      units,
      copy,
    )
    if (result.ok) quantities[field] = result.quantity
    else issues[field] = result.message
  }
  if (Object.keys(issues).length) return { issues }
  return {
    section:
      values.sectionKind === "circular"
        ? { kind: "circular", diameter: quantities.diameter }
        : { kind: "rectangular", width: quantities.sectionWidth, height: quantities.sectionHeight },
  }
}

function target(values: CoilFormValues, options: readonly ExactBodyOption[]) {
  if (values.operation === "new") return { ok: true as const, body: null }
  const body = options.find(({ id }) => id === values.targetId)?.body
  return body ? { ok: true as const, body } : { ok: false as const }
}

function crossFieldIssues(
  error: { issues: readonly { path: PropertyKey[] }[] },
  candidate: CoilFeatureParameters,
  values: CoilFormValues,
  copy: CoilValidationCopy,
): CoilFieldIssues {
  const issues: CoilFieldIssues = {}
  for (const issue of error.issues) {
    const field = issue.path[0]
    if (field === "pitch") {
      const minimum = minimumCoilPitch(
        candidate.radius.value,
        coilSectionMillimeters(candidate.section),
      )
      // Round up so the displayed minimum is itself a clear pitch.
      issues.pitch = Number.isFinite(minimum)
        ? copy.selfIntersection(Math.ceil(minimum * 1000) / 1000)
        : copy.selfIntersectionAnyPitch
    } else if (field === "section")
      issues[values.sectionKind === "circular" ? "diameter" : "sectionWidth"] =
        copy.sectionReachesAxis
    else if (field === "extent") issues[values.extentKind] = copy.turnsOutOfRange
    else if (field === "targetBody") issues.targetId = copy.missingTarget
  }
  return Object.keys(issues).length ? issues : { radius: copy.validationSummary }
}

export type ParsedCoilForm =
  | { ok: true; parameters: CoilFeatureParameters }
  | { ok: false; issues: CoilFieldIssues }

export function parseCoilForm(
  values: CoilFormValues,
  options: readonly ExactBodyOption[],
  variables: readonly VariableDefinition[],
  units: DocumentDisplayUnits,
  copy: CoilValidationCopy,
): ParsedCoilForm {
  const helix = parseHelixForm(values, variables, units, copy)
  const section = sectionValues(values, variables, units, copy)
  const body = target(values, options)
  const issues: CoilFieldIssues = {
    ...(helix.ok ? {} : helix.issues),
    ...("issues" in section ? section.issues : {}),
    ...(body.ok ? {} : { targetId: copy.missingTarget }),
  }
  if (!helix.ok || !("section" in section) || !body.ok) return { ok: false, issues }
  const candidate = {
    ...helix.parameters,
    section: section.section,
    operation: values.operation,
    targetBody: body.body,
  }
  const parsed = coilFeatureParametersSchema.safeParse(candidate)
  return parsed.success
    ? { ok: true, parameters: parsed.data }
    : {
        ok: false,
        issues: crossFieldIssues(parsed.error, candidate as CoilFeatureParameters, values, copy),
      }
}

export function coilFeatureRecord(
  mode: CoilFormMode,
  featureId: FeatureId,
  parameters: CoilFeatureParameters,
): FeatureRecord {
  const common = {
    type: coilFeatureType.type,
    parameters,
    dependencies: coilDependencyIds(parameters),
    references: [],
  }
  return featureRecordSchema.parse(
    mode.kind === "edit"
      ? { ...mode.feature, ...common }
      : {
          schemaVersion: 0,
          id: featureId,
          ...common,
          suppressed: false,
          label: mode.featureLabel,
        },
  )
}
