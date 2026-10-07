import { createModelBodyMeasurementEvidence } from "@vibeshape/application/model-measurements"
import type { FeatureRecord } from "@vibeshape/domain"
import type { BodyReference } from "@vibeshape/domain/body-reference"
import {
  addFeature,
  type DocumentControllerState,
  saveFeatureEdits,
} from "../document/document-controller"
import type { FeaturePreviewState } from "../features/preview/use-feature-preview"

type FeatureTaskLifecycle = {
  documentBusy: boolean
  report: NonNullable<DocumentControllerState["report"]>
  onCloseTool: () => void
  onCompleteTool: () => void
  onFeaturePreviewChange: (feature: FeatureRecord | null) => void
  featurePreviewStatus: FeaturePreviewState["status"]
}
/** A task must address one valid solid by its durable output role. */
export function exactTaskSource(report: FeatureTaskLifecycle["report"], target: BodyReference) {
  const result = createModelBodyMeasurementEvidence(report.snapshot, report.rebuild)
  if (!result.ok) return null
  const sources = result.evidence.bodies.filter(
    (body) =>
      body.featureId === target.featureId && (body.outputRole ?? "result") === target.outputRole,
  )
  const source = sources.length === 1 ? sources[0] : null
  return source?.shape.valid && source.shape.solidCount === 1 ? source : null
}
/** Exact-body tasks share the authoritative save and disposable preview lifecycle. */
export function featureTaskFormProps(
  props: FeatureTaskLifecycle,
  mode: { kind: "create" | "edit" },
) {
  return {
    baseRevision: props.report.snapshot.revision,
    disabled: props.documentBusy || props.report.mode === "read-only",
    onCancel: props.onCloseTool,
    onSaved: props.onCompleteTool,
    onSave: mode.kind === "edit" ? saveFeatureEdits : addFeature,
    onPreviewChange: props.onFeaturePreviewChange,
    previewStatus: props.featurePreviewStatus,
  }
}
