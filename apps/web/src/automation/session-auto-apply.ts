import type { DraftReviewInput } from "@vibeshape/automation-host/host"
import {
  type CommandActor,
  commandActorsEqual,
  type DocumentCommand,
} from "@vibeshape/domain/commands"
import type { FeatureRecord } from "@vibeshape/domain/feature-graph"
import { featureTypeKey } from "@vibeshape/domain/feature-type-contracts"
import {
  documentCoreModule,
  featureCoreModule,
  partDesignModule,
  referenceGeometryModule,
} from "@vibeshape/domain/modules"
import { importedFeatureType } from "@vibeshape/domain/part-design-import"
import { meshImportFeatureType } from "@vibeshape/domain/part-design-mesh-import"

const importedFeatureTypeIds = new Set([
  importedFeatureType.type.typeId,
  meshImportFeatureType.type.typeId,
])
// Use the shipped first-party contracts, never extension or caller-supplied registries.
const cadFeatureKeys = new Set(
  [...partDesignModule.featureTypes, ...referenceGeometryModule.featureTypes]
    .filter(({ type }) => !importedFeatureTypeIds.has(type.typeId))
    .map(({ type }) => featureTypeKey(type)),
)
const commandVersions = new Map(
  [...documentCoreModule.commands, ...featureCoreModule.commands].map((descriptor) => [
    descriptor.kind,
    descriptor.schemaVersion,
  ]),
)

function eligibleFeature(feature: FeatureRecord) {
  return cadFeatureKeys.has(featureTypeKey(feature.type))
}

function eligibleFeatureUpdate(previous: FeatureRecord | undefined, feature: FeatureRecord) {
  if (!previous || !eligibleFeature(previous) || !eligibleFeature(feature)) return false
  return (
    previous.type.moduleId === feature.type.moduleId &&
    previous.type.moduleVersion === feature.type.moduleVersion &&
    previous.type.typeId === feature.type.typeId
  )
}

function addFeature(feature: FeatureRecord, features: Map<string, FeatureRecord>) {
  if (features.has(feature.id) || !eligibleFeature(feature)) return false
  features.set(feature.id, feature)
  return true
}

function updateFeature(feature: FeatureRecord, features: Map<string, FeatureRecord>) {
  if (!eligibleFeatureUpdate(features.get(feature.id), feature)) return false
  features.set(feature.id, feature)
  return true
}

function removeFeature(featureId: string, features: Map<string, FeatureRecord>) {
  const previous = features.get(featureId)
  if (!previous || !eligibleFeature(previous)) return false
  features.delete(featureId)
  return true
}

function setFeatureSuppression(
  payload: { featureId: string; suppressed: boolean },
  features: Map<string, FeatureRecord>,
) {
  const previous = features.get(payload.featureId)
  if (!previous || !eligibleFeature(previous)) return false
  features.set(previous.id, { ...previous, suppressed: payload.suppressed })
  return true
}

const simpleCadCommands = new Set<DocumentCommand["kind"]>([
  "org.vibeshape.variable.add",
  "org.vibeshape.variable.set-expression",
  "org.vibeshape.variable.rename",
  "org.vibeshape.variable.remove",
  "org.vibeshape.variable.replace-table",
  "org.vibeshape.sketch.add",
  "org.vibeshape.sketch.update",
  "org.vibeshape.sketch.remove",
])

function eligibleCommand(command: DocumentCommand, features: Map<string, FeatureRecord>) {
  if (command.schemaVersion !== commandVersions.get(command.kind)) return false
  if (simpleCadCommands.has(command.kind)) return true
  switch (command.kind) {
    case "org.vibeshape.feature.add":
      return addFeature(command.payload.feature, features)
    case "org.vibeshape.feature.update":
      return updateFeature(command.payload.feature, features)
    case "org.vibeshape.feature.remove":
      return removeFeature(command.payload.featureId, features)
    case "org.vibeshape.feature.set-suppressed":
      return setFeatureSuppression(command.payload, features)
    default:
      return false
  }
}

export function mayAutoApplyCadReview(
  review: DraftReviewInput,
  grant: CommandActor | null,
  baseFeatures: readonly FeatureRecord[] = [],
) {
  const features = new Map(baseFeatures.map((feature) => [feature.id, feature]))
  return (
    grant?.type === "mcp" &&
    commandActorsEqual(grant, review.actor) &&
    review.preview.geometry.status === "valid" &&
    review.commands.length > 0 &&
    review.commands.every(
      (command) =>
        command.documentId === review.preview.draft.documentId &&
        commandActorsEqual(command.actor, grant) &&
        eligibleCommand(command, features),
    )
  )
}
