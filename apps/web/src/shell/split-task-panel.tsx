import {
  readSplitFeatureParameters,
  readSplitFeatureParametersV2,
} from "@vibeshape/domain/part-design-split"
import { useTranslations } from "@vibeshape/i18n"
import { referenceFrameOptions } from "../features/reference-geometry/reference-frame-options"
import { SplitForm, type SplitFormCopy } from "../features/split/split-form"
import { splitTargetBody } from "../features/split/split-form-model"
import { type BodyFeatureTaskPanelProps, bodyFeatureTaskMode } from "./body-feature-task-mode"
import { exactTaskSource, featureTaskFormProps } from "./feature-task-form-props"

function useSplitCopy(editing: boolean): SplitFormCopy {
  const t = useTranslations("app.split")
  return {
    title: t(editing ? "editTitle" : "title"),
    submit: t(editing ? "update" : "create"),
    description: t("description"),
    cancel: t("cancel"),
    parameters: t("parameters"),
    plane: t("plane"),
    offset: t("offset"),
    lengthDescription: t("lengthDescription"),
    planeDescription: t("planeDescription"),
    midpoint: t("midpoint"),
    unavailable: t("unavailable"),
    validationSummary: t("validationSummary"),
    invalidExpression: t("invalidExpression"),
    invalidDimension: t("invalidDimension"),
    invalidRange: t("invalidRange"),
    staleRevision: t("staleRevision"),
    saveFailed: t("saveFailed"),
  }
}
export function SplitTaskPanel(props: BodyFeatureTaskPanelProps) {
  const t = useTranslations("app.split")
  const task = useTranslations("app.shell.taskPanel")
  const { report } = props
  const count = report.snapshot.features.filter((feature) =>
    readSplitFeatureParameters(feature),
  ).length
  const mode = bodyFeatureTaskMode({
    tool: props.activeTool,
    features: report.snapshot.features,
    label: t("featureLabel", { number: count + 1 }),
    createKind: "create-split",
    editKind: "edit-split",
    accepts: (feature) =>
      Boolean(readSplitFeatureParameters(feature) || readSplitFeatureParametersV2(feature)),
  })
  const copy = useSplitCopy(mode?.kind === "edit")
  if (!mode) return null
  const source = exactTaskSource(report, splitTargetBody(mode))
  const bounds = source?.shape.bounds ?? null
  const key =
    mode.kind === "edit"
      ? `edit:${mode.feature.id}:${report.snapshot.revision}`
      : `create:${report.snapshot.revision}`
  return (
    <aside aria-label={task("ariaLabel")} className="min-h-0 overflow-auto border-l bg-panel p-4">
      <SplitForm
        key={key}
        copy={copy}
        mode={mode}
        referenceOptions={referenceFrameOptions(
          report.snapshot,
          report.rebuild,
          mode.kind === "edit" ? mode.feature.id : undefined,
        )}
        selectedFace={props.selectedFace}
        sourceBounds={bounds}
        {...featureTaskFormProps(props, mode)}
        variables={report.snapshot.variables}
      />
      {mode.kind === "edit" && props.renderDelete(mode.feature)}
    </aside>
  )
}
