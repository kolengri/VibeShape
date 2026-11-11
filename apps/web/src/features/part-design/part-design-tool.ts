import type { DocumentRebuildOutcome } from "@vibeshape/application/persistent-document-session"
import {
  booleanFeatureType,
  booleanFeatureTypeV2,
  boxFeatureType,
  chamferFeatureType,
  chamferFeatureTypeV2,
  chamferFeatureTypeV3,
  coneFeatureType,
  coneFeatureTypeV2,
  cylinderFeatureType,
  datumPlaneFeatureType,
  datumPlaneFeatureTypeV1,
  datumPointFeatureType,
  type FeatureId,
  type FeatureRecord,
  featureBodyDependencyIds,
  filletFeatureType,
  filletFeatureTypeV2,
  filletFeatureTypeV3,
  isHoleFeatureRecord,
  legacyRevolveFeatureType,
  legacyRevolveFeatureTypeV2,
  legacyRevolveFeatureTypeV3,
  multiProfileExtrusionFeatureType,
  multiProfileRevolveFeatureType,
  pyramidFeatureType,
  readExtrusionFeatureParameters,
  revolveFeatureType,
  revolveFeatureTypeV6,
  revolveFeatureTypeV7,
  type SketchFeatureFaceSupport,
  type SketchProfileSelector,
  sphereFeatureType,
  torusFeatureType,
} from "@vibeshape/domain"
import type { BodyReference } from "@vibeshape/domain/body-reference"
import type { BodyFaceRef } from "@vibeshape/domain/body-topology-reference"
import type { PartId } from "@vibeshape/domain/identifiers"
import { isExtrusionType } from "@vibeshape/domain/part-design"
import {
  compoundFeatureType,
  compoundFeatureTypeV2,
  unionFeatureType,
  unionFeatureTypeV2,
} from "@vibeshape/domain/part-design-body-combination"
import { readCoilFeatureParameters } from "@vibeshape/domain/part-design-coil"
import { readConnectMountsFeatureParameters } from "@vibeshape/domain/part-design-connect-mounts"
import { readDraftFeatureParameters } from "@vibeshape/domain/part-design-draft"
import { readFdmFeatureParameters } from "@vibeshape/domain/part-design-fdm"
import { importedFeatureType } from "@vibeshape/domain/part-design-import"
import { loftFeatureType, loftFeatureTypeV2 } from "@vibeshape/domain/part-design-loft"
import { loftFeatureTypeV3 } from "@vibeshape/domain/part-design-loft-v3"
import { meshImportFeatureType } from "@vibeshape/domain/part-design-mesh-import"
import {
  mirrorFeatureType,
  mirrorFeatureTypeV2,
  mirrorFeatureTypeV3,
} from "@vibeshape/domain/part-design-mirror"
import { patternFeatureType, patternFeatureTypeV2 } from "@vibeshape/domain/part-design-pattern"
import { placementFeatureType } from "@vibeshape/domain/part-design-placement"
import { readPressPullFeatureParameters } from "@vibeshape/domain/part-design-press-pull"
import { readScaleFeatureParameters } from "@vibeshape/domain/part-design-scale"
import { readShellFeatureParameters } from "@vibeshape/domain/part-design-shell"
import { splitFeatureType, splitFeatureTypeV2 } from "@vibeshape/domain/part-design-split"
import { sweepFeatureType, sweepFeatureTypeV2 } from "@vibeshape/domain/part-design-sweep"
import { threadFeatureType } from "@vibeshape/domain/part-design-thread"
import { terminalModelBodies } from "./model-bodies"
import type { ModelEdgeSelection } from "./model-edge-selection"

export type ActivePartDesignTool =
  | Readonly<{ kind: "inspect-imported"; featureId: FeatureId }>
  | Readonly<{ kind: "create-connect-mounts" }>
  | Readonly<{ kind: "create-coil" }>
  | Readonly<{ kind: "edit-coil"; featureId: FeatureId }>
  | Readonly<{ kind: "edit-connect-mounts"; featureId: FeatureId }>
  | Readonly<{ kind: "create-fdm" }>
  | Readonly<{ kind: "edit-fdm"; featureId: FeatureId }>
  | Readonly<{ kind: "surface-texture"; featureId?: FeatureId; outputRole?: string }>
  | Readonly<{ kind: "measure" }>
  | Readonly<{ kind: "create-loft" | "create-sweep" }>
  | Readonly<{ kind: "edit-loft" | "edit-sweep"; featureId: FeatureId }>
  | Readonly<{ kind: "create-compound" | "create-union" }>
  | Readonly<{ kind: "edit-compound" | "edit-union"; featureId: FeatureId }>
  | Readonly<{ kind: "create-placement"; partId: PartId; targetBody: BodyReference }>
  | Readonly<{ kind: "edit-placement"; featureId: FeatureId }>
  | Readonly<{ kind: "create-mirror"; partId: PartId; targetBody: BodyReference }>
  | Readonly<{ kind: "edit-mirror"; featureId: FeatureId }>
  | Readonly<{
      kind: "create-press-pull"
      targetBody: BodyReference
      face: BodyFaceRef
      sourceContentHash: string
    }>
  | Readonly<{ kind: "edit-press-pull"; featureId: FeatureId }>
  | Readonly<{ kind: "create-shell"; partId: PartId; targetBody: BodyReference }>
  | Readonly<{ kind: "edit-shell"; featureId: FeatureId }>
  | Readonly<{ kind: "create-draft"; partId: PartId; targetBody: BodyReference }>
  | Readonly<{ kind: "edit-draft"; featureId: FeatureId }>
  | Readonly<{ kind: "create-scale"; partId: PartId; targetBody: BodyReference }>
  | Readonly<{ kind: "edit-scale"; featureId: FeatureId }>
  | Readonly<{ kind: "create-split"; partId: PartId; targetBody: BodyReference }>
  | Readonly<{ kind: "edit-split"; featureId: FeatureId }>
  | Readonly<{ kind: "create-pattern"; partId: PartId; targetBody: BodyReference }>
  | Readonly<{ kind: "edit-pattern"; featureId: FeatureId }>
  | Readonly<{ kind: "create-thread"; partId: PartId; targetBody: BodyReference }>
  | Readonly<{ kind: "edit-thread"; featureId: FeatureId }>
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
  | Readonly<{
      kind: "create-fillet"
      targetFeatureId?: FeatureId | null
      edgeSelection?: ModelEdgeSelection
    }>
  | Readonly<{ kind: "edit-fillet"; featureId: FeatureId }>
  | Readonly<{
      kind: "create-chamfer"
      targetFeatureId?: FeatureId | null
      edgeSelection?: ModelEdgeSelection
    }>
  | Readonly<{ kind: "edit-chamfer"; featureId: FeatureId }>
  | Readonly<{ kind: "create-subtract" }>
  | Readonly<{ kind: "edit-subtract"; featureId: FeatureId }>
  | Readonly<{ kind: "create-datum-plane"; support?: SketchFeatureFaceSupport }>
  | Readonly<{ kind: "edit-datum-plane"; featureId: FeatureId }>
  | Readonly<{ kind: "create-datum-point" }>
  | Readonly<{ kind: "edit-datum-point"; featureId: FeatureId }>

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
  return (
    hasFeatureType(feature, coneFeatureType.type) || hasFeatureType(feature, coneFeatureTypeV2.type)
  )
}

export function isPyramidFeature(feature: FeatureRecord) {
  return hasFeatureType(feature, pyramidFeatureType.type)
}

export function isTorusFeature(feature: FeatureRecord) {
  return hasFeatureType(feature, torusFeatureType.type)
}

export function isHoleFeature(feature: FeatureRecord) {
  return isHoleFeatureRecord(feature)
}

export function isFilletFeature(feature: FeatureRecord) {
  return (
    hasFeatureType(feature, filletFeatureType.type) ||
    hasFeatureType(feature, filletFeatureTypeV2.type) ||
    hasFeatureType(feature, filletFeatureTypeV3.type)
  )
}

export function isChamferFeature(feature: FeatureRecord) {
  return (
    hasFeatureType(feature, chamferFeatureType.type) ||
    hasFeatureType(feature, chamferFeatureTypeV2.type) ||
    hasFeatureType(feature, chamferFeatureTypeV3.type)
  )
}

export function isBooleanFeature(feature: FeatureRecord) {
  return (
    hasFeatureType(feature, booleanFeatureType.type) ||
    hasFeatureType(feature, booleanFeatureTypeV2.type)
  )
}

export function isExtrusionFeature(feature: FeatureRecord) {
  return isExtrusionType(feature)
}

export function isRevolveFeature(feature: FeatureRecord) {
  return (
    hasFeatureType(feature, revolveFeatureType.type) ||
    hasFeatureType(feature, multiProfileRevolveFeatureType.type) ||
    hasFeatureType(feature, revolveFeatureTypeV6.type) ||
    hasFeatureType(feature, revolveFeatureTypeV7.type) ||
    hasFeatureType(feature, legacyRevolveFeatureTypeV3.type) ||
    hasFeatureType(feature, legacyRevolveFeatureTypeV2.type) ||
    hasFeatureType(feature, legacyRevolveFeatureType.type)
  )
}

export function isDatumPlaneFeature(feature: FeatureRecord) {
  return (
    hasFeatureType(feature, datumPlaneFeatureTypeV1.type) ||
    hasFeatureType(feature, datumPlaneFeatureType.type)
  )
}

export function isDatumPointFeature(feature: FeatureRecord) {
  return hasFeatureType(feature, datumPointFeatureType.type)
}

function isPlacementFeature(feature: FeatureRecord) {
  return hasFeatureType(feature, placementFeatureType.type)
}
function isPressPullFeature(feature: FeatureRecord) {
  return readPressPullFeatureParameters(feature) !== null
}
function isShellFeature(feature: FeatureRecord) {
  return readShellFeatureParameters(feature) !== null
}
function isDraftFeature(feature: FeatureRecord) {
  return readDraftFeatureParameters(feature) !== null
}
function isScaleFeature(feature: FeatureRecord) {
  return readScaleFeatureParameters(feature) !== null
}
function isLoftFeature(feature: FeatureRecord) {
  return (
    hasFeatureType(feature, loftFeatureType.type) ||
    hasFeatureType(feature, loftFeatureTypeV2.type) ||
    hasFeatureType(feature, loftFeatureTypeV3.type)
  )
}
function isSweepFeature(feature: FeatureRecord) {
  return (
    hasFeatureType(feature, sweepFeatureType.type) ||
    hasFeatureType(feature, sweepFeatureTypeV2.type)
  )
}
function isThreadFeature(feature: FeatureRecord) {
  return hasFeatureType(feature, threadFeatureType.type)
}
function isPatternFeature(feature: FeatureRecord) {
  return (
    hasFeatureType(feature, patternFeatureType.type) ||
    hasFeatureType(feature, patternFeatureTypeV2.type)
  )
}
function isSplitFeature(feature: FeatureRecord) {
  return (
    hasFeatureType(feature, splitFeatureType.type) ||
    hasFeatureType(feature, splitFeatureTypeV2.type)
  )
}
function isMirrorFeature(feature: FeatureRecord) {
  return (
    hasFeatureType(feature, mirrorFeatureType.type) ||
    hasFeatureType(feature, mirrorFeatureTypeV2.type) ||
    hasFeatureType(feature, mirrorFeatureTypeV3.type)
  )
}

function isUnionFeature(feature: FeatureRecord) {
  return (
    hasFeatureType(feature, unionFeatureType.type) ||
    hasFeatureType(feature, unionFeatureTypeV2.type)
  )
}

function isPartDesignSolidFeature(feature: FeatureRecord) {
  if (readConnectMountsFeatureParameters(feature)) return true
  if (readCoilFeatureParameters(feature)) return true
  if (readFdmFeatureParameters(feature)) return true
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
    isMirrorFeature,
    isPressPullFeature,
    isShellFeature,
    isDraftFeature,
    isScaleFeature,
    isLoftFeature,
    isSweepFeature,
    isThreadFeature,
    isUnionFeature,
  ].some((matches) => matches(feature))
}

function isBodyTargetFeature(feature: FeatureRecord) {
  return (
    isPartDesignSolidFeature(feature) ||
    hasFeatureType(feature, importedFeatureType.type) ||
    hasFeatureType(feature, patternFeatureType.type) ||
    hasFeatureType(feature, splitFeatureType.type) ||
    hasFeatureType(feature, compoundFeatureType.type) ||
    hasFeatureType(feature, compoundFeatureTypeV2.type)
  )
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
      !feature.suppressed && !excludedIds.has(feature.id) && isBodyTargetFeature(feature),
  )
}

export function activeFeatureId(activeTool: ActivePartDesignTool | null) {
  return activeTool && "featureId" in activeTool ? activeTool.featureId : null
}

const editableFeatureTools = [
  [
    (feature) =>
      hasFeatureType(feature, importedFeatureType.type) ||
      hasFeatureType(feature, meshImportFeatureType.type),
    "inspect-imported",
  ],
  [(feature) => readFdmFeatureParameters(feature) !== null, "edit-fdm"],
  [
    (feature) =>
      hasFeatureType(feature, compoundFeatureType.type) ||
      hasFeatureType(feature, compoundFeatureTypeV2.type),
    "edit-compound",
  ],
  [isUnionFeature, "edit-union"],
  [isPlacementFeature, "edit-placement"],
  [isMirrorFeature, "edit-mirror"],
  [isShellFeature, "edit-shell"],
  [isSplitFeature, "edit-split"],
  [isPatternFeature, "edit-pattern"],
  [isThreadFeature, "edit-thread"],
  [isLoftFeature, "edit-loft"],
  [isSweepFeature, "edit-sweep"],
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
  [isDatumPointFeature, "edit-datum-point"],
] as const satisfies readonly [
  (feature: FeatureRecord) => boolean,
  Extract<ActivePartDesignTool, { featureId: FeatureId }>["kind"],
][]

export function editPartDesignTool(
  feature: FeatureRecord | undefined,
): ActivePartDesignTool | null {
  if (!feature) return null
  if (readConnectMountsFeatureParameters(feature))
    return { kind: "edit-connect-mounts", featureId: feature.id }
  if (readCoilFeatureParameters(feature)) return { kind: "edit-coil", featureId: feature.id }
  if (isPressPullFeature(feature)) return { kind: "edit-press-pull", featureId: feature.id }
  if (isDraftFeature(feature)) return { kind: "edit-draft", featureId: feature.id }
  if (isScaleFeature(feature)) return { kind: "edit-scale", featureId: feature.id }
  const kind = editableFeatureTools.find(([matches]) => matches(feature))?.[1]
  if (!kind) return null
  // TypeScript stops distributing object literals over unions above 25 members; the tuple
  // table above already constrains every kind to an edit tool that takes a feature ID.
  const tool: Readonly<{ kind: typeof kind; featureId: FeatureId }> = {
    kind,
    featureId: feature.id,
  }
  return tool as Extract<ActivePartDesignTool, { featureId: FeatureId }>
}

const commandByToolKind = {
  "inspect-imported": "inspect-imported",
  "create-connect-mounts": "connect-mounts",
  "create-coil": "coil",
  "edit-coil": "coil",
  "edit-connect-mounts": "connect-mounts",
  "create-fdm": "fdm",
  "edit-fdm": "fdm",
  "surface-texture": "surface-texture",
  "create-compound": "compound",
  "edit-compound": "compound",
  "create-union": "union",
  "edit-union": "union",
  "create-placement": "placement",
  "edit-placement": "placement",
  "create-mirror": "mirror",
  "edit-mirror": "mirror",
  "create-press-pull": "press-pull",
  "edit-press-pull": "press-pull",
  "create-shell": "shell",
  "edit-shell": "shell",
  "create-draft": "draft",
  "edit-draft": "draft",
  "create-scale": "scale",
  "edit-scale": "scale",
  "create-split": "split",
  "edit-split": "split",
  "create-pattern": "pattern",
  "edit-pattern": "pattern",
  "create-thread": "thread",
  "edit-thread": "thread",
  "create-loft": "loft",
  "edit-loft": "loft",
  "create-sweep": "sweep",
  "edit-sweep": "sweep",
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
  "create-datum-point": "datum-point",
  "edit-datum-point": "datum-point",
  measure: "measure",
} as const satisfies Record<ActivePartDesignTool["kind"], string>

export function activePartDesignCommand(activeTool: ActivePartDesignTool | null) {
  return activeTool ? commandByToolKind[activeTool.kind] : null
}
