import { createModelBodyTopologyEvidence } from "@vibeshape/application/model-body-topology"
import { readExtrusionFeatureParameters } from "@vibeshape/domain"
import type { BodyReference } from "@vibeshape/domain/body-reference"
import { readDraftFeatureParameters } from "@vibeshape/domain/part-design-draft"
import { useTranslations } from "@vibeshape/i18n"
import { useMemo } from "react"
import { TaskPanelSurface } from "../components/task-panel-layout"
import { DraftForm, type DraftFormCopy } from "../features/draft/draft-form"
import { draftTargetBody } from "../features/draft/draft-form-model"
import type { ReferenceFrameOptions } from "../features/reference-geometry/reference-frame-options"
import { useReferenceFrameOptions } from "../features/reference-geometry/use-reference-frame-options"
import type { ShellPickingContext, ShellPickRequest } from "../features/shell/shell-picking"
import { type BodyFeatureTaskPanelProps, bodyFeatureTaskMode } from "./body-feature-task-mode"
import { featureTaskFormProps, featureTaskKey } from "./feature-task-form-props"

type DraftTaskPanelProps = BodyFeatureTaskPanelProps & {
  shellPickRequest?: ShellPickRequest | null | undefined
  onShellPickingContextChange?: ((context: ShellPickingContext | null) => void) | undefined
}

function useDraftCopy(editing: boolean): DraftFormCopy {
  const t = useTranslations("app.draft")
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
    angle: t("angle"),
    angleDescription: t("angleDescription"),
    flip: t("flip"),
    flipDescription: t("flipDescription"),
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

/** A planar neutral face must belong to the drafted body; Datum and origin planes stay available. */
function neutralPlaneOptions(
  options: ReferenceFrameOptions,
  target: BodyReference,
): ReferenceFrameOptions {
  return {
    ...options,
    planes: options.planes.filter(
      ({ support }) =>
        support.kind !== "planar-face" ||
        (support.reference.featureId === target.featureId &&
          support.reference.outputRole === target.outputRole),
    ),
  }
}

export function DraftTaskPanel(props: DraftTaskPanelProps) {
  const t = useTranslations("app.draft")
  const task = useTranslations("app.shell.taskPanel")
  const { report } = props
  const features = report.snapshot.features
  const count = features.filter((feature) => readDraftFeatureParameters(feature)).length
  const mode = bodyFeatureTaskMode({
    tool: props.activeTool,
    features,
    label: t("featureLabel", { number: count + 1 }),
    createKind: "create-draft",
    editKind: "edit-draft",
    accepts: (feature) => readDraftFeatureParameters(feature) !== null,
  })
  const copy = useDraftCopy(mode?.kind === "edit")
  const target = mode ? draftTargetBody(mode) : null
  const options = useReferenceFrameOptions(
    report.snapshot,
    report.rebuild,
    mode?.kind === "edit" ? mode.feature.id : undefined,
  )
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
      <DraftForm
        key={featureTaskKey(mode, report.snapshot.revision)}
        copy={copy}
        mode={mode}
        evidence={evidence}
        allowSemanticRebinding={!extrusion || extrusion.operation === "new"}
        referenceOptions={neutralPlaneOptions(options, target)}
        selectedFace={props.selectedFace}
        pickingRequest={props.shellPickRequest ?? null}
        onPickingContextChange={props.onShellPickingContextChange}
        {...featureTaskFormProps(props, mode)}
        variables={report.snapshot.variables}
      />
    </TaskPanelSurface>
  )
}
