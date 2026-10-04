import {
  type DocumentDisplayUnits,
  type FeatureId,
  type FeatureRecord,
  featureRecordSchema,
  type VariableDefinition,
} from "@vibeshape/domain"
import type { BodyReference } from "@vibeshape/domain/body-reference"
import {
  type MirrorFeatureParameters,
  mirrorFeatureParametersSchema,
  mirrorFeatureParametersV2Schema,
  mirrorFeatureType,
  mirrorFeatureTypeV2,
  readMirrorFeatureParameters,
} from "@vibeshape/domain/part-design-mirror"
import { defaultLengthExpression } from "../../document/document-display-units"
import {
  type PrimitiveLengthCopy,
  parsePrimitiveLengthExpression,
  quantityExpression,
} from "../part-design/primitive-form"

export type MirrorPlane = MirrorFeatureParameters["plane"]
export type MirrorFormMode =
  | {
      kind: "create"
      targetBody: BodyReference
      createFeatureId: () => FeatureId
      featureLabel: string
    }
  | { kind: "edit"; feature: FeatureRecord }
function readParameters(mode: Extract<MirrorFormMode, { kind: "edit" }>) {
  const parameters = readMirrorFeatureParameters(mode.feature)
  if (!parameters) throw new Error("Mirror form requires a supported feature contract.")
  return parameters
}
export type MirrorFormValues = { plane: MirrorPlane; offset: string; preserveSource: boolean }
export function mirrorFormValues(
  mode: MirrorFormMode,
  units: DocumentDisplayUnits,
): MirrorFormValues {
  const parameters = mode.kind === "edit" ? readParameters(mode) : null
  const enhanced = parameters ? mirrorFeatureParametersV2Schema.safeParse(parameters).data : null
  return {
    plane: parameters?.plane ?? "XY",
    offset: enhanced
      ? quantityExpression(enhanced.offset)
      : defaultLengthExpression(0, units.length),
    preserveSource: enhanced ? enhanced.preserveSource : false,
  }
}
export function parseMirrorForm(
  values: MirrorFormValues,
  variables: readonly VariableDefinition[],
  units: DocumentDisplayUnits,
  copy: PrimitiveLengthCopy,
) {
  const offset = parsePrimitiveLengthExpression(
    values.offset,
    variables,
    copy,
    (quantity) => mirrorFeatureParametersV2Schema.shape.offset.safeParse(quantity).success,
    units.length,
  )
  return offset.ok
    ? {
        ok: true as const,
        plane: values.plane,
        offset: offset.quantity,
        preserveSource: values.preserveSource,
        enhanced:
          values.offset !== defaultLengthExpression(0, units.length) || values.preserveSource,
      }
    : { ok: false as const, issues: { offset: offset.message } }
}
export function mirrorFeatureRecord(
  mode: MirrorFormMode,
  featureId: FeatureId,
  plane: MirrorPlane,
  enhanced?: Pick<
    Extract<ReturnType<typeof parseMirrorForm>, { ok: true }>,
    "offset" | "preserveSource" | "enhanced"
  >,
): FeatureRecord {
  const previous = mode.kind === "edit" ? readParameters(mode) : null
  const previousV2 = previous ? mirrorFeatureParametersV2Schema.safeParse(previous).data : null
  const targetBody = mode.kind === "create" ? mode.targetBody : readParameters(mode).targetBody
  const options =
    enhanced ??
    (previousV2
      ? { offset: previousV2.offset, preserveSource: previousV2.preserveSource, enhanced: true }
      : undefined)
  const version2 =
    options && (mode.kind === "create" || mode.feature.type.schemaVersion === 2 || options.enhanced)
  const type = version2 ? mirrorFeatureTypeV2.type : mirrorFeatureType.type
  const parameters = version2
    ? mirrorFeatureParametersV2Schema.parse({
        targetBody,
        plane,
        offset: options.offset,
        preserveSource: options.preserveSource,
      })
    : mirrorFeatureParametersSchema.parse({ targetBody, plane })
  return featureRecordSchema.parse(
    mode.kind === "edit"
      ? { ...mode.feature, type, parameters }
      : {
          schemaVersion: 0,
          id: featureId,
          type,
          parameters,
          dependencies: [targetBody.featureId],
          references: [],
          suppressed: false,
          label: mode.featureLabel,
        },
  )
}
