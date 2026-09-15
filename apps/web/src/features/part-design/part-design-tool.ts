import {
  booleanFeatureType,
  boxFeatureType,
  chamferFeatureType,
  chamferFeatureTypeV2,
  cylinderFeatureType,
  datumPlaneFeatureType,
  extrusionFeatureType,
  extrusionFeatureTypeV4,
  type FeatureId,
  type FeatureRecord,
  featureBodyDependencyIds,
  filletFeatureType,
  filletFeatureTypeV2,
  holeFeatureType,
  holeFeatureTypeV2,
  legacyExtrusionFeatureType,
  legacyRevolveFeatureType,
  legacyRevolveFeatureTypeV2,
  legacyRevolveFeatureTypeV3,
  multiProfileExtrusionFeatureType,
  multiProfileRevolveFeatureType,
  revolveFeatureType,
  revolveFeatureTypeV6,
  type SketchFeatureFaceSupport,
  type SketchProfileSelector,
} from "@vibeshape/domain"

export type ActivePartDesignTool =
  | Readonly<{ kind: "measure" }>
  | Readonly<{ kind: "create-box" }>
  | Readonly<{ kind: "edit-box"; featureId: FeatureId }>
  | Readonly<{ kind: "create-cylinder" }>
  | Readonly<{ kind: "edit-cylinder"; featureId: FeatureId }>
  | Readonly<{ kind: "create-extrusion"; profiles: readonly SketchProfileSelector[] }>
  | Readonly<{ kind: "edit-extrusion"; featureId: FeatureId }>
  | Readonly<{ kind: "create-revolve"; profiles: readonly SketchProfileSelector[] }>
  | Readonly<{ kind: "edit-revolve"; featureId: FeatureId }>
  | Readonly<{ kind: "create-hole" }>
  | Readonly<{ kind: "edit-hole"; featureId: FeatureId }>
  | Readonly<{ kind: "create-fillet" }>
  | Readonly<{ kind: "edit-fillet"; featureId: FeatureId }>
  | Readonly<{ kind: "create-chamfer" }>
  | Readonly<{ kind: "edit-chamfer"; featureId: FeatureId }>
  | Readonly<{ kind: "create-subtract" }>
  | Readonly<{ kind: "edit-subtract"; featureId: FeatureId }>
  | Readonly<{ kind: "create-datum-plane"; support?: SketchFeatureFaceSupport }>
  | Readonly<{ kind: "edit-datum-plane"; featureId: FeatureId }>

export type ActivePrimitivePartDesignTool = Extract<
  ActivePartDesignTool,
  { kind: "create-box" | "create-cylinder" | "edit-box" | "edit-cylinder" }
>

export type ActiveExtrusionPartDesignTool = Extract<
  ActivePartDesignTool,
  { kind: "create-extrusion" | "edit-extrusion" }
>

export type ActiveRevolvePartDesignTool = Extract<
  ActivePartDesignTool,
  { kind: "create-revolve" | "edit-revolve" }
>

const primitivePartDesignToolKinds = new Set<ActivePartDesignTool["kind"]>([
  "create-box",
  "edit-box",
  "create-cylinder",
  "edit-cylinder",
])

export function isPrimitivePartDesignTool(
  tool: ActivePartDesignTool | null,
): tool is ActivePrimitivePartDesignTool {
  return tool !== null && primitivePartDesignToolKinds.has(tool.kind)
}

const extrusionPartDesignToolKinds = new Set<ActivePartDesignTool["kind"]>([
  "create-extrusion",
  "edit-extrusion",
])

export function isExtrusionPartDesignTool(
  tool: ActivePartDesignTool | null,
): tool is ActiveExtrusionPartDesignTool {
  return tool !== null && extrusionPartDesignToolKinds.has(tool.kind)
}

const revolvePartDesignToolKinds = new Set<ActivePartDesignTool["kind"]>([
  "create-revolve",
  "edit-revolve",
])

export function isRevolvePartDesignTool(
  tool: ActivePartDesignTool | null,
): tool is ActiveRevolvePartDesignTool {
  return tool !== null && revolvePartDesignToolKinds.has(tool.kind)
}

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

export function isHoleFeature(feature: FeatureRecord) {
  return (
    hasFeatureType(feature, holeFeatureType.type) || hasFeatureType(feature, holeFeatureTypeV2.type)
  )
}

export function isFilletFeature(feature: FeatureRecord) {
  return (
    hasFeatureType(feature, filletFeatureType.type) ||
    hasFeatureType(feature, filletFeatureTypeV2.type)
  )
}

export function isChamferFeature(feature: FeatureRecord) {
  return (
    hasFeatureType(feature, chamferFeatureType.type) ||
    hasFeatureType(feature, chamferFeatureTypeV2.type)
  )
}

export function isBooleanFeature(feature: FeatureRecord) {
  return hasFeatureType(feature, booleanFeatureType.type)
}

export function isExtrusionFeature(feature: FeatureRecord) {
  return (
    hasFeatureType(feature, extrusionFeatureType.type) ||
    hasFeatureType(feature, multiProfileExtrusionFeatureType.type) ||
    hasFeatureType(feature, extrusionFeatureTypeV4.type) ||
    hasFeatureType(feature, legacyExtrusionFeatureType.type)
  )
}

export function isRevolveFeature(feature: FeatureRecord) {
  return (
    hasFeatureType(feature, revolveFeatureType.type) ||
    hasFeatureType(feature, multiProfileRevolveFeatureType.type) ||
    hasFeatureType(feature, revolveFeatureTypeV6.type) ||
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
    isBooleanFeature(feature) ||
    isFilletFeature(feature) ||
    isChamferFeature(feature) ||
    isHoleFeature(feature)
  )
}

function isModifyingInputFeature(feature: FeatureRecord) {
  return (
    isPartDesignSolidFeature(feature) &&
    !hasFeatureType(feature, multiProfileExtrusionFeatureType.type) &&
    !hasFeatureType(feature, multiProfileRevolveFeatureType.type)
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
      !feature.suppressed && !excludedIds.has(feature.id) && isModifyingInputFeature(feature),
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
      !feature.suppressed && !excludedIds.has(feature.id) && isModifyingInputFeature(feature),
  )
  const dependedOnIds = new Set(available.flatMap(featureBodyDependencyIds))
  const editingFeature = features.find(({ id }) => id === editingFeatureId)
  const currentTargetIds = new Set(editingFeature ? featureBodyDependencyIds(editingFeature) : [])
  return available.filter(({ id }) => !dependedOnIds.has(id) || currentTargetIds.has(id))
}

/** Includes historical upstream outputs while excluding the edited feature and its dependents. */
export function eligibleHoleTargetFeatures(
  features: readonly FeatureRecord[],
  editingFeatureId?: FeatureId,
) {
  const excludedIds = editingFeatureId
    ? dependentFeatureIds(features, editingFeatureId)
    : new Set<FeatureId>()
  return features.filter(
    (feature) =>
      !feature.suppressed && !excludedIds.has(feature.id) && isModifyingInputFeature(feature),
  )
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
  if (isHoleFeature(feature)) return { kind: "edit-hole", featureId: feature.id }
  if (isFilletFeature(feature)) return { kind: "edit-fillet", featureId: feature.id }
  if (isChamferFeature(feature)) return { kind: "edit-chamfer", featureId: feature.id }
  if (isBooleanFeature(feature)) return { kind: "edit-subtract", featureId: feature.id }
  if (isDatumPlaneFeature(feature)) return { kind: "edit-datum-plane", featureId: feature.id }
  return null
}

const commandByToolKind = {
  "create-box": "box",
  "edit-box": "box",
  "create-cylinder": "cylinder",
  "edit-cylinder": "cylinder",
  "create-extrusion": "extrusion",
  "edit-extrusion": "extrusion",
  "create-revolve": "revolve",
  "edit-revolve": "revolve",
  "create-hole": "hole",
  "edit-hole": "hole",
  "create-fillet": "fillet",
  "edit-fillet": "fillet",
  "create-chamfer": "chamfer",
  "edit-chamfer": "chamfer",
  "create-subtract": "subtract",
  "edit-subtract": "subtract",
  "create-datum-plane": "datum-plane",
  "edit-datum-plane": "datum-plane",
  measure: "measure",
} as const satisfies Record<ActivePartDesignTool["kind"], string>

export function activePartDesignCommand(activeTool: ActivePartDesignTool | null) {
  return activeTool ? commandByToolKind[activeTool.kind] : null
}
