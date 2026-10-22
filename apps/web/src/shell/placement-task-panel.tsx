import type { ResolvedAuthoredPart } from "@vibeshape/application/authored-parts"
import type { FeatureRecord } from "@vibeshape/domain"
import { readPlacementFeatureParameters } from "@vibeshape/domain/part-design-placement"
import { useTranslations } from "@vibeshape/i18n"
import type { ViewerSelection } from "@vibeshape/viewer/three-viewport"
import { type ReactNode, useMemo } from "react"
import {
  createBrowserFeatureId,
  type DocumentControllerState,
} from "../document/document-controller"
import type { ActivePartDesignTool } from "../features/part-design/part-design-tool"
import { placementAlignmentFaces } from "../features/placement/placement-face-alignment"
import { PlacementForm, type PlacementFormCopy } from "../features/placement/placement-form"
import type { PlacementFormMode } from "../features/placement/placement-form-model"
import type { PlacementManipulator } from "../features/placement/placement-manipulator"
import type { FeaturePreviewState } from "../features/preview/use-feature-preview"
import { exactTaskSource, featureTaskFormProps } from "./feature-task-form-props"

type PlacementPanelProps = {
  activeTool: ActivePartDesignTool
  documentBusy: boolean
  report: NonNullable<DocumentControllerState["report"]>
  onCloseTool: () => void
  onCompleteTool: () => void
  onFeaturePreviewChange: (feature: FeatureRecord | null) => void
  featurePreviewStatus: FeaturePreviewState["status"]
  renderDelete: (feature: FeatureRecord) => ReactNode
  selectedFace?: ViewerSelection | null | undefined
  parts: readonly ResolvedAuthoredPart[]
  onPlacementManipulatorChange?: ((value: PlacementManipulator | null) => void) | undefined
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
  return useMemo(
    () => ({
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
      unavailable: t("unavailable"),
    }),
    [editing, t],
  )
}
export function PlacementTaskPanel(props: PlacementPanelProps) {
  const t = useTranslations("app.placement")
  const task = useTranslations("app.shell.taskPanel")
  const { report } = props
  const features = report.snapshot.features
  const count = features.filter((feature) => readPlacementFeatureParameters(feature)).length
  const label = t("featureLabel", { number: count + 1 })
  const mode = useMemo(
    () => placementMode(props.activeTool, features, label),
    [props.activeTool, features, label],
  )
  const copy = usePlacementCopy(mode?.kind === "edit")
  const source = useMemo(
    () =>
      props.activeTool.kind === "create-placement"
        ? props.activeTool.targetBody
        : mode?.kind === "edit"
          ? readPlacementFeatureParameters(mode.feature)?.targetBody
          : undefined,
    [props.activeTool, mode],
  )
  const faces = useMemo(
    () =>
      source
        ? placementAlignmentFaces(report.snapshot, report.rebuild, source, props.parts)
        : undefined,
    [report.snapshot, report.rebuild, props.parts, source],
  )
  const bounds = useMemo(
    () => (source ? (exactTaskSource(report, source)?.shape.bounds ?? null) : null),
    [report, source],
  )
  if (!mode) return null
  const key =
    mode.kind === "edit"
      ? `edit:${mode.feature.id}:${report.snapshot.revision}`
      : `create:${mode.targetBody.featureId}:${mode.targetBody.outputRole}:${report.snapshot.revision}`
  return (
    <aside
      aria-label={task("ariaLabel")}
      className="flex min-h-0 min-w-0 flex-col overflow-hidden border-l bg-panel"
    >
      <PlacementForm
        key={key}
        copy={copy}
        mode={mode}
        alignmentFaces={faces}
        selectedFace={props.selectedFace}
        sourceBounds={bounds}
        onManipulatorChange={props.onPlacementManipulatorChange}
        {...featureTaskFormProps(props, mode)}
        variables={report.snapshot.variables}
      />
      {mode.kind === "edit" && props.renderDelete(mode.feature)}
    </aside>
  )
}
