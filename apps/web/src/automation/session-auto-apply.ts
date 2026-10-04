import type { DraftReviewInput } from "@vibeshape/automation-host/host"
import {
  type CommandActor,
  commandActorsEqual,
  type DocumentCommand,
} from "@vibeshape/domain/commands"
import type { FeatureRecord } from "@vibeshape/domain/feature-graph"

// Explicit versions keep future commands and extension features outside an existing grant.
const featureVersions: Readonly<Record<string, readonly number[]>> = {
  box: [1],
  cylinder: [1],
  boolean: [1],
  union: [2],
  loft: [1, 2, 3],
  extrusion: [1, 2, 3, 4, 5],
  revolve: [1, 2, 3, 4, 5, 6],
  hole: [1, 2],
  fillet: [1, 2],
  chamfer: [1, 2],
}

function eligibleFeature(feature: FeatureRecord) {
  const type = feature.type
  if (feature.suppressed || type.moduleVersion !== "0.1.0") return false
  if (type.moduleId === "org.vibeshape.core.reference-geometry")
    return (
      type.typeId === "org.vibeshape.feature.reference-geometry.datum-plane" &&
      type.schemaVersion === 1
    )
  if (type.moduleId !== "org.vibeshape.core.part-design") return false
  return Object.entries(featureVersions).some(
    ([name, versions]) =>
      type.typeId === `org.vibeshape.feature.part-design.${name}` &&
      versions.includes(type.schemaVersion),
  )
}

function eligibleFeatureUpdate(previous: FeatureRecord | undefined, feature: FeatureRecord) {
  if (!previous || !eligibleFeature(previous) || !eligibleFeature(feature)) return false
  return (
    previous.type.moduleId === feature.type.moduleId &&
    previous.type.moduleVersion === feature.type.moduleVersion &&
    previous.type.typeId === feature.type.typeId &&
    previous.type.schemaVersion === feature.type.schemaVersion
  )
}

const simpleCadCommands = new Set<DocumentCommand["kind"]>([
  "org.vibeshape.variable.add",
  "org.vibeshape.variable.set-expression",
  "org.vibeshape.sketch.add",
  "org.vibeshape.sketch.update",
])

function eligibleCommand(command: DocumentCommand, features: Map<string, FeatureRecord>) {
  if (command.schemaVersion !== 1) return false
  if (simpleCadCommands.has(command.kind)) return true
  switch (command.kind) {
    case "org.vibeshape.feature.add": {
      const feature = command.payload.feature
      if (features.has(feature.id) || !eligibleFeature(feature)) return false
      features.set(feature.id, feature)
      return true
    }
    case "org.vibeshape.feature.update": {
      const feature = command.payload.feature
      const previous = features.get(feature.id)
      if (!eligibleFeatureUpdate(previous, feature)) return false
      features.set(feature.id, feature)
      return true
    }
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
