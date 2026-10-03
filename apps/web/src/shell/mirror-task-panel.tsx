import type { FeatureRecord } from "@vibeshape/domain"
import { readMirrorFeatureParameters } from "@vibeshape/domain/part-design-mirror"
import { useTranslations } from "@vibeshape/i18n"
import type { ReactNode } from "react"
import {
  createBrowserFeatureId,
  type DocumentControllerState,
} from "../document/document-controller"
import { MirrorForm, type MirrorFormCopy } from "../features/mirror/mirror-form"
import type { MirrorFormMode } from "../features/mirror/mirror-form-model"
import type { ActivePartDesignTool } from "../features/part-design/part-design-tool"
import type { FeaturePreviewState } from "../features/preview/use-feature-preview"
import { featureTaskFormProps } from "./feature-task-form-props"

type MirrorPanelProps = {
  activeTool: ActivePartDesignTool
  documentBusy: boolean
  report: NonNullable<DocumentControllerState["report"]>
  onCloseTool: () => void
  onCompleteTool: () => void
  onFeaturePreviewChange: (feature: FeatureRecord | null) => void
  featurePreviewStatus: FeaturePreviewState["status"]
  renderDelete: (feature: FeatureRecord) => ReactNode
}
function mirrorMode(
  tool: ActivePartDesignTool,
  features: readonly FeatureRecord[],
  label: string,
): MirrorFormMode | null {
  if (tool.kind === "create-mirror")
    return {
      kind: "create",
      targetBody: tool.targetBody,
      createFeatureId: createBrowserFeatureId,
      featureLabel: label,
    }
  if (tool.kind !== "edit-mirror") return null
  const feature = features.find(({ id }) => id === tool.featureId)
  return feature && readMirrorFeatureParameters(feature) ? { kind: "edit", feature } : null
}
function useMirrorCopy(editing: boolean): MirrorFormCopy {
  const t = useTranslations("app.mirror")
  return {
    title: t(editing ? "editTitle" : "title"),
    submit: t(editing ? "update" : "create"),
    description: t("description"),
    cancel: t("cancel"),
    parameters: t("parameters"),
    plane: t("plane"),
    staleRevision: t("staleRevision"),
    saveFailed: t("saveFailed"),
  }
}
export function MirrorTaskPanel(props: MirrorPanelProps) {
  const t = useTranslations("app.mirror")
  const task = useTranslations("app.shell.taskPanel")
  const { report } = props
  const features = report.snapshot.features
  const count = features.filter((feature) => readMirrorFeatureParameters(feature)).length
  const mode = mirrorMode(props.activeTool, features, t("featureLabel", { number: count + 1 }))
  const copy = useMirrorCopy(mode?.kind === "edit")
  if (!mode) return null
  const key =
    mode.kind === "edit"
      ? `edit:${mode.feature.id}:${report.snapshot.revision}`
      : `create:${report.snapshot.revision}`
  return (
    <aside aria-label={task("ariaLabel")} className="min-h-0 overflow-auto border-l bg-panel p-4">
      <MirrorForm
        key={key}
        copy={copy}
        mode={mode}
        {...featureTaskFormProps(props, mode)}
        variables={report.snapshot.variables}
      />
      {mode.kind === "edit" && props.renderDelete(mode.feature)}
    </aside>
  )
}
