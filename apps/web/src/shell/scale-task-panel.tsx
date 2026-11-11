import { readScaleFeatureParameters } from "@vibeshape/domain/part-design-scale"
import { useTranslations } from "@vibeshape/i18n"
import { TaskPanelSurface } from "../components/task-panel-layout"
import { ScaleForm, type ScaleFormCopy } from "../features/scale/scale-form"
import { type BodyFeatureTaskPanelProps, bodyFeatureTaskMode } from "./body-feature-task-mode"
import { featureTaskFormProps, featureTaskKey } from "./feature-task-form-props"

function useScaleCopy(editing: boolean): ScaleFormCopy {
  const t = useTranslations("app.scale")
  return {
    title: t(editing ? "editTitle" : "title"),
    submit: t(editing ? "update" : "create"),
    description: t("description"),
    cancel: t("cancel"),
    parameters: t("parameters"),
    factor: t("factor"),
    factorDescription: t("factorDescription"),
    center: t("center"),
    centerDescription: t("centerDescription"),
    centerKinds: {
      "bounding-box-center": t("boundingBoxCenter"),
      origin: t("origin"),
      point: t("point"),
    },
    centerX: t("centerX"),
    centerY: t("centerY"),
    centerZ: t("centerZ"),
    coordinateDescription: t("coordinateDescription"),
    validationSummary: t("validationSummary"),
    invalidExpression: t("invalidExpression"),
    invalidDimension: t("invalidDimension"),
    invalidRange: t("invalidRange"),
    invalidFactorDimension: t("invalidFactorDimension"),
    invalidFactorRange: t("invalidFactorRange"),
    staleRevision: t("staleRevision"),
    saveFailed: t("saveFailed"),
    previewFailed: t("previewFailed"),
  }
}

export function ScaleTaskPanel(props: BodyFeatureTaskPanelProps) {
  const t = useTranslations("app.scale")
  const task = useTranslations("app.shell.taskPanel")
  const { report } = props
  const features = report.snapshot.features
  const count = features.filter((feature) => readScaleFeatureParameters(feature)).length
  const mode = bodyFeatureTaskMode({
    tool: props.activeTool,
    features,
    label: t("featureLabel", { number: count + 1 }),
    createKind: "create-scale",
    editKind: "edit-scale",
    accepts: (feature) => readScaleFeatureParameters(feature) !== null,
  })
  const copy = useScaleCopy(mode?.kind === "edit")
  if (!mode) return null
  return (
    <TaskPanelSurface
      aria-label={task("ariaLabel")}
      trailingContent={mode.kind === "edit" && props.renderDelete(mode.feature)}
    >
      <ScaleForm
        key={featureTaskKey(mode, report.snapshot.revision)}
        copy={copy}
        mode={mode}
        {...featureTaskFormProps(props, mode)}
        variables={report.snapshot.variables}
      />
    </TaskPanelSurface>
  )
}
