import { type FeatureId, type FeatureRecord, featureRecordSchema } from "@vibeshape/domain"
import type { BodyReference } from "@vibeshape/domain/body-reference"
import {
  type MirrorFeatureParameters,
  mirrorFeatureParametersSchema,
  mirrorFeatureType,
} from "@vibeshape/domain/part-design-mirror"

export type MirrorPlane = MirrorFeatureParameters["plane"]
export type MirrorFormMode =
  | {
      kind: "create"
      targetBody: BodyReference
      createFeatureId: () => FeatureId
      featureLabel: string
    }
  | { kind: "edit"; feature: FeatureRecord }
export function mirrorInitialPlane(mode: MirrorFormMode): MirrorPlane {
  return mode.kind === "edit"
    ? mirrorFeatureParametersSchema.parse(mode.feature.parameters).plane
    : "XY"
}
export function mirrorFeatureRecord(
  mode: MirrorFormMode,
  featureId: FeatureId,
  plane: MirrorPlane,
): FeatureRecord {
  const targetBody =
    mode.kind === "create"
      ? mode.targetBody
      : mirrorFeatureParametersSchema.parse(mode.feature.parameters).targetBody
  const parameters = mirrorFeatureParametersSchema.parse({ targetBody, plane })
  return featureRecordSchema.parse(
    mode.kind === "edit"
      ? { ...mode.feature, parameters }
      : {
          schemaVersion: 0,
          id: featureId,
          type: mirrorFeatureType.type,
          parameters,
          dependencies: [targetBody.featureId],
          references: [],
          suppressed: false,
          label: mode.featureLabel,
        },
  )
}
