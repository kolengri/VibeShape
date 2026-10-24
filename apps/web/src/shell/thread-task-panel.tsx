import type { FeatureRecord } from "@vibeshape/domain"
import { readThreadFeatureParameters } from "@vibeshape/domain/part-design-thread"
import { useTranslations } from "@vibeshape/i18n"
import type { ReactNode } from "react"
import { TaskPanelSurface } from "../components/task-panel-layout"
import {
  createBrowserFeatureId,
  type DocumentControllerState,
} from "../document/document-controller"
import type { ActivePartDesignTool } from "../features/part-design/part-design-tool"
import type { FeaturePreviewState } from "../features/preview/use-feature-preview"
import { useReferenceFrameOptions } from "../features/reference-geometry/use-reference-frame-options"
import { ThreadForm, type ThreadFormCopy } from "../features/thread/thread-form"
import { type ThreadFormMode, threadTargetBody } from "../features/thread/thread-form-model"
import { exactTaskSource, featureTaskFormProps, featureTaskKey } from "./feature-task-form-props"

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
function threadMode(
  tool: ActivePartDesignTool,
  features: readonly FeatureRecord[],
  label: string,
): ThreadFormMode | null {
  if (tool.kind === "create-thread")
    return {
      kind: "create",
      targetBody: tool.targetBody,
      createFeatureId: createBrowserFeatureId,
      featureLabel: label,
    }
  if (tool.kind !== "edit-thread") return null
  const feature = features.find(({ id }) => id === tool.featureId)
  return feature && readThreadFeatureParameters(feature) ? { kind: "edit", feature } : null
}
function useThreadCopy(editing: boolean): ThreadFormCopy {
  const t = useTranslations("app.thread")
  return {
    title: t(editing ? "editTitle" : "title"),
    submit: t(editing ? "update" : "create"),
    description: t("description"),
    cancel: t("cancel"),
    parameters: t("parameters"),
    metricSize: t("metricSize"),
    customSize: t("customSize"),
    metricSizeDescription: t("metricSizeDescription"),
    advanced: t("advanced"),
    kind: t("kind"),
    external: t("external"),
    internal: t("internal"),
    axis: t("axis"),
    handedness: t("handedness"),
    right: t("right"),
    left: t("left"),
    nominalDiameter: t("nominalDiameter"),
    pitch: t("pitch"),
    length: t("length"),
    depth: t("depth"),
    clearance: t("clearance"),
    originX: t("originX"),
    originY: t("originY"),
    originZ: t("originZ"),
    starts: t("starts"),
    phase: t("phase"),
    runIn: t("runIn"),
    runOut: t("runOut"),
    dimensionDescription: t("dimensionDescription"),
    pitchDescription: t("pitchDescription"),
    clearanceDescription: t("clearanceDescription"),
    originDescription: t("originDescription"),
    startsDescription: t("startsDescription"),
    phaseDescription: t("phaseDescription"),
    allowanceDescription: t("allowanceDescription"),
    unavailable: t("unavailable"),
    previewFailed: t("previewFailed"),
    validationSummary: t("validationSummary"),
    invalidExpression: t("invalidExpression"),
    invalidDimension: t("invalidDimension"),
    invalidAngleDimension: t("invalidAngleDimension"),
    invalidScalarDimension: t("invalidScalarDimension"),
    invalidDimensionRange: t("invalidDimensionRange"),
    invalidPitchRange: t("invalidPitchRange"),
    invalidAllowanceRange: t("invalidAllowanceRange"),
    invalidOriginRange: t("invalidOriginRange"),
    invalidStartsRange: t("invalidStartsRange"),
    invalidPhaseRange: t("invalidPhaseRange"),
    invalidBand: t("invalidBand"),
    invalidTurns: t("invalidTurns"),
    invalidDepth: t("invalidDepth"),
    invalidRootRadius: t("invalidRootRadius"),
    staleRevision: t("staleRevision"),
    saveFailed: t("saveFailed"),
  }
}
export function ThreadTaskPanel(props: Props) {
  const t = useTranslations("app.thread"),
    task = useTranslations("app.shell.taskPanel")
  const { report } = props
  const count = report.snapshot.features.filter((feature) =>
    readThreadFeatureParameters(feature),
  ).length
  const mode = threadMode(
    props.activeTool,
    report.snapshot.features,
    t("featureLabel", { number: count + 1 }),
  )
  const copy = useThreadCopy(mode?.kind === "edit")
  const referenceOptions = useReferenceFrameOptions(
    report.snapshot,
    report.rebuild,
    mode?.kind === "edit" ? mode.feature.id : undefined,
  )
  if (!mode) return null
  const source = exactTaskSource(report, threadTargetBody(mode))
  const available = source !== null
  const key = featureTaskKey(mode, report.snapshot.revision)
  return (
    <TaskPanelSurface
      aria-label={task("ariaLabel")}
      trailingContent={mode.kind === "edit" && props.renderDelete(mode.feature)}
    >
      <ThreadForm
        key={key}
        copy={copy}
        mode={mode}
        sourceAvailable={available}
        axisOptions={referenceOptions}
        {...featureTaskFormProps(props, mode)}
        variables={report.snapshot.variables}
      />
    </TaskPanelSurface>
  )
}
