import {
  type DocumentDisplayUnits,
  type FeatureId,
  type FeatureRecord,
  featureRecordSchema,
  type VariableDefinition,
} from "@vibeshape/domain"
import type { BodyReference } from "@vibeshape/domain/body-reference"
import {
  type SplitFeatureParameters,
  splitFeatureParametersSchema,
  splitFeatureType,
} from "@vibeshape/domain/part-design-split"
import { defaultLengthExpression } from "../../document/document-display-units"
import {
  type PrimitiveLengthCopy,
  parsePrimitiveLengthExpression,
  quantityExpression,
} from "../part-design/primitive-form"

export type SplitPlane = SplitFeatureParameters["plane"]
export type SplitBounds = Readonly<{
  min: readonly [number, number, number]
  max: readonly [number, number, number]
}>
export type SplitFormValues = { plane: SplitPlane; offset: string }
export type SplitFormMode =
  | {
      kind: "create"
      targetBody: BodyReference
      createFeatureId: () => FeatureId
      featureLabel: string
    }
  | { kind: "edit"; feature: FeatureRecord }

export function splitTargetBody(mode: SplitFormMode) {
  return mode.kind === "create"
    ? mode.targetBody
    : splitFeatureParametersSchema.parse(mode.feature.parameters).targetBody
}
export function splitMidpointExpression(
  bounds: SplitBounds,
  plane: SplitPlane,
  units: DocumentDisplayUnits,
) {
  const axis = ({ XY: 2, XZ: 1, YZ: 0 } as const)[plane]
  return defaultLengthExpression((bounds.min[axis] + bounds.max[axis]) / 2, units.length)
}
export function splitFormValues(
  mode: SplitFormMode,
  bounds: SplitBounds | null,
  units: DocumentDisplayUnits,
): SplitFormValues {
  if (mode.kind === "edit") {
    const { plane, offset } = splitFeatureParametersSchema.parse(mode.feature.parameters)
    return { plane, offset: quantityExpression(offset) }
  }
  return {
    plane: "XY",
    offset: bounds
      ? splitMidpointExpression(bounds, "XY", units)
      : defaultLengthExpression(0, units.length),
  }
}
export function parseSplitForm(
  values: SplitFormValues,
  variables: readonly VariableDefinition[],
  units: DocumentDisplayUnits,
  copy: PrimitiveLengthCopy,
) {
  const offset = parsePrimitiveLengthExpression(
    values.offset,
    variables,
    copy,
    (quantity) => splitFeatureParametersSchema.shape.offset.safeParse(quantity).success,
    units.length,
  )
  return offset.ok
    ? { ok: true as const, plane: values.plane, offset: offset.quantity }
    : { ok: false as const, issues: { offset: offset.message } }
}
export function splitFeatureRecord(
  mode: SplitFormMode,
  featureId: FeatureId,
  parsed: Extract<ReturnType<typeof parseSplitForm>, { ok: true }>,
) {
  const targetBody = splitTargetBody(mode)
  const parameters = splitFeatureParametersSchema.parse({
    targetBody,
    plane: parsed.plane,
    offset: parsed.offset,
  })
  return featureRecordSchema.parse(
    mode.kind === "edit"
      ? { ...mode.feature, parameters }
      : {
          schemaVersion: 0,
          id: featureId,
          type: splitFeatureType.type,
          parameters,
          dependencies: [targetBody.featureId],
          references: [],
          suppressed: false,
          label: mode.featureLabel,
        },
  )
}
