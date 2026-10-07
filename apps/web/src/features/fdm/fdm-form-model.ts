import {
  createAngleQuantity,
  createLengthQuantity,
  type DocumentDisplayUnits,
  evaluateExpression,
  evaluateVariableDefinitions,
  type FeatureId,
  type FeatureRecord,
  featureRecordSchema,
  quantitySchema,
  type SketchRecord,
  type VariableDefinition,
} from "@vibeshape/domain"
import {
  type FdmFeatureParameters,
  fdmDependencyIds,
  fdmFeatureParametersSchema,
  fdmFeatureType,
  readFdmFeatureParameters,
} from "@vibeshape/domain/part-design-fdm"
import type { ReferencePlane } from "@vibeshape/domain/reference-frame"
import { normalizeExpressionWithDisplayUnit } from "../../document/document-display-units"
import { type ExactBodyOption, exactBodyOptionId } from "../part-design/exact-body-options"
import {
  type FdmToolKind,
  fdmFieldDefinitions,
  fdmOriginFields,
  fdmToolFields,
} from "./fdm-form-fields"

export type FdmFormValues = {
  fields: Record<string, string>
  targetId: string
  axis: "X" | "Y" | "Z"
  sketchId: string
  lineIds: string[]
  style: "web" | "rib"
  direction: "forward" | "reverse"
  extendToWalls: boolean
  flatTop: boolean
  jointMode: "lip" | "groove"
  membraneMode: "sheet" | "bridges"
  stopPlane: ReferencePlane | null
}
export type FdmFormMode =
  | { kind: "create"; createFeatureId: () => FeatureId; featureLabel: string }
  | { kind: "edit"; feature: FeatureRecord }

function sourceValue(value: unknown): string | null {
  if (typeof value === "number") return String(value)
  const parsed = quantitySchema.safeParse(value)
  if (!parsed.success) return null
  return parsed.data.source.expression ?? `${parsed.data.source.value} ${parsed.data.source.unit}`
}

function defaultFields(kind: FdmToolKind) {
  const fields = Object.fromEntries(
    Object.entries(fdmFieldDefinitions).map(([field, [value, dimension]]) => {
      const unit = { length: " mm", angle: " deg", scalar: "" }[dimension]
      return [field, `${value}${unit}`]
    }),
  )
  const overrides: Partial<Record<FdmToolKind, Record<string, string>>> = {
    web: { thickness: "1 mm" },
    "seam-groove": { width: "0.6 mm", depth: "0.6 mm" },
    "calibration-coupon": { thickness: "3 mm" },
  }
  return { ...fields, ...overrides[kind] }
}

function restoredFields(kind: FdmToolKind, parameters: FdmFeatureParameters | null) {
  const fields = defaultFields(kind)
  if (!parameters) return fields
  for (const field of fdmToolFields[kind]) {
    const value = sourceValue(Reflect.get(parameters, field))
    if (value !== null) fields[field] = value
  }
  if (parameters.kind === "web") return fields
  for (const [index, coordinate] of ["x", "y", "z"].entries()) {
    const field = fdmOriginFields[index]
    if (field) fields[field] = sourceValue(Reflect.get(parameters.origin, coordinate)) ?? "0 mm"
  }
  return fields
}

function webValues(parameters: FdmFeatureParameters | null) {
  const defaults = {
    sketchId: "",
    lineIds: [] as string[],
    style: "web" as const,
    direction: "forward" as const,
    extendToWalls: false,
    stopPlane: null,
  }
  if (parameters?.kind !== "web") return defaults
  return {
    sketchId: parameters.sketchId,
    lineIds: [...parameters.lineIds],
    style: parameters.style,
    direction: parameters.direction,
    extendToWalls: parameters.extendToWalls,
    stopPlane: parameters.stopPlane ?? null,
  }
}

export function fdmFormValues(kind: FdmToolKind, mode: FdmFormMode): FdmFormValues {
  const saved = mode.kind === "edit" ? readFdmFeatureParameters(mode.feature) : null
  const parameters = saved?.kind === kind ? saved : null
  const target = parameters && "targetBody" in parameters ? parameters.targetBody : null
  return {
    fields: restoredFields(kind, parameters),
    targetId: target ? exactBodyOptionId(target) : "",
    axis: parameters && parameters.kind !== "web" ? parameters.axis : "Z",
    ...webValues(parameters),
    flatTop: parameters?.kind === "teardrop-hole" ? parameters.flatTop : false,
    jointMode: parameters?.kind === "enclosure-joint" ? parameters.mode : "lip",
    membraneMode: parameters?.kind === "membrane" ? parameters.mode : "sheet",
  }
}

type FdmParseResult =
  | { ok: true; parameters: FdmFeatureParameters; references: FeatureRecord["references"] }
  | { ok: false; issues: Record<string, string> }
type FdmParseCopy = { invalidExpression: string; invalidRange: string; unavailable: string }

export function activeFdmFields(kind: FdmToolKind, membraneMode: "sheet" | "bridges") {
  const fields = fdmToolFields[kind].filter(
    (field) =>
      membraneMode === "bridges" ||
      kind !== "membrane" ||
      (field !== "bridgeCount" && field !== "bridgeWidth"),
  )
  return [...fields, ...(kind === "web" ? [] : fdmOriginFields)]
}

function fieldQuantity(
  field: keyof typeof fdmFieldDefinitions,
  raw: string,
  units: DocumentDisplayUnits,
  variables: Parameters<typeof evaluateExpression>[1],
) {
  const dimension = fdmFieldDefinitions[field][1]
  const expression =
    dimension === "scalar" ? raw.trim() : normalizeExpressionWithDisplayUnit(raw, units[dimension])
  const result = evaluateExpression(expression, variables)
  if (!result.ok || result.value.dimension !== dimension) return { ok: false as const }
  const value = result.value.value
  if (dimension === "scalar") return { ok: true as const, value }
  return {
    ok: true as const,
    value:
      dimension === "length"
        ? createLengthQuantity(value, "mm", expression)
        : createAngleQuantity(value, "rad", expression),
  }
}

function parsedDimensions(
  kind: FdmToolKind,
  values: FdmFormValues,
  variables: readonly VariableDefinition[],
  units: DocumentDisplayUnits,
  copy: FdmParseCopy,
) {
  const dimensions: Record<string, unknown> = {},
    issues: Record<string, string> = {}
  const evaluated = evaluateVariableDefinitions(variables)
  if (!evaluated.ok) return { dimensions, issues: { parameters: copy.invalidExpression } }
  for (const field of activeFdmFields(kind, values.membraneMode)) {
    const result = fieldQuantity(field, values.fields[field] ?? "", units, evaluated.valuesByName)
    if (!result.ok) {
      issues[field] = copy.invalidExpression
      continue
    }
    const isBoss = field === "bossDiameter" || field === "bossHeight"
    if (isBoss && typeof result.value !== "number" && result.value.value === 0) continue
    dimensions[field] = result.value
  }
  return { dimensions, issues }
}

function webCandidate(
  values: FdmFormValues,
  dimensions: Record<string, unknown>,
  target: ExactBodyOption["body"] | undefined,
  sketches: readonly SketchRecord[],
  issues: Record<string, string>,
  copy: FdmParseCopy,
) {
  const sketch = sketches.find(({ id }) => id === values.sketchId)
  const available = new Set<string>(
    sketch?.entities
      .filter((entity) => entity.type === "line" && !entity.construction)
      .map(({ id }) => id),
  )
  if (!sketch || !values.lineIds.length || values.lineIds.some((id) => !available.has(id)))
    issues.sketchId = copy.unavailable
  return {
    references: sketch?.support ? [sketch.support.reference] : [],
    candidate: {
      kind: "web",
      ...dimensions,
      targetBody: target,
      sketchId: values.sketchId,
      lineIds: values.lineIds,
      direction: values.direction,
      style: values.style,
      extendToWalls: values.extendToWalls,
      ...(values.stopPlane ? { stopPlane: values.stopPlane } : {}),
    },
  }
}

function spatialCandidate(
  kind: FdmToolKind,
  values: FdmFormValues,
  dimensions: Record<string, unknown>,
  target: ExactBodyOption["body"] | undefined,
) {
  const { originX, originY, originZ, ...parameters } = dimensions
  const modes: Partial<Record<FdmToolKind, Record<string, unknown>>> = {
    "teardrop-hole": { flatTop: values.flatTop },
    "enclosure-joint": { mode: values.jointMode },
    membrane: { mode: values.membraneMode },
  }
  return {
    references: [],
    candidate: {
      kind,
      ...parameters,
      axis: values.axis,
      origin: { x: originX, y: originY, z: originZ },
      ...(target && kind !== "calibration-coupon" ? { targetBody: target } : {}),
      ...modes[kind],
    },
  }
}

function fieldIssueKey(path: readonly PropertyKey[]) {
  if (path[0] === "origin") return `origin${String(path[1]).toUpperCase()}`
  if (path[0] === "targetBody") return "targetId"
  return String(path[0] ?? "parameters")
}

export function parseFdmForm(
  kind: FdmToolKind,
  values: FdmFormValues,
  options: readonly ExactBodyOption[],
  sketches: readonly SketchRecord[],
  variables: readonly VariableDefinition[],
  units: DocumentDisplayUnits,
  copy: FdmParseCopy,
): FdmParseResult {
  const { dimensions, issues } = parsedDimensions(kind, values, variables, units, copy)
  const target = options.find(({ id }) => id === values.targetId)?.body
  if (values.targetId && !target) issues.targetId = copy.unavailable
  if (!target && kind !== "calibration-coupon" && kind !== "flexible-sleeve")
    issues.targetId = copy.unavailable
  const { references, candidate } =
    kind === "web"
      ? webCandidate(values, dimensions, target, sketches, issues, copy)
      : spatialCandidate(kind, values, dimensions, target)
  const parsed = fdmFeatureParametersSchema.safeParse(candidate)
  if (!parsed.success)
    for (const issue of parsed.error.issues) issues[fieldIssueKey(issue.path)] ??= copy.invalidRange
  if (Object.keys(issues).length || !parsed.success) return { ok: false, issues }
  return { ok: true, parameters: parsed.data, references }
}

export function fdmFormFeature(
  mode: FdmFormMode,
  id: FeatureId,
  parsed: Extract<ReturnType<typeof parseFdmForm>, { ok: true }>,
) {
  return featureRecordSchema.parse({
    ...(mode.kind === "edit"
      ? mode.feature
      : { schemaVersion: 0, id, suppressed: false, label: mode.featureLabel }),
    type: fdmFeatureType.type,
    parameters: parsed.parameters,
    references: parsed.references,
    dependencies: fdmDependencyIds(parsed.parameters, parsed.references[0]?.featureId ?? null),
  })
}
