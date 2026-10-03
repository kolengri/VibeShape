import type { FeatureRecord } from "@vibeshape/domain"
import { readPlacementFeatureParameters } from "@vibeshape/domain/part-design-placement"
import { useTranslations } from "@vibeshape/i18n"
import type { ReactNode } from "react"
import {
  addFeature,
  createBrowserFeatureId,
  type DocumentControllerState,
  updateFeature,
} from "../document/document-controller"
import type { ActivePartDesignTool } from "../features/part-design/part-design-tool"
import { PlacementForm, type PlacementFormCopy } from "../features/placement/placement-form"
import type { PlacementFormMode } from "../features/placement/placement-form-model"
import type { FeaturePreviewState } from "../features/preview/use-feature-preview"

type PlacementPanelProps = {
  activeTool: ActivePartDesignTool
  documentBusy: boolean
  report: NonNullable<DocumentControllerState["report"]>
  onCloseTool: () => void
  onCompleteTool: () => void
  onFeaturePreviewChange: (feature: FeatureRecord | null) => void
  featurePreviewStatus: FeaturePreviewState["status"]
  renderDelete: (feature: FeatureRecord) => ReactNode
}
function placementMode(
  tool: ActivePartDesignTool,
  features: readonly FeatureRecord[],
  label: string,
): PlacementFormMode | null {
  if (tool.kind === "create-placement")
    return {
      kind: "create",
      targetBody: tool.targetBody,
      createFeatureId: createBrowserFeatureId,
      featureLabel: label,
    }
  if (tool.kind !== "edit-placement") return null
  const feature = features.find(({ id }) => id === tool.featureId)
  return feature && readPlacementFeatureParameters(feature) ? { kind: "edit", feature } : null
}
function usePlacementCopy(editing: boolean): PlacementFormCopy {
  const t = useTranslations("app.placement")
  return {
    title: t(editing ? "editTitle" : "title"),
    submit: t(editing ? "update" : "create"),
    description: t("description"),
    cancel: t("cancel"),
    parameters: t("parameters"),
    translation: t("translation"),
    rotation: t("rotation"),
    translationX: t("translationX"),
    translationY: t("translationY"),
    translationZ: t("translationZ"),
    rotationX: t("rotationX"),
    rotationY: t("rotationY"),
    rotationZ: t("rotationZ"),
    lengthDescription: t("lengthDescription"),
    angleDescription: t("angleDescription"),
    invalidExpression: t("invalidExpression"),
    invalidDimension: t("invalidDimension"),
    invalidAngleDimension: t("invalidAngleDimension"),
    invalidRange: t("invalidTranslationRange"),
    invalidTranslationRange: t("invalidTranslationRange"),
    invalidRotationRange: t("invalidRotationRange"),
    validationSummary: t("validationSummary"),
    staleRevision: t("staleRevision"),
    saveFailed: t("saveFailed"),
  }
}
export function PlacementTaskPanel(props: PlacementPanelProps) {
  const t = useTranslations("app.placement")
  const task = useTranslations("app.shell.taskPanel")
  const { report } = props
  const features = report.snapshot.features
  const count = features.filter((feature) => readPlacementFeatureParameters(feature)).length
  const mode = placementMode(props.activeTool, features, t("featureLabel", { number: count + 1 }))
  const copy = usePlacementCopy(mode?.kind === "edit")
  if (!mode) return null
  const key =
    mode.kind === "edit"
      ? `edit:${mode.feature.id}:${report.snapshot.revision}`
      : `create:${report.snapshot.revision}`
  return (
    <aside aria-label={task("ariaLabel")} className="min-h-0 overflow-auto border-l bg-panel p-4">
      <PlacementForm
        key={key}
        baseRevision={report.snapshot.revision}
        copy={copy}
        mode={mode}
        variables={report.snapshot.variables}
        disabled={props.documentBusy || report.mode === "read-only"}
        onCancel={props.onCloseTool}
        onSaved={props.onCompleteTool}
        onSave={mode.kind === "edit" ? updateFeature : addFeature}
        onPreviewChange={props.onFeaturePreviewChange}
        previewStatus={props.featurePreviewStatus}
      />
      {mode.kind === "edit" && props.renderDelete(mode.feature)}
    </aside>
  )
}
