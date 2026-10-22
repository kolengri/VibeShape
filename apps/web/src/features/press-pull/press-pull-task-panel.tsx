import { createModelBodyTopologyEvidence } from "@vibeshape/application/model-body-topology"
import type { FeatureRecord } from "@vibeshape/domain"
import { readPressPullFeatureParameters } from "@vibeshape/domain/part-design-press-pull"
import { useTranslations } from "@vibeshape/i18n"
import { type ReactNode, useMemo } from "react"
import {
  createBrowserFeatureId,
  type DocumentControllerState,
} from "../../document/document-controller"
import { featureTaskFormProps } from "../../shell/feature-task-form-props"
import type { ActivePartDesignTool } from "../part-design/part-design-tool"
import type { FeaturePreviewState } from "../preview/use-feature-preview"
import { PressPullForm, type PressPullFormCopy } from "./press-pull-form"
import { type PressPullFormMode, pressPullSource } from "./press-pull-form-model"

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
export function PressPullTaskPanel(props: Props) {
  const t = useTranslations("app.pressPull")
  const task = useTranslations("app.shell.taskPanel")
  const { report } = props
  const label = t("featureLabel", {
    number:
      report.snapshot.features.filter((feature) => readPressPullFeatureParameters(feature)).length +
      1,
  })
  const mode = useMemo<PressPullFormMode | null>(() => {
    if (props.activeTool.kind === "create-press-pull")
      return {
        ...props.activeTool,
        kind: "create",
        createFeatureId: createBrowserFeatureId,
        featureLabel: label,
      }
    if (props.activeTool.kind !== "edit-press-pull") return null
    const featureId = props.activeTool.featureId
    const feature = report.snapshot.features.find(({ id }) => id === featureId)
    return feature && readPressPullFeatureParameters(feature) ? { kind: "edit", feature } : null
  }, [props.activeTool, report.snapshot.features, label])
  const evidence = useMemo(() => {
    if (!mode) return null
    const result = createModelBodyTopologyEvidence(report.snapshot, report.rebuild, {
      ...pressPullSource(mode).targetBody,
      kind: "face",
    })
    return result.ok ? result.evidence : null
  }, [mode, report])
  const copy: PressPullFormCopy = {
    title: t(mode?.kind === "edit" ? "editTitle" : "title"),
    description: t("description"),
    cancel: t("cancel"),
    submit: t(mode?.kind === "edit" ? "update" : "create"),
    parameters: t("parameters"),
    distance: t("distance"),
    lengthDescription: t("lengthDescription"),
    unavailable: t("unavailable"),
    validationSummary: t("validationSummary"),
    invalidExpression: t("invalidExpression"),
    invalidDimension: t("invalidDimension"),
    invalidRange: t("invalidRange"),
    staleRevision: t("staleRevision"),
    saveFailed: t("saveFailed"),
    previewFailed: t("previewFailed"),
  }
  if (!mode) return null
  return (
    <aside aria-label={task("ariaLabel")} className="min-h-0 overflow-auto border-l bg-panel p-4">
      <PressPullForm
        key={`${mode.kind}:${mode.kind === "edit" ? mode.feature.id : mode.sourceContentHash}:${report.snapshot.revision}`}
        copy={copy}
        evidence={evidence}
        mode={mode}
        variables={report.snapshot.variables}
        {...featureTaskFormProps(props, mode)}
      />
      {mode.kind === "edit" && props.renderDelete(mode.feature)}
    </aside>
  )
}
