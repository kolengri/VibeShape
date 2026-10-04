import { type FeatureId, type FeatureRecord, featureRecordSchema } from "@vibeshape/domain"
import type { BodyReference } from "@vibeshape/domain/body-reference"

export type BodyFeatureFormMode =
  | Readonly<{
      kind: "create"
      targetBody: BodyReference
      createFeatureId: () => FeatureId
      featureLabel: string
    }>
  | Readonly<{ kind: "edit"; feature: FeatureRecord }>
export function bodyFeatureRecord(
  mode: BodyFeatureFormMode,
  featureId: FeatureId,
  changes: Readonly<{
    type: FeatureRecord["type"]
    parameters: unknown
    dependencies: readonly FeatureId[]
  }>,
): FeatureRecord {
  return featureRecordSchema.parse(
    mode.kind === "edit"
      ? { ...mode.feature, ...changes, references: [] }
      : {
          schemaVersion: 0,
          id: featureId,
          ...changes,
          references: [],
          suppressed: false,
          label: mode.featureLabel,
        },
  )
}
