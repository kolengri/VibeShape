import { boxFeatureType, type FeatureId, type FeatureRecord } from "@vibeshape/domain"

export type ActiveBoxTool =
  | Readonly<{ kind: "create-box" }>
  | Readonly<{ kind: "edit-box"; featureId: FeatureId }>

export function isBoxFeature(feature: FeatureRecord) {
  const expected = boxFeatureType.type
  return (
    feature.type.moduleId === expected.moduleId &&
    feature.type.moduleVersion === expected.moduleVersion &&
    feature.type.typeId === expected.typeId &&
    feature.type.schemaVersion === expected.schemaVersion
  )
}
