import {
  type FeatureId,
  featureRecordSchema,
  isSketchExternalModelReference,
  orphanModelReferencesToFeature,
  type SketchId,
} from "@vibeshape/domain"
import { authoredHistoryFeature, authoredHistorySketch } from "@vibeshape/domain/history-repair"
import type { DocumentControllerState } from "../document/document-controller"
import type { ActivePartDesignTool } from "../features/part-design/part-design-tool"

export function historyFeatureForEditing(
  controller: DocumentControllerState,
  featureId: FeatureId,
) {
  const authority = controller.authoredSnapshot
  const record = authority ? authoredHistoryFeature(authority, featureId) : undefined
  if (!record) return controller.report?.snapshot.features.find(({ id }) => id === featureId)
  const { semanticInputs: _inputs, ...feature } = record
  return featureRecordSchema.parse({ ...feature, schemaVersion: 0 })
}

export function historySketchForEditing(controller: DocumentControllerState, sketchId: SketchId) {
  const authority = controller.authoredSnapshot
  let record =
    (authority ? authoredHistorySketch(authority, sketchId) : undefined) ??
    controller.report?.snapshot.sketches.find(({ id }) => id === sketchId)
  if (!record || (authority?.schemaVersion !== 5 && authority?.schemaVersion !== 6)) return record
  const survivingFeatures = new Set(authority.features.map(({ id }) => id))
  const missingProducers = new Set(
    record.externalReferences?.flatMap((reference) =>
      isSketchExternalModelReference(reference) &&
      !survivingFeatures.has(reference.reference.featureId)
        ? [reference.reference.featureId]
        : [],
    ),
  )
  // Only the disposable editing recipe can repair references to a different producer.
  for (const producerId of missingProducers) {
    record = orphanModelReferencesToFeature(record, producerId)
  }
  return record
}

/** Form values use the retained recipe; viewport and kernel keep the disconnected active record. */
export function historyRepairTaskContext(
  controller: DocumentControllerState,
  tool: ActivePartDesignTool | null,
) {
  const report = controller.report
  const authority = controller.authoredSnapshot
  if (
    !report ||
    (authority?.schemaVersion !== 5 && authority?.schemaVersion !== 6) ||
    !tool ||
    !("featureId" in tool) ||
    !tool.featureId
  )
    return controller
  const id = tool.featureId
  if (
    !authority.repairIntents.some(
      (intent) => intent.kind === "feature" && intent.authored.id === id,
    )
  )
    return controller
  const authored = historyFeatureForEditing(controller, id)
  if (!authored) return controller
  return {
    ...controller,
    report: {
      ...report,
      snapshot: {
        ...report.snapshot,
        features: report.snapshot.features.map((feature) =>
          feature.id === id ? authored : feature,
        ),
      },
    },
  }
}
