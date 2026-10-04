import {
  readPatternFeatureParameters,
  readPatternFeatureParametersV2,
} from "@vibeshape/domain/part-design-pattern"
import { useTranslations } from "@vibeshape/i18n"
import { PatternForm, type PatternFormCopy } from "../features/pattern/pattern-form"
import { patternTargetBody } from "../features/pattern/pattern-form-model"
import { referenceFrameOptions } from "../features/reference-geometry/reference-frame-options"
import { type BodyFeatureTaskPanelProps, bodyFeatureTaskMode } from "./body-feature-task-mode"
import { exactTaskSource, featureTaskFormProps } from "./feature-task-form-props"

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
        referenceOptions={referenceFrameOptions(
          report.snapshot,
          report.rebuild,
          mode.kind === "edit" ? mode.feature.id : undefined,
        )}
        selectedFace={props.selectedFace}
        sourceAvailable={available}
        {...featureTaskFormProps(props, mode)}
        variables={report.snapshot.variables}
      />
      {mode.kind === "edit" && props.renderDelete(mode.feature)}
    </aside>
  )
}
