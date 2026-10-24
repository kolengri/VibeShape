import {
  readPatternFeatureParameters,
  readPatternFeatureParametersV2,
} from "@vibeshape/domain/part-design-pattern"
import { useTranslations } from "@vibeshape/i18n"
import { TaskPanelSurface } from "../components/task-panel-layout"
import { PatternForm, type PatternFormCopy } from "../features/pattern/pattern-form"
import { patternTargetBody } from "../features/pattern/pattern-form-model"
import { useReferenceFrameOptions } from "../features/reference-geometry/use-reference-frame-options"
import { type BodyFeatureTaskPanelProps, bodyFeatureTaskMode } from "./body-feature-task-mode"
import { exactTaskSource, featureTaskFormProps, featureTaskKey } from "./feature-task-form-props"

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
export function PatternTaskPanel(props: BodyFeatureTaskPanelProps) {
  const t = useTranslations("app.bodyPattern"),
    task = useTranslations("app.shell.taskPanel")
  const { report } = props
  const count = report.snapshot.features.filter(
    (feature) => readPatternFeatureParameters(feature) || readPatternFeatureParametersV2(feature),
  ).length
  const mode = bodyFeatureTaskMode({
    tool: props.activeTool,
    features: report.snapshot.features,
    label: t("featureLabel", { number: count + 1 }),
    createKind: "create-pattern",
    editKind: "edit-pattern",
    accepts: (feature) =>
      Boolean(readPatternFeatureParameters(feature) || readPatternFeatureParametersV2(feature)),
  })
  const copy = usePatternCopy(mode?.kind === "edit")
  const referenceOptions = useReferenceFrameOptions(
    report.snapshot,
    report.rebuild,
    mode?.kind === "edit" ? mode.feature.id : undefined,
  )
  if (!mode) return null
  const source = exactTaskSource(report, patternTargetBody(mode))
  const available = source !== null
  const key = featureTaskKey(mode, report.snapshot.revision)
  return (
    <TaskPanelSurface
      aria-label={task("ariaLabel")}
      trailingContent={mode.kind === "edit" && props.renderDelete(mode.feature)}
    >
      <PatternForm
        key={key}
        copy={copy}
        mode={mode}
        referenceOptions={referenceOptions}
        selectedFace={props.selectedFace}
        sourceAvailable={available}
        {...featureTaskFormProps(props, mode)}
        variables={report.snapshot.variables}
      />
    </TaskPanelSurface>
  )
}
