import type { FeatureRecord } from "@vibeshape/domain"
import { readPatternFeatureParameters } from "@vibeshape/domain/part-design-pattern"
import { useTranslations } from "@vibeshape/i18n"
import type { ReactNode } from "react"
import {
  createBrowserFeatureId,
  type DocumentControllerState,
} from "../document/document-controller"
import type { ActivePartDesignTool } from "../features/part-design/part-design-tool"
import { PatternForm, type PatternFormCopy } from "../features/pattern/pattern-form"
import { type PatternFormMode, patternTargetBody } from "../features/pattern/pattern-form-model"
import type { FeaturePreviewState } from "../features/preview/use-feature-preview"
import { exactTaskSource, featureTaskFormProps } from "./feature-task-form-props"

type Props = {
  activeTool: ActivePartDesignTool
  documentBusy: boolean
  report: NonNullable<DocumentControllerState["report"]>
  onCloseTool: () => void
  onCompleteTool: () => void
  onFeaturePreviewChange: (feature: FeatureRecord | null) => void
  featurePreviewStatus: FeaturePreviewState["status"]
  renderDelete: (feature: FeatureRecord) => ReactNode
}
function patternMode(
  tool: ActivePartDesignTool,
  features: readonly FeatureRecord[],
  label: string,
): PatternFormMode | null {
  if (tool.kind === "create-pattern")
    return {
      kind: "create",
      targetBody: tool.targetBody,
      createFeatureId: createBrowserFeatureId,
      featureLabel: label,
    }
  if (tool.kind !== "edit-pattern") return null
  const feature = features.find(({ id }) => id === tool.featureId)
  return feature && readPatternFeatureParameters(feature) ? { kind: "edit", feature } : null
}
function usePatternCopy(editing: boolean): PatternFormCopy {
  const t = useTranslations("app.bodyPattern")
  return {
    title: t(editing ? "editTitle" : "title"),
    submit: t(editing ? "update" : "create"),
    description: t("description"),
    cancel: t("cancel"),
    parameters: t("parameters"),
    kind: t("kind"),
    linear: t("linear"),
    circular: t("circular"),
    axis: t("axis"),
    count: t("count"),
    countDescription: t("countDescription"),
    spacing: t("spacing"),
    spacingDescription: t("spacingDescription"),
    angle: t("angle"),
    angleDescription: t("angleDescription"),
    centerX: t("centerX"),
    centerY: t("centerY"),
    centerZ: t("centerZ"),
    centerDescription: t("centerDescription"),
    unavailable: t("unavailable"),
    previewFailed: t("previewFailed"),
    validationSummary: t("validationSummary"),
    invalidExpression: t("invalidExpression"),
    invalidDimension: t("invalidDimension"),
    invalidRange: t("invalidRange"),
    invalidCountDimension: t("invalidCountDimension"),
    invalidCountRange: t("invalidCountRange"),
    invalidAngleDimension: t("invalidAngleDimension"),
    invalidAngleRange: t("invalidAngleRange"),
    invalidCenterRange: t("invalidCenterRange"),
    invalidSpan: t("invalidSpan"),
    staleRevision: t("staleRevision"),
    saveFailed: t("saveFailed"),
  }
}
export function PatternTaskPanel(props: Props) {
  const t = useTranslations("app.bodyPattern"),
    task = useTranslations("app.shell.taskPanel")
  const { report } = props
  const count = report.snapshot.features.filter((feature) =>
    readPatternFeatureParameters(feature),
  ).length
  const mode = patternMode(
    props.activeTool,
    report.snapshot.features,
    t("featureLabel", { number: count + 1 }),
  )
  const copy = usePatternCopy(mode?.kind === "edit")
  if (!mode) return null
  const source = exactTaskSource(report, patternTargetBody(mode))
  const available = source !== null
  const key =
    mode.kind === "edit"
      ? `edit:${mode.feature.id}:${report.snapshot.revision}`
      : `create:${report.snapshot.revision}`
  return (
    <aside aria-label={task("ariaLabel")} className="min-h-0 overflow-auto border-l bg-panel p-4">
      <PatternForm
        key={key}
        copy={copy}
        mode={mode}
        sourceAvailable={available}
        {...featureTaskFormProps(props, mode)}
        variables={report.snapshot.variables}
      />
      {mode.kind === "edit" && props.renderDelete(mode.feature)}
    </aside>
  )
}
