import {
  booleanFeatureType,
  boxFeatureType,
  cylinderFeatureType,
  datumPlaneFeatureType,
  extrusionFeatureType,
  type FeatureId,
  type FeatureRecord,
  featureBodyDependencyIds,
  legacyExtrusionFeatureType,
  legacyRevolveFeatureType,
  legacyRevolveFeatureTypeV2,
  legacyRevolveFeatureTypeV3,
  revolveFeatureType,
  type SketchFeatureFaceSupport,
  type SketchProfileSelector,
} from "@vibeshape/domain"

export type ActivePartDesignTool =
  | Readonly<{ kind: "create-box" }>
  | Readonly<{ kind: "edit-box"; featureId: FeatureId }>
  | Readonly<{ kind: "create-cylinder" }>
  | Readonly<{ kind: "edit-cylinder"; featureId: FeatureId }>
  | Readonly<{ kind: "create-extrusion"; profile: SketchProfileSelector }>
  | Readonly<{ kind: "edit-extrusion"; featureId: FeatureId }>
  | Readonly<{ kind: "create-revolve"; profile: SketchProfileSelector }>
  | Readonly<{ kind: "edit-revolve"; featureId: FeatureId }>
  | Readonly<{ kind: "create-subtract" }>
  | Readonly<{ kind: "edit-subtract"; featureId: FeatureId }>
  | Readonly<{ kind: "create-datum-plane"; support?: SketchFeatureFaceSupport }>
  | Readonly<{ kind: "edit-datum-plane"; featureId: FeatureId }>

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

export function isBooleanFeature(feature: FeatureRecord) {
  return hasFeatureType(feature, booleanFeatureType.type)
}

export function isExtrusionFeature(feature: FeatureRecord) {
  return (
    hasFeatureType(feature, extrusionFeatureType.type) ||
    hasFeatureType(feature, legacyExtrusionFeatureType.type)
  )
}

export function isRevolveFeature(feature: FeatureRecord) {
  return (
    hasFeatureType(feature, revolveFeatureType.type) ||
    hasFeatureType(feature, legacyRevolveFeatureTypeV3.type) ||
    hasFeatureType(feature, legacyRevolveFeatureTypeV2.type) ||
    hasFeatureType(feature, legacyRevolveFeatureType.type)
  )
}

export function isDatumPlaneFeature(feature: FeatureRecord) {
  return hasFeatureType(feature, datumPlaneFeatureType.type)
}

function isPartDesignSolidFeature(feature: FeatureRecord) {
  return (
    isBoxFeature(feature) ||
    isCylinderFeature(feature) ||
    isExtrusionFeature(feature) ||
    isRevolveFeature(feature) ||
    isBooleanFeature(feature)
  )
}

function dependentFeatureIds(features: readonly FeatureRecord[], rootFeatureId: FeatureId) {
  const dependentsById = new Map<FeatureId, FeatureId[]>()
  for (const feature of features) {
    for (const dependencyId of feature.dependencies) {
      const dependents = dependentsById.get(dependencyId) ?? []
      dependents.push(feature.id)
      dependentsById.set(dependencyId, dependents)
    }
  }
  const dependentIds = new Set<FeatureId>([rootFeatureId])
  const queue = [rootFeatureId]
  for (const featureId of queue) {
    for (const dependentId of dependentsById.get(featureId) ?? []) {
      if (dependentIds.has(dependentId)) continue
      dependentIds.add(dependentId)
      queue.push(dependentId)
    }
  }
  return dependentIds
}

export function booleanInputFeatures(
  features: readonly FeatureRecord[],
  editingFeatureId?: FeatureId,
) {
  const excludedIds = editingFeatureId
    ? dependentFeatureIds(features, editingFeatureId)
    : new Set<FeatureId>()
  return features.filter(
    (feature) =>
      !feature.suppressed && !excludedIds.has(feature.id) && isPartDesignSolidFeature(feature),
  )
}

export function modifyingSolidTargetFeatures(
  features: readonly FeatureRecord[],
  editingFeatureId?: FeatureId,
) {
  const excludedIds = editingFeatureId
    ? dependentFeatureIds(features, editingFeatureId)
    : new Set<FeatureId>()
  const available = features.filter(
    (feature) =>
      !feature.suppressed && !excludedIds.has(feature.id) && isPartDesignSolidFeature(feature),
  )
  const dependedOnIds = new Set(available.flatMap(featureBodyDependencyIds))
  const editingFeature = features.find(({ id }) => id === editingFeatureId)
  const currentTargetIds = new Set(editingFeature ? featureBodyDependencyIds(editingFeature) : [])
  return available.filter(({ id }) => !dependedOnIds.has(id) || currentTargetIds.has(id))
}

export function activeFeatureId(activeTool: ActivePartDesignTool | null) {
  return activeTool && "featureId" in activeTool ? activeTool.featureId : null
}

export function editPartDesignTool(
  feature: FeatureRecord | undefined,
): ActivePartDesignTool | null {
  if (!feature) return null
  if (isBoxFeature(feature)) return { kind: "edit-box", featureId: feature.id }
  if (isCylinderFeature(feature)) return { kind: "edit-cylinder", featureId: feature.id }
  if (isExtrusionFeature(feature)) return { kind: "edit-extrusion", featureId: feature.id }
  if (isRevolveFeature(feature)) return { kind: "edit-revolve", featureId: feature.id }
  if (isBooleanFeature(feature)) return { kind: "edit-subtract", featureId: feature.id }
  if (isDatumPlaneFeature(feature)) return { kind: "edit-datum-plane", featureId: feature.id }
  return null
}

export function activePartDesignCommand(activeTool: ActivePartDesignTool | null) {
  if (!activeTool) return null
  switch (activeTool.kind) {
    case "create-box":
    case "edit-box":
      return "box"
    case "create-cylinder":
    case "edit-cylinder":
      return "cylinder"
    case "create-extrusion":
    case "edit-extrusion":
      return "extrusion"
    case "create-revolve":
    case "edit-revolve":
      return "revolve"
    case "create-subtract":
    case "edit-subtract":
      return "subtract"
    case "create-datum-plane":
    case "edit-datum-plane":
      return "datum-plane"
  }
}
