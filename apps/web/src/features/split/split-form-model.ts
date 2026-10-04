import type {
  DocumentDisplayUnits,
  FeatureId,
  FeatureRecord,
  VariableDefinition,
} from "@vibeshape/domain"
import type { BodyReference } from "@vibeshape/domain/body-reference"
import {
  readSplitFeatureParametersV2,
  type SplitFeatureParameters,
  splitFeatureParametersSchema,
  splitFeatureParametersV2Schema,
  splitFeatureType,
  splitFeatureTypeV2,
} from "@vibeshape/domain/part-design-split"
import { type ReferencePlane, referenceFrameDependencyIds } from "@vibeshape/domain/reference-frame"
import { defaultLengthExpression } from "../../document/document-display-units"
import { bodyFeatureRecord } from "../part-design/body-feature-record"
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
    : (
        readSplitFeatureParametersV2(mode.feature) ??
        splitFeatureParametersSchema.parse(mode.feature.parameters)
      ).targetBody
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
    const v2 = readSplitFeatureParametersV2(mode.feature)
    if (v2)
      return {
        plane: v2.plane.kind === "origin-plane" ? v2.plane.plane : "XY",
        offset: quantityExpression(v2.offset),
      }
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
  referencePlane?: ReferencePlane | undefined,
) {
  const targetBody = splitTargetBody(mode)
  const v2 =
    referencePlane !== undefined || (mode.kind === "edit" && mode.feature.type.schemaVersion === 2)
  const support = referencePlane ?? { kind: "origin-plane" as const, plane: parsed.plane }
  const schema = v2 ? splitFeatureParametersV2Schema : splitFeatureParametersSchema
  const parameters = schema.parse({
    targetBody,
    plane: v2 ? support : parsed.plane,
    offset: parsed.offset,
  })
  const type = v2 ? splitFeatureTypeV2.type : splitFeatureType.type
  const dependencies = v2
    ? referenceFrameDependencyIds(targetBody.featureId, support)
    : [targetBody.featureId]
  return bodyFeatureRecord(mode, featureId, { type, parameters, dependencies })
}
