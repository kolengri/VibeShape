import {
  createScalarQuantity,
  type DocumentDisplayUnits,
  type FeatureId,
  type FeatureRecord,
  type LengthQuantity,
  type VariableDefinition,
} from "@vibeshape/domain"
import {
  readScaleFeatureParameters,
  type ScaleCenter,
  scaleCoordinateSchema,
  scaleFactorSchema,
  scaleFeatureParametersSchema,
  scaleFeatureType,
} from "@vibeshape/domain/part-design-scale"
import { defaultLengthExpression } from "../../document/document-display-units"
import { type BodyFeatureFormMode, bodyFeatureRecord } from "../part-design/body-feature-record"
import {
  evaluateFormExpression,
  type PrimitiveLengthCopy,
  parsePrimitiveLengthExpression,
  quantityExpression,
} from "../part-design/primitive-form"

export type ScaleFormMode = BodyFeatureFormMode
export type ScaleCenterKind = ScaleCenter["kind"]
export type ScaleFormValues = {
  factor: string
  center: ScaleCenterKind
  centerX: string
  centerY: string
  centerZ: string
}
export type ScaleValidationCopy = PrimitiveLengthCopy &
  Readonly<{ invalidFactorDimension: string; invalidFactorRange: string }>
type ScaleFormIssues = Partial<Record<keyof ScaleFormValues, string>>

function scaleTargetBody(mode: ScaleFormMode) {
  return mode.kind === "create"
    ? mode.targetBody
    : scaleFeatureParametersSchema.parse(mode.feature.parameters).targetBody
}

export function scaleFormValues(mode: ScaleFormMode, units: DocumentDisplayUnits): ScaleFormValues {
  const zero = defaultLengthExpression(0, units.length)
  const parameters = mode.kind === "edit" ? readScaleFeatureParameters(mode.feature) : null
  const point = parameters?.center.kind === "point" ? parameters.center.point : null
  const coordinate = (quantity: LengthQuantity | undefined) =>
    quantity ? quantityExpression(quantity) : zero
  return {
    factor: parameters
      ? (parameters.factor.source.expression ?? String(parameters.factor.source.value))
      : "2",
    center: parameters?.center.kind ?? "bounding-box-center",
    centerX: coordinate(point?.x),
    centerY: coordinate(point?.y),
    centerZ: coordinate(point?.z),
  }
}

function parseFactor(
  raw: string,
  variables: readonly VariableDefinition[],
  copy: ScaleValidationCopy,
) {
  const expression = raw.trim()
  const evaluated = evaluateFormExpression(expression, variables)
  if (!evaluated) return { ok: false as const, message: copy.invalidExpression }
  if (evaluated.dimension !== "scalar")
    return { ok: false as const, message: copy.invalidFactorDimension }
  const quantity = createScalarQuantity(evaluated.value, expression)
  return scaleFactorSchema.safeParse(quantity).success
    ? { ok: true as const, quantity }
    : { ok: false as const, message: copy.invalidFactorRange }
}

function parseCenter(
  values: ScaleFormValues,
  variables: readonly VariableDefinition[],
  units: DocumentDisplayUnits,
  copy: ScaleValidationCopy,
): { ok: true; center: ScaleCenter } | { ok: false; issues: ScaleFormIssues } {
  if (values.center !== "point") return { ok: true, center: { kind: values.center } }
  const fields = ["centerX", "centerY", "centerZ"] as const
  const parsed = fields.map((field) =>
    parsePrimitiveLengthExpression(
      values[field],
      variables,
      copy,
      (quantity) => scaleCoordinateSchema.safeParse(quantity).success,
      units.length,
    ),
  )
  const [x, y, z] = parsed
  if (x?.ok && y?.ok && z?.ok)
    return {
      ok: true,
      center: { kind: "point", point: { x: x.quantity, y: y.quantity, z: z.quantity } },
    }
  return {
    ok: false,
    issues: Object.fromEntries(
      parsed.flatMap((result, index) => (result.ok ? [] : [[fields[index], result.message]])),
    ),
  }
}

export function parseScaleForm(
  values: ScaleFormValues,
  variables: readonly VariableDefinition[],
  units: DocumentDisplayUnits,
  copy: ScaleValidationCopy,
) {
  const factor = parseFactor(values.factor, variables, copy)
  const center = parseCenter(values, variables, units, copy)
  if (!factor.ok || !center.ok)
    return {
      ok: false as const,
      issues: {
        ...(factor.ok ? {} : { factor: factor.message }),
        ...(center.ok ? {} : center.issues),
      } satisfies ScaleFormIssues,
    }
  return { ok: true as const, factor: factor.quantity, center: center.center }
}

export function scaleFeatureRecord(
  mode: ScaleFormMode,
  featureId: FeatureId,
  parsed: Extract<ReturnType<typeof parseScaleForm>, { ok: true }>,
): FeatureRecord {
  const targetBody = scaleTargetBody(mode)
  return bodyFeatureRecord(mode, featureId, {
    type: scaleFeatureType.type,
    parameters: scaleFeatureParametersSchema.parse({
      targetBody,
      factor: parsed.factor,
      center: parsed.center,
    }),
    dependencies: [targetBody.featureId],
  })
}
