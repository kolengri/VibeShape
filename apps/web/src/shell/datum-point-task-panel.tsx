import { resolveDatumPoint } from "@vibeshape/application/reference-frame"
import { readDatumPointFeatureParameters } from "@vibeshape/domain"
import { useTranslations } from "@vibeshape/i18n"
import { useMemo } from "react"
import { TaskPanelSurface } from "../components/task-panel-layout"
import { createBrowserFeatureId } from "../document/document-controller"
import { isDatumPointFeature } from "../features/part-design/part-design-tool"
import {
  DatumPointForm,
  type DatumPointFormCopy,
  type DatumPointFormMode,
  type DatumPointSavedReferenceStatus,
} from "../features/reference-geometry/datum-point-form"
import { datumPointOptions } from "../features/reference-geometry/datum-point-options"
import type { BodyFeatureTaskPanelProps } from "./body-feature-task-mode"
import { featureTaskFormProps, featureTaskKey } from "./feature-task-form-props"

type DatumPointTaskPanelProps = Omit<BodyFeatureTaskPanelProps, "renderDelete" | "selectedFace">
type Report = DatumPointTaskPanelProps["report"]

function useDatumPointCopy(editing: boolean): DatumPointFormCopy {
  const t = useTranslations("app.shell.taskPanel.datumPoint")
  return {
    title: t(editing ? "editTitle" : "title"),
    description: t(editing ? "editDescription" : "description"),
    submit: t(editing ? "update" : "create"),
    validationSummary: t(editing ? "updateValidationSummary" : "validationSummary"),
    saveFailed: t(editing ? "updateFailed" : "createFailed"),
    staleRevision: t("staleRevision"),
    cancel: t("cancel"),
    parameters: t("parameters"),
    mode: t("mode"),
    modeDescription: t("modeDescription"),
    modeCoordinates: t("modeCoordinates"),
    modeVertex: t("modeVertex"),
    modeCircleCenter: t("modeCircleCenter"),
    x: t("x"),
    y: t("y"),
    z: t("z"),
    coordinateDescription: t("coordinateDescription"),
    vertex: t("vertex"),
    vertexDescription: t("vertexDescription"),
    circle: t("circle"),
    circleDescription: t("circleDescription"),
    savedReference: t("savedReference"),
    unavailableReference: t("unavailableReference"),
    chooseReference: t("chooseReference"),
    noCandidates: t("noCandidates"),
    invalidExpression: t("invalidExpression"),
    invalidDimension: t("invalidDimension"),
    invalidRange: t("invalidRange"),
  }
}

function datumPointMode(
  props: DatumPointTaskPanelProps,
  featureLabel: string,
): DatumPointFormMode | null {
  const tool = props.activeTool
  if (tool.kind === "create-datum-point")
    return { kind: "create", createFeatureId: createBrowserFeatureId, featureLabel }
  if (tool.kind !== "edit-datum-point") return null
  const feature = props.report.snapshot.features.find(({ id }) => id === tool.featureId)
  return feature && isDatumPointFeature(feature) ? { kind: "edit", feature } : null
}

/** Resolves the saved reference exactly as the rebuild does, so repair needs are explicit. */
function savedReferenceStatus(
  mode: DatumPointFormMode,
  report: Report,
): DatumPointSavedReferenceStatus | null {
  const parameters = mode.kind === "edit" ? readDatumPointFeatureParameters(mode.feature) : null
  if (!parameters || parameters.mode === "coordinates") return null
  if (!report.rebuild.ok) return "missing"
  const rebuilt = report.rebuild.response.geometry
  const resolved = resolveDatumPoint(parameters, {
    document: report.snapshot,
    features: report.snapshot.features,
    geometry: report.snapshot.features.flatMap((feature) => {
      const record = rebuilt.find(({ featureId }) => featureId === feature.id)
      return record ? [{ ...record, featureId: feature.id }] : []
    }),
  })
  return resolved.ok ? "resolved" : resolved.reason
}

export function DatumPointTaskPanel(props: DatumPointTaskPanelProps) {
  const { report } = props
  const t = useTranslations("app.shell.taskPanel.datumPoint")
  const task = useTranslations("app.shell.taskPanel")
  const count = report.snapshot.features.filter(isDatumPointFeature).length
  const mode = datumPointMode(props, t("featureLabel", { number: count + 1 }))
  const copy = useDatumPointCopy(mode?.kind === "edit")
  const excluded = mode?.kind === "edit" ? mode.feature.id : undefined
  const options = useMemo(
    () => datumPointOptions(report.snapshot, report.rebuild, excluded),
    [report.snapshot, report.rebuild, excluded],
  )
  if (!mode) return null
  return (
    <TaskPanelSurface aria-label={task("ariaLabel")}>
      <DatumPointForm
        key={featureTaskKey(mode, report.snapshot.revision)}
        copy={copy}
        mode={mode}
        options={options}
        savedStatus={savedReferenceStatus(mode, report)}
        {...featureTaskFormProps(props, mode)}
        variables={report.snapshot.variables}
      />
    </TaskPanelSurface>
  )
}
