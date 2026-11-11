import type { ResolvedAuthoredPart } from "@vibeshape/application/authored-parts"
import { readCoilFeatureParameters } from "@vibeshape/domain/part-design-coil"
import { useTranslations } from "@vibeshape/i18n"
import { TaskPanelSurface } from "../../components/task-panel-layout"
import { createBrowserFeatureId } from "../../document/document-controller"
import type { BodyFeatureTaskPanelProps } from "../../shell/body-feature-task-mode"
import { featureTaskFormProps, featureTaskKey } from "../../shell/feature-task-form-props"
import { useExactSolidBodyOptions } from "../part-design/exact-body-options"
import { useReferenceFrameOptions } from "../reference-geometry/use-reference-frame-options"
import { CoilForm, type CoilFormCopy } from "./coil-form"
import type { CoilFormMode } from "./coil-form-model"
import { useHelixFieldsCopy } from "./use-helix-fields-copy"

function useCoilCopy(editing: boolean): CoilFormCopy {
  const t = useTranslations("app.coil")
  const helix = useHelixFieldsCopy()
  return {
    ...helix,
    title: t(editing ? "editTitle" : "title"),
    submit: t(editing ? "update" : "create"),
    description: t("description"),
    cancel: t("cancel"),
    parameters: t("parameters"),
    section: t("section"),
    circular: t("circular"),
    rectangular: t("rectangular"),
    diameter: t("diameter"),
    sectionWidth: t("sectionWidth"),
    sectionHeight: t("sectionHeight"),
    sectionDescription: t("sectionDescription"),
    operation: t("operation"),
    operationNew: t("operationNew"),
    operationAdd: t("operationAdd"),
    operationRemove: t("operationRemove"),
    operationIntersect: t("operationIntersect"),
    target: t("target"),
    targetDescription: t("targetDescription"),
    missingTarget: t("missingTarget"),
    validationSummary: t("validationSummary"),
    sectionReachesAxis: t("sectionReachesAxis"),
    turnsOutOfRange: t("turnsOutOfRange"),
    selfIntersection: (minimumPitch) => t("selfIntersection", { minimumPitch }),
    selfIntersectionAnyPitch: t("selfIntersectionAnyPitch"),
    previewFailed: t("previewFailed"),
    staleRevision: t("staleRevision"),
    saveFailed: t("saveFailed"),
  }
}

export function CoilTaskPanel(
  props: BodyFeatureTaskPanelProps & {
    parts: readonly ResolvedAuthoredPart[]
    featurePreviewDiagnostic?: string | undefined
  },
) {
  const { report, activeTool } = props
  const t = useTranslations("app.coil")
  const task = useTranslations("app.shell.taskPanel")
  const tree = useTranslations("app.shell.modelTree")
  const editing =
    activeTool.kind === "edit-coil"
      ? report.snapshot.features.find(({ id }) => id === activeTool.featureId)
      : undefined
  const targets = useExactSolidBodyOptions(
    report.snapshot,
    report.rebuild,
    editing?.id,
    props.parts,
    tree("unnamedFeature"),
  )
  const axisOptions = useReferenceFrameOptions(report.snapshot, report.rebuild, editing?.id)
  const copy = useCoilCopy(editing !== undefined)
  let mode: CoilFormMode | null = null
  if (activeTool.kind === "create-coil")
    mode = {
      kind: "create",
      createFeatureId: createBrowserFeatureId,
      featureLabel: t("featureLabel", {
        number:
          report.snapshot.features.filter((feature) => readCoilFeatureParameters(feature)).length +
          1,
      }),
    }
  else if (editing && readCoilFeatureParameters(editing)) mode = { kind: "edit", feature: editing }
  if (!mode) return null
  return (
    <TaskPanelSurface
      aria-label={task("ariaLabel")}
      trailingContent={editing && props.renderDelete(editing)}
    >
      <CoilForm
        key={featureTaskKey(mode, report.snapshot.revision)}
        mode={mode}
        copy={copy}
        targets={targets}
        axisOptions={axisOptions}
        previewDiagnostic={props.featurePreviewDiagnostic}
        variables={report.snapshot.variables}
        {...featureTaskFormProps(props, mode)}
      />
    </TaskPanelSurface>
  )
}
