import {
  createLengthQuantity,
  type DocumentDisplayUnits,
  evaluateExpression,
  evaluateVariableDefinitions,
  type FeatureRecord,
  type LengthQuantity,
  primitiveOriginSchema,
  type VariableDefinition,
} from "@vibeshape/domain"
import type { FeatureMutationResult } from "../../document/document-controller"
import {
  defaultLengthExpression,
  normalizeExpressionWithDisplayUnit,
} from "../../document/document-display-units"

export type PrimitiveLengthCopy = Readonly<{
  invalidExpression: string
  invalidDimension: string
  invalidRange: string
}>

export type PrimitiveOriginField = "originX" | "originY" | "originZ"

export type PrimitiveOriginFormValues = Readonly<Record<PrimitiveOriginField, string>>

export function defaultPrimitiveOriginValues(
  displayUnit: DocumentDisplayUnits["length"],
): PrimitiveOriginFormValues {
  const zero = defaultLengthExpression(0, displayUnit)
  return { originX: zero, originY: zero, originZ: zero }
}

export function primitiveOriginFormValues(
  origin: ReturnType<typeof primitiveOriginSchema.parse>,
): PrimitiveOriginFormValues {
  return {
    originX: quantityExpression(origin.x),
    originY: quantityExpression(origin.y),
    originZ: quantityExpression(origin.z),
  }
}

export function parsePrimitiveOriginValues(
  values: PrimitiveOriginFormValues,
  variables: readonly VariableDefinition[],
  copy: PrimitiveLengthCopy & Readonly<{ invalidPositionRange: string }>,
  displayUnit: DocumentDisplayUnits["length"],
) {
  const positionCopy = { ...copy, invalidRange: copy.invalidPositionRange }
  const parsed = {
    originX: parsePrimitiveLengthExpression(
      values.originX,
      variables,
      positionCopy,
      (quantity) => primitiveOriginSchema.shape.x.safeParse(quantity).success,
      displayUnit,
    ),
    originY: parsePrimitiveLengthExpression(
      values.originY,
      variables,
      positionCopy,
      (quantity) => primitiveOriginSchema.shape.y.safeParse(quantity).success,
      displayUnit,
    ),
    originZ: parsePrimitiveLengthExpression(
      values.originZ,
      variables,
      positionCopy,
      (quantity) => primitiveOriginSchema.shape.z.safeParse(quantity).success,
      displayUnit,
    ),
  }
  const issues: Partial<Record<PrimitiveOriginField, string>> = {}
  for (const field of ["originX", "originY", "originZ"] as const) {
    const result = parsed[field]
    if (!result.ok) issues[field] = result.message
  }
  if (!parsed.originX.ok || !parsed.originY.ok || !parsed.originZ.ok) {
    return { ok: false as const, issues }
  }
  return {
    ok: true as const,
    origin: primitiveOriginSchema.parse({
      x: parsed.originX.quantity,
      y: parsed.originY.quantity,
      z: parsed.originZ.quantity,
    }),
  }
}

export type FeatureParameterFormProps<Mode, Copy> = Readonly<{
  baseRevision: number
  copy: Copy
  disabled?: boolean
  mode: Mode
  onCancel: () => void
  onSave: (baseRevision: number, feature: FeatureRecord) => Promise<FeatureMutationResult>
  onSaved: () => void
  variables: readonly VariableDefinition[]
}>

export function quantityExpression(quantity: LengthQuantity) {
  return quantity.source.expression ?? `${quantity.source.value} ${quantity.source.unit}`
}

export function parsePrimitiveLengthExpression(
  rawExpression: string,
  variables: readonly VariableDefinition[],
  copy: PrimitiveLengthCopy,
  accepts: (quantity: LengthQuantity) => boolean,
  displayUnit: DocumentDisplayUnits["length"] = "mm",
) {
  const expression = normalizeExpressionWithDisplayUnit(rawExpression, displayUnit)
  const evaluatedVariables = evaluateVariableDefinitions(variables)
  if (!evaluatedVariables.ok) return { ok: false as const, message: copy.invalidExpression }
  const evaluated = evaluateExpression(expression, evaluatedVariables.valuesByName)
  if (!evaluated.ok) return { ok: false as const, message: copy.invalidExpression }
  if (evaluated.value.dimension !== "length") {
    return { ok: false as const, message: copy.invalidDimension }
  }
  const quantity = createLengthQuantity(evaluated.value.value, "mm", expression)
  return accepts(quantity)
    ? { ok: true as const, quantity }
    : { ok: false as const, message: copy.invalidRange }
}

export function featureSubmissionMessage(
  result: FeatureMutationResult,
  copy: Readonly<{ staleRevision: string; saveFailed: string }>,
) {
  if (result.ok) return null
  if (
    result.diagnostic.sourceCode === "stale-revision" ||
    result.diagnostic.code === "write-access-unavailable"
  ) {
    return copy.staleRevision
  }
  return copy.saveFailed
}

export async function submitFeatureMutation({
  baseRevision,
  copy,
  feature,
  onSave,
  onSaved,
  setMessage,
}: Readonly<{
  baseRevision: number
  copy: Readonly<{ staleRevision: string; saveFailed: string }>
  feature: FeatureRecord
  onSave: (baseRevision: number, feature: FeatureRecord) => Promise<FeatureMutationResult>
  onSaved: () => void
  setMessage: (message: string | null) => void
}>) {
  const result = await onSave(baseRevision, feature)
  const message = featureSubmissionMessage(result, copy)
  setMessage(message)
  if (!message) onSaved()
}
