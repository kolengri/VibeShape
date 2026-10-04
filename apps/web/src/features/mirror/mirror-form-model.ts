import {
  createLengthQuantity,
  type DocumentDisplayUnits,
  type FeatureId,
  type FeatureRecord,
  type VariableDefinition,
} from "@vibeshape/domain"
import type { BodyReference } from "@vibeshape/domain/body-reference"
import {
  type MirrorFeatureParameters,
  mirrorFeatureParametersSchema,
  mirrorFeatureParametersV2Schema,
  mirrorFeatureParametersV3Schema,
  mirrorFeatureType,
  mirrorFeatureTypeV2,
  mirrorFeatureTypeV3,
  readMirrorFeatureParameters,
  readMirrorFeatureParametersV3,
} from "@vibeshape/domain/part-design-mirror"
import { type ReferencePlane, referenceFrameDependencyIds } from "@vibeshape/domain/reference-frame"
import { defaultLengthExpression } from "../../document/document-display-units"
import { bodyFeatureRecord } from "../part-design/body-feature-record"
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
  const parameters =
    readMirrorFeatureParameters(mode.feature) ?? readMirrorFeatureParametersV3(mode.feature)
  if (!parameters) throw new Error("Mirror form requires a supported feature contract.")
  return parameters
}
export type MirrorFormValues = { plane: MirrorPlane; offset: string; preserveSource: boolean }
export function mirrorFormValues(
  mode: MirrorFormMode,
  units: DocumentDisplayUnits,
): MirrorFormValues {
  const parameters = mode.kind === "edit" ? readParameters(mode) : null
  const enhanced =
    mode.kind === "edit"
      ? (readMirrorFeatureParametersV3(mode.feature) ??
        mirrorFeatureParametersV2Schema.safeParse(parameters).data)
      : null
  return {
    plane:
      typeof parameters?.plane === "string"
        ? parameters.plane
        : parameters?.plane.kind === "origin-plane"
          ? parameters.plane.plane
          : "XY",
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
type MirrorOptions = Pick<
  Extract<ReturnType<typeof parseMirrorForm>, { ok: true }>,
  "offset" | "preserveSource" | "enhanced"
>
function previousMirrorOptions(mode: MirrorFormMode): MirrorOptions | undefined {
  if (mode.kind !== "edit") return undefined
  const previous = readParameters(mode)
  return "offset" in previous
    ? { offset: previous.offset, preserveSource: previous.preserveSource, enhanced: true }
    : undefined
}
function referenceMirrorIntent(
  targetBody: BodyReference,
  plane: ReferencePlane,
  options?: MirrorOptions,
) {
  const fields = options ?? { offset: createLengthQuantity(0), preserveSource: false }
  return {
    type: mirrorFeatureTypeV3.type,
    parameters: mirrorFeatureParametersV3Schema.parse({
      targetBody,
      plane,
      offset: fields.offset,
      preserveSource: fields.preserveSource,
    }),
    dependencies: referenceFrameDependencyIds(targetBody.featureId, plane),
  }
}
function originMirrorIntent(
  mode: MirrorFormMode,
  targetBody: BodyReference,
  plane: MirrorPlane,
  options?: MirrorOptions,
) {
  const version2 =
    options && (mode.kind === "create" || mode.feature.type.schemaVersion === 2 || options.enhanced)
  return {
    type: version2 ? mirrorFeatureTypeV2.type : mirrorFeatureType.type,
    parameters: version2
      ? mirrorFeatureParametersV2Schema.parse({
          targetBody,
          plane,
          offset: options.offset,
          preserveSource: options.preserveSource,
        })
      : mirrorFeatureParametersSchema.parse({ targetBody, plane }),
    dependencies: [targetBody.featureId],
  }
}
export function mirrorFeatureRecord(
  mode: MirrorFormMode,
  featureId: FeatureId,
  plane: MirrorPlane,
  enhanced?: MirrorOptions,
  referencePlane?: ReferencePlane | undefined,
): FeatureRecord {
  const targetBody = mode.kind === "create" ? mode.targetBody : readParameters(mode).targetBody
  const options = enhanced ?? previousMirrorOptions(mode)
  const support =
    referencePlane ??
    (mode.kind === "edit" ? readMirrorFeatureParametersV3(mode.feature)?.plane : undefined)
  const intent = support
    ? referenceMirrorIntent(targetBody, support, options)
    : originMirrorIntent(mode, targetBody, plane, options)
  return bodyFeatureRecord(mode, featureId, intent)
}
