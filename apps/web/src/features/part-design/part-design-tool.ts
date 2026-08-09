import {
  boxFeatureType,
  cylinderFeatureType,
  type FeatureId,
  type FeatureRecord,
} from "@vibeshape/domain"

export type ActivePartDesignTool =
  | Readonly<{ kind: "create-box" }>
  | Readonly<{ kind: "edit-box"; featureId: FeatureId }>
  | Readonly<{ kind: "create-cylinder" }>
  | Readonly<{ kind: "edit-cylinder"; featureId: FeatureId }>

function hasFeatureType(feature: FeatureRecord, expected: FeatureRecord["type"]) {
  return (
    feature.type.moduleId === expected.moduleId &&
    feature.type.moduleVersion === expected.moduleVersion &&
    feature.type.typeId === expected.typeId &&
    feature.type.schemaVersion === expected.schemaVersion
  )
}

export function isBoxFeature(feature: FeatureRecord) {
  return hasFeatureType(feature, boxFeatureType.type)
}

export function isCylinderFeature(feature: FeatureRecord) {
  return hasFeatureType(feature, cylinderFeatureType.type)
}

export function activeFeatureId(activeTool: ActivePartDesignTool | null) {
  return activeTool && "featureId" in activeTool ? activeTool.featureId : null
}

export function activePrimitiveCommand(activeTool: ActivePartDesignTool | null) {
  if (!activeTool) return null
  switch (activeTool.kind) {
    case "create-box":
    case "edit-box":
      return "box"
    case "create-cylinder":
    case "edit-cylinder":
      return "cylinder"
  }
}
