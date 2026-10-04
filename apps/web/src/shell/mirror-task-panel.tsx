import {
  readMirrorFeatureParameters,
  readMirrorFeatureParametersV3,
} from "@vibeshape/domain/part-design-mirror"
import { useTranslations } from "@vibeshape/i18n"
import { MirrorForm, type MirrorFormCopy } from "../features/mirror/mirror-form"
import { referenceFrameOptions } from "../features/reference-geometry/reference-frame-options"
import { type BodyFeatureTaskPanelProps, bodyFeatureTaskMode } from "./body-feature-task-mode"
import { featureTaskFormProps } from "./feature-task-form-props"

function useMirrorCopy(editing: boolean): MirrorFormCopy {
  const t = useTranslations("app.mirror")
  return {
    title: t(editing ? "editTitle" : "title"),
    submit: t(editing ? "update" : "create"),
    description: t("description"),
    cancel: t("cancel"),
    parameters: t("parameters"),
    plane: t("plane"),
    offset: t("offset"),
    offsetDescription: t("offsetDescription"),
    preserveSource: t("preserveSource"),
    preserveSourceDescription: t("preserveSourceDescription"),
    invalidExpression: t("invalidExpression"),
    invalidDimension: t("invalidDimension"),
    invalidRange: t("invalidRange"),
    validationSummary: t("validationSummary"),
    staleRevision: t("staleRevision"),
    saveFailed: t("saveFailed"),
  }
}
export function MirrorTaskPanel(props: BodyFeatureTaskPanelProps) {
  const t = useTranslations("app.mirror")
  const task = useTranslations("app.shell.taskPanel")
  const { report } = props
  const features = report.snapshot.features
  const count = features.filter(
    (feature) => readMirrorFeatureParameters(feature) || readMirrorFeatureParametersV3(feature),
  ).length
  const mode = bodyFeatureTaskMode({
    tool: props.activeTool,
    features: report.snapshot.features,
    label: t("featureLabel", { number: count + 1 }),
    createKind: "create-mirror",
    editKind: "edit-mirror",
    accepts: (feature) =>
      Boolean(readMirrorFeatureParameters(feature) || readMirrorFeatureParametersV3(feature)),
  })
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
        referenceOptions={referenceFrameOptions(
          report.snapshot,
          report.rebuild,
          mode.kind === "edit" ? mode.feature.id : undefined,
        )}
        selectedFace={props.selectedFace}
        {...featureTaskFormProps(props, mode)}
        variables={report.snapshot.variables}
      />
      {mode.kind === "edit" && props.renderDelete(mode.feature)}
    </aside>
  )
}
