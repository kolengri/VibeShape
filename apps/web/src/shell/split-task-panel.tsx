import type { FeatureRecord } from "@vibeshape/domain"
import { readSplitFeatureParameters } from "@vibeshape/domain/part-design-split"
import { useTranslations } from "@vibeshape/i18n"
import type { ReactNode } from "react"
import {
  createBrowserFeatureId,
  type DocumentControllerState,
} from "../document/document-controller"
import type { ActivePartDesignTool } from "../features/part-design/part-design-tool"
import type { FeaturePreviewState } from "../features/preview/use-feature-preview"
import { SplitForm, type SplitFormCopy } from "../features/split/split-form"
import { type SplitFormMode, splitTargetBody } from "../features/split/split-form-model"
import { exactTaskSource, featureTaskFormProps } from "./feature-task-form-props"

type SplitPanelProps = {
  activeTool: ActivePartDesignTool
  documentBusy: boolean
  report: NonNullable<DocumentControllerState["report"]>
  onCloseTool: () => void
  onCompleteTool: () => void
  onFeaturePreviewChange: (feature: FeatureRecord | null) => void
  featurePreviewStatus: FeaturePreviewState["status"]
  renderDelete: (feature: FeatureRecord) => ReactNode
}
function splitMode(
  tool: ActivePartDesignTool,
  features: readonly FeatureRecord[],
  label: string,
): SplitFormMode | null {
  if (tool.kind === "create-split")
    return {
      kind: "create",
      targetBody: tool.targetBody,
      createFeatureId: createBrowserFeatureId,
      featureLabel: label,
    }
  if (tool.kind !== "edit-split") return null
  const feature = features.find(({ id }) => id === tool.featureId)
  return feature && readSplitFeatureParameters(feature) ? { kind: "edit", feature } : null
}
function useSplitCopy(editing: boolean): SplitFormCopy {
  const t = useTranslations("app.split")
  return {
    title: t(editing ? "editTitle" : "title"),
    submit: t(editing ? "update" : "create"),
    description: t("description"),
    cancel: t("cancel"),
    parameters: t("parameters"),
    plane: t("plane"),
    offset: t("offset"),
    lengthDescription: t("lengthDescription"),
    planeDescription: t("planeDescription"),
    midpoint: t("midpoint"),
    unavailable: t("unavailable"),
    validationSummary: t("validationSummary"),
    invalidExpression: t("invalidExpression"),
    invalidDimension: t("invalidDimension"),
    invalidRange: t("invalidRange"),
    staleRevision: t("staleRevision"),
    saveFailed: t("saveFailed"),
  }
}
export function SplitTaskPanel(props: SplitPanelProps) {
  const t = useTranslations("app.split")
  const task = useTranslations("app.shell.taskPanel")
  const { report } = props
  const count = report.snapshot.features.filter((feature) =>
    readSplitFeatureParameters(feature),
  ).length
  const mode = splitMode(
    props.activeTool,
    report.snapshot.features,
    t("featureLabel", { number: count + 1 }),
  )
  const copy = useSplitCopy(mode?.kind === "edit")
  if (!mode) return null
  const source = exactTaskSource(report, splitTargetBody(mode))
  const bounds = source?.shape.bounds ?? null
  const key =
    mode.kind === "edit"
      ? `edit:${mode.feature.id}:${report.snapshot.revision}`
      : `create:${report.snapshot.revision}`
  return (
    <aside aria-label={task("ariaLabel")} className="min-h-0 overflow-auto border-l bg-panel p-4">
      <SplitForm
        key={key}
        copy={copy}
        mode={mode}
        sourceBounds={bounds}
        {...featureTaskFormProps(props, mode)}
        variables={report.snapshot.variables}
      />
      {mode.kind === "edit" && props.renderDelete(mode.feature)}
    </aside>
  )
}
