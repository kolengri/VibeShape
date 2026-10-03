import type { DocumentRebuildOutcome } from "@vibeshape/application/persistent-document-session"
import {
  booleanFeatureType,
  boxFeatureType,
  chamferFeatureType,
  chamferFeatureTypeV2,
  coneFeatureType,
  cylinderFeatureType,
  datumPlaneFeatureType,
  type FeatureId,
  type FeatureRecord,
  featureBodyDependencyIds,
  filletFeatureType,
  filletFeatureTypeV2,
  holeFeatureType,
  holeFeatureTypeV2,
  legacyRevolveFeatureType,
  legacyRevolveFeatureTypeV2,
  legacyRevolveFeatureTypeV3,
  multiProfileExtrusionFeatureType,
  multiProfileRevolveFeatureType,
  pyramidFeatureType,
  readExtrusionFeatureParameters,
  revolveFeatureType,
  revolveFeatureTypeV6,
  type SketchFeatureFaceSupport,
  type SketchProfileSelector,
  sphereFeatureType,
  torusFeatureType,
} from "@vibeshape/domain"
import type { BodyReference } from "@vibeshape/domain/body-reference"
import type { PartId } from "@vibeshape/domain/identifiers"
import { isExtrusionType } from "@vibeshape/domain/part-design"
import {
  compoundFeatureType,
  unionFeatureType,
} from "@vibeshape/domain/part-design-body-combination"
import { placementFeatureType } from "@vibeshape/domain/part-design-placement"
import { terminalModelBodies } from "./model-bodies"

export type ActivePartDesignTool =
  | Readonly<{ kind: "measure" }>
  | Readonly<{ kind: "create-compound" | "create-union" }>
  | Readonly<{ kind: "edit-compound" | "edit-union"; featureId: FeatureId }>
  | Readonly<{ kind: "create-placement"; partId: PartId; targetBody: BodyReference }>
  | Readonly<{ kind: "edit-placement"; featureId: FeatureId }>
  | Readonly<{ kind: "create-box" }>
  | Readonly<{ kind: "edit-box"; featureId: FeatureId }>
  | Readonly<{ kind: "create-cylinder" }>
  | Readonly<{ kind: "edit-cylinder"; featureId: FeatureId }>
  | Readonly<{ kind: "create-sphere" | "create-cone" | "create-torus" | "create-pyramid" }>
  | Readonly<{
      kind: "edit-sphere" | "edit-cone" | "edit-torus" | "edit-pyramid"
      featureId: FeatureId
    }>
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
  {
    kind:
      | "create-box"
      | "create-cylinder"
      | "edit-box"
      | "edit-cylinder"
      | "create-sphere"
      | "edit-sphere"
      | "create-cone"
      | "create-pyramid"
      | "edit-cone"
      | "edit-pyramid"
      | "create-torus"
      | "edit-torus"
  }
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
  "create-sphere",
  "edit-sphere",
  "create-cone",
  "create-pyramid",
  "edit-cone",
  "edit-pyramid",
  "create-torus",
  "edit-torus",
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

export function isSphereFeature(feature: FeatureRecord) {
  return hasFeatureType(feature, sphereFeatureType.type)
}

export function isConeFeature(feature: FeatureRecord) {
  return hasFeatureType(feature, coneFeatureType.type)
}

export function isPyramidFeature(feature: FeatureRecord) {
  return hasFeatureType(feature, pyramidFeatureType.type)
}

export function isTorusFeature(feature: FeatureRecord) {
  return hasFeatureType(feature, torusFeatureType.type)
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
  return isExtrusionType(feature)
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

function isPlacementFeature(feature: FeatureRecord) {
  return hasFeatureType(feature, placementFeatureType.type)
}

function isUnionFeature(feature: FeatureRecord) {
  return hasFeatureType(feature, unionFeatureType.type)
}

function isPartDesignSolidFeature(feature: FeatureRecord) {
  return [
    isBoxFeature,
    isCylinderFeature,
    isSphereFeature,
    isConeFeature,
    isPyramidFeature,
    isTorusFeature,
    isExtrusionFeature,
    isRevolveFeature,
    isBooleanFeature,
    isFilletFeature,
    isChamferFeature,
    isHoleFeature,
    isPlacementFeature,
    isUnionFeature,
  ].some((matches) => matches(feature))
}

function isModifyingInputFeature(feature: FeatureRecord) {
  if (!isPartDesignSolidFeature(feature)) return false
  if (
    hasFeatureType(feature, multiProfileExtrusionFeatureType.type) ||
    hasFeatureType(feature, multiProfileRevolveFeatureType.type)
  )
    return false
  const extrusion = readExtrusionFeatureParameters(feature)
  return extrusion?.operation !== "new" || (extrusion.profiles?.profiles.length ?? 1) <= 1
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
  rebuild?: DocumentRebuildOutcome,
) {
  const candidates = modifyingSolidTargetFeatures(features, editingFeatureId, rebuild)
  const currentInputs = features.find(({ id }) => id === editingFeatureId)?.dependencies ?? []
  const candidateIds = new Set(candidates.map(({ id }) => id))
  return features.filter(
    (feature) =>
      candidateIds.has(feature.id) ||
      (currentInputs.includes(feature.id) &&
        !feature.suppressed &&
        isModifyingInputFeature(feature)),
  )
}

export function modifyingSolidTargetFeatures(
  features: readonly FeatureRecord[],
  editingFeatureId?: FeatureId,
  rebuild?: DocumentRebuildOutcome,
) {
  if (rebuild) return evaluatedSolidTargetFeatures(features, editingFeatureId, rebuild)
  const excludedIds = editingFeatureId
    ? dependentFeatureIds(features, editingFeatureId)
    : new Set<FeatureId>()
  const active = features.filter((feature) => !feature.suppressed && !excludedIds.has(feature.id))
  const available = active.filter(isModifyingInputFeature)
  const dependedOnIds = new Set(active.flatMap(featureBodyDependencyIds))
  const editingFeature = features.find(({ id }) => id === editingFeatureId)
  const currentTargetIds = new Set(editingFeature ? featureBodyDependencyIds(editingFeature) : [])
  return available.filter(({ id }) => !dependedOnIds.has(id) || currentTargetIds.has(id))
}

function evaluatedSolidTargetFeatures(
  features: readonly FeatureRecord[],
  editingFeatureId: FeatureId | undefined,
  rebuild: DocumentRebuildOutcome,
) {
  if (!rebuild.ok) return []
  const excludedIds = editingFeatureId
    ? dependentFeatureIds(features, editingFeatureId)
    : new Set<FeatureId>()
  const terminal = terminalModelBodies(features, rebuild.response, [...excludedIds]) ?? []
  const editingFeature = features.find(({ id }) => id === editingFeatureId)
  const currentTargetIds = new Set(editingFeature ? featureBodyDependencyIds(editingFeature) : [])
  const savedContextIds = upstreamFeatureIds(features, currentTargetIds)
  const savedTargets =
    terminalModelBodies(
      features,
      rebuild.response,
      features.filter(({ id }) => !savedContextIds.has(id)).map(({ id }) => id),
    ) ?? []
  const availableIds = new Set(
    [...terminal, ...savedTargets.filter(({ feature }) => currentTargetIds.has(feature.id))].map(
      ({ feature }) => feature.id,
    ),
  )
  return features.filter(
    (feature) =>
      availableIds.has(feature.id) &&
      !excludedIds.has(feature.id) &&
      !feature.suppressed &&
      isModifyingInputFeature(feature),
  )
}

function upstreamFeatureIds(features: readonly FeatureRecord[], roots: ReadonlySet<FeatureId>) {
  const byId = new Map(features.map((feature) => [feature.id, feature]))
  const ids = new Set(roots)
  const queue = [...roots]
  for (const id of queue) {
    for (const dependency of byId.get(id)?.dependencies ?? []) {
      if (ids.has(dependency)) continue
      ids.add(dependency)
      queue.push(dependency)
    }
  }
  return ids
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

const editableFeatureTools: readonly [
  (feature: FeatureRecord) => boolean,
  Extract<ActivePartDesignTool, { featureId: FeatureId }>["kind"],
][] = [
  [(feature) => hasFeatureType(feature, compoundFeatureType.type), "edit-compound"],
  [isUnionFeature, "edit-union"],
  [isPlacementFeature, "edit-placement"],
  [isBoxFeature, "edit-box"],
  [isCylinderFeature, "edit-cylinder"],
  [isSphereFeature, "edit-sphere"],
  [isConeFeature, "edit-cone"],
  [isPyramidFeature, "edit-pyramid"],
  [isTorusFeature, "edit-torus"],
  [isExtrusionFeature, "edit-extrusion"],
  [isRevolveFeature, "edit-revolve"],
  [isHoleFeature, "edit-hole"],
  [isFilletFeature, "edit-fillet"],
  [isChamferFeature, "edit-chamfer"],
  [isBooleanFeature, "edit-subtract"],
  [isDatumPlaneFeature, "edit-datum-plane"],
]

export function editPartDesignTool(
  feature: FeatureRecord | undefined,
): ActivePartDesignTool | null {
  if (!feature) return null
  const kind = editableFeatureTools.find(([matches]) => matches(feature))?.[1]
  return kind ? { kind, featureId: feature.id } : null
}

const commandByToolKind = {
  "create-compound": "compound",
  "edit-compound": "compound",
  "create-union": "union",
  "edit-union": "union",
  "create-placement": "placement",
  "edit-placement": "placement",
  "create-box": "box",
  "edit-box": "box",
  "create-cylinder": "cylinder",
  "edit-cylinder": "cylinder",
  "create-sphere": "sphere",
  "edit-sphere": "sphere",
  "create-cone": "cone",
  "create-pyramid": "pyramid",
  "edit-cone": "cone",
  "edit-pyramid": "pyramid",
  "create-torus": "torus",
  "edit-torus": "torus",
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
