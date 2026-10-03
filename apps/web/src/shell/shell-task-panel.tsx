import { createModelBodyTopologyEvidence } from "@vibeshape/application/model-body-topology"
import type { FeatureRecord } from "@vibeshape/domain"
import { readShellFeatureParameters } from "@vibeshape/domain/part-design-shell"
import { useTranslations } from "@vibeshape/i18n"
import type { ReactNode } from "react"
import {
  createBrowserFeatureId,
  type DocumentControllerState,
} from "../document/document-controller"
import type { ActivePartDesignTool } from "../features/part-design/part-design-tool"
import type { FeaturePreviewState } from "../features/preview/use-feature-preview"
import { ShellForm, type ShellFormCopy } from "../features/shell/shell-form"
import type { ShellFormMode } from "../features/shell/shell-form-model"
import { shellTargetBody } from "../features/shell/shell-form-model"
import { featureTaskFormProps } from "./feature-task-form-props"

type ShellPanelProps = {
  activeTool: ActivePartDesignTool
  documentBusy: boolean
  report: NonNullable<DocumentControllerState["report"]>
  onCloseTool: () => void
  onCompleteTool: () => void
  onFeaturePreviewChange: (feature: FeatureRecord | null) => void
  featurePreviewStatus: FeaturePreviewState["status"]
  renderDelete: (feature: FeatureRecord) => ReactNode
}
function shellMode(
  tool: ActivePartDesignTool,
  features: readonly FeatureRecord[],
  label: string,
): ShellFormMode | null {
  if (tool.kind === "create-shell")
    return {
      kind: "create",
      targetBody: tool.targetBody,
      createFeatureId: createBrowserFeatureId,
      featureLabel: label,
    }
  if (tool.kind !== "edit-shell") return null
  const feature = features.find(({ id }) => id === tool.featureId)
  return feature && readShellFeatureParameters(feature) ? { kind: "edit", feature } : null
}
function useShellCopy(editing: boolean): ShellFormCopy {
  const t = useTranslations("app.shellOperation")
  return {
    title: t(editing ? "editTitle" : "title"),
    submit: t(editing ? "update" : "create"),
    description: t("description"),
    cancel: t("cancel"),
    parameters: t("parameters"),
    thickness: t("thickness"),
    lengthDescription: t("lengthDescription"),
    direction: t("direction"),
    inward: t("inward"),
    outward: t("outward"),
    openings: t("openings"),
    openingsDescription: t("openingsDescription"),
    repair: t("repair"),
    unavailable: t("unavailable"),
    validationSummary: t("validationSummary"),
    invalidExpression: t("invalidExpression"),
    invalidDimension: t("invalidDimension"),
    invalidRange: t("invalidRange"),
    face: (values) => t("face", values),
    staleRevision: t("staleRevision"),
    saveFailed: t("saveFailed"),
  }
}
export function ShellTaskPanel(props: ShellPanelProps) {
  const t = useTranslations("app.shellOperation")
  const task = useTranslations("app.shell.taskPanel")
  const { report } = props
  const features = report.snapshot.features
  const count = features.filter((feature) => readShellFeatureParameters(feature)).length
  const mode = shellMode(props.activeTool, features, t("featureLabel", { number: count + 1 }))
  const copy = useShellCopy(mode?.kind === "edit")
  if (!mode) return null
  const result = createModelBodyTopologyEvidence(report.snapshot, report.rebuild, {
    ...shellTargetBody(mode),
    kind: "face",
  })
  const key =
    mode.kind === "edit"
      ? `edit:${mode.feature.id}:${report.snapshot.revision}`
      : `create:${report.snapshot.revision}`
  return (
    <aside aria-label={task("ariaLabel")} className="min-h-0 overflow-auto border-l bg-panel p-4">
      <ShellForm
        key={key}
        copy={copy}
        evidence={result.ok ? result.evidence : null}
        mode={mode}
        {...featureTaskFormProps(props, mode)}
        variables={report.snapshot.variables}
      />
      {mode.kind === "edit" && props.renderDelete(mode.feature)}
    </aside>
  )
}
