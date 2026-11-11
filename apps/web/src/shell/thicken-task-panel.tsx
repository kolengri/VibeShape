import { createModelBodyTopologyEvidence } from "@vibeshape/application/model-body-topology"
import { readExtrusionFeatureParameters } from "@vibeshape/domain"
import { readThickenFeatureParameters } from "@vibeshape/domain/part-design-thicken"
import { useTranslations } from "@vibeshape/i18n"
import { useMemo } from "react"
import { TaskPanelSurface } from "../components/task-panel-layout"
import type { ShellPickingContext, ShellPickRequest } from "../features/shell/shell-picking"
import { ThickenForm, type ThickenFormCopy } from "../features/thicken/thicken-form"
import { type ThickenFormMode, thickenTargetBody } from "../features/thicken/thicken-form-model"
import { type BodyFeatureTaskPanelProps, bodyFeatureTaskMode } from "./body-feature-task-mode"
import { featureTaskFormProps, featureTaskKey } from "./feature-task-form-props"
import { useHistoryFeatureBodyReplacement } from "./history-feature-repair"

type ThickenTaskPanelProps = BodyFeatureTaskPanelProps & {
  shellPickRequest?: ShellPickRequest | null | undefined
  onShellPickingContextChange?: ((context: ShellPickingContext | null) => void) | undefined
}

function useThickenCopy(editing: boolean): ThickenFormCopy {
  const t = useTranslations("app.thicken")
  return {
    title: t(editing ? "editTitle" : "title"),
    submit: t(editing ? "update" : "create"),
    description: t("description"),
    cancel: t("cancel"),
    parameters: t("parameters"),
    faces: {
      legend: t("faces"),
      description: t("facesDescription"),
      count: (values) => t("faceCount", values),
      faceName: (values) => t("faceName", values),
      face: (values) => t("face", values),
    },
    thickness: t("thickness"),
    thicknessDescription: t("thicknessDescription"),
    side: t("side"),
    sideDescription: t("sideDescription"),
    sides: { outward: t("outward"), inward: t("inward"), symmetric: t("symmetric") },
    operation: t("operation"),
    operationDescription: t("operationDescription"),
    operations: { new: t("operationNew"), add: t("operationAdd"), remove: t("operationRemove") },
    repair: t("repair"),
    unavailable: t("unavailable"),
    validationSummary: t("validationSummary"),
    invalidExpression: t("invalidExpression"),
    invalidDimension: t("invalidDimension"),
    invalidRange: t("invalidRange"),
    staleRevision: t("staleRevision"),
    saveFailed: t("saveFailed"),
    previewFailed: t("previewFailed"),
  }
}

/** The saved or new Thicken task, retargeted when History repair chose a replacement body. */
function useThickenTaskMode(props: ThickenTaskPanelProps, label: string): ThickenFormMode | null {
  const savedMode = bodyFeatureTaskMode({
    tool: props.activeTool,
    features: props.report.snapshot.features,
    label,
    createKind: "create-thicken",
    editKind: "edit-thicken",
    accepts: (feature) => readThickenFeatureParameters(feature) !== null,
  })
  const replacement = useHistoryFeatureBodyReplacement(
    savedMode?.kind === "edit" ? savedMode.feature.id : undefined,
  )
  return savedMode?.kind === "edit" && replacement?.faceTarget
    ? { ...savedMode, repairTarget: replacement.faceTarget }
    : savedMode
}

export function ThickenTaskPanel(props: ThickenTaskPanelProps) {
  const t = useTranslations("app.thicken")
  const task = useTranslations("app.shell.taskPanel")
  const { report } = props
  const features = report.snapshot.features
  const count = features.filter((feature) => readThickenFeatureParameters(feature)).length
  const mode = useThickenTaskMode(props, t("featureLabel", { number: count + 1 }))
  const copy = useThickenCopy(mode?.kind === "edit")
  const target = mode ? thickenTargetBody(mode) : null
  const targetFeatureId = target?.featureId
  const targetOutputRole = target?.outputRole
  const evidence = useMemo(() => {
    if (!targetFeatureId || !targetOutputRole) return null
    const result = createModelBodyTopologyEvidence(report.snapshot, report.rebuild, {
      featureId: targetFeatureId,
      outputRole: targetOutputRole,
      kind: "face",
    })
    return result.ok ? result.evidence : null
  }, [report, targetFeatureId, targetOutputRole])
  if (!mode || !target) return null
  const source = features.find(({ id }) => id === target.featureId)
  const extrusion = source ? readExtrusionFeatureParameters(source) : null
  return (
    <TaskPanelSurface
      aria-label={task("ariaLabel")}
      trailingContent={mode.kind === "edit" && props.renderDelete(mode.feature)}
    >
      <ThickenForm
        key={featureTaskKey(mode, report.snapshot.revision)}
        copy={copy}
        mode={mode}
        evidence={evidence}
        allowSemanticRebinding={!extrusion || extrusion.operation === "new"}
        pickingRequest={props.shellPickRequest ?? null}
        onPickingContextChange={props.onShellPickingContextChange}
        {...featureTaskFormProps(props, mode)}
        previewDiagnostic={props.featurePreviewDiagnostic}
        variables={report.snapshot.variables}
      />
    </TaskPanelSurface>
  )
}
