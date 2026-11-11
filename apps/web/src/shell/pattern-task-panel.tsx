import type { FeatureRecord } from "@vibeshape/domain"
import {
  readPatternFeatureParameters,
  readPatternFeatureParametersV2,
} from "@vibeshape/domain/part-design-pattern"
import { readPatternFeatureParametersV3 } from "@vibeshape/domain/part-design-pattern-path"
import { useFormatter, useTranslations } from "@vibeshape/i18n"
import { useMemo } from "react"
import { TaskPanelSurface } from "../components/task-panel-layout"
import { PatternForm, type PatternFormCopy } from "../features/pattern/pattern-form"
import { patternTargetBody } from "../features/pattern/pattern-form-model"
import type {
  PatternPathPickingContext,
  PatternPathPickingRequest,
} from "../features/pattern/use-pattern-path-picking"
import { useReferenceFrameOptions } from "../features/reference-geometry/use-reference-frame-options"
import { sweepLoftCatalogue } from "../features/sweep-loft/sweep-loft-catalogue"
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
    path: t("path"),
    pathSketch: t("pathSketch"),
    choosePath: t("choosePath"),
    pathCurves: t("pathCurves"),
    pathDescription: t("pathDescription"),
    startPoint: t("startPoint"),
    chooseStart: t("chooseStart"),
    unavailablePath: t("unavailablePath"),
    spacingMode: t("spacingMode"),
    spacingEqual: t("spacingEqual"),
    spacingFixed: t("spacingFixed"),
    pathSpacing: t("pathSpacing"),
    pathSpacingDescription: t("pathSpacingDescription"),
    startOffset: t("startOffset"),
    startOffsetDescription: t("startOffsetDescription"),
    orientation: t("orientation"),
    translate: t("translate"),
    follow: t("follow"),
    reverse: t("reverse"),
    reverseDescription: t("reverseDescription"),
    invalidPath: t("invalidPath"),
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
const isPatternFeature = (feature: FeatureRecord) =>
  Boolean(
    readPatternFeatureParameters(feature) ||
      readPatternFeatureParametersV2(feature) ||
      readPatternFeatureParametersV3(feature),
  )
function usePatternPaths(report: BodyFeatureTaskPanelProps["report"]) {
  const t = useTranslations("app.bodyPattern")
  const format = useFormatter()
  const rebuild = report.rebuild
  return useMemo(() => {
    const displays =
      rebuild.ok &&
      rebuild.response.documentId === report.snapshot.id &&
      rebuild.response.revision === report.snapshot.revision
        ? rebuild.response.sketches
        : []
    const coordinate = (value: number) =>
      format.number(Math.abs(value) < 0.0005 ? 0 : value, { maximumFractionDigits: 3 })
    return sweepLoftCatalogue(
      report.snapshot,
      displays,
      [],
      "sweep",
      {
        profile: () => "",
        curve: (kind, number) => t("curveOption", { kind: kind.replaceAll("-", "_"), number }),
        point: (number, [x, y, z]) =>
          t("pointOption", { number, x: coordinate(x), y: coordinate(y), z: coordinate(z) }),
      },
      true,
    ).paths
  }, [report.snapshot, rebuild, t, format])
}
export function PatternTaskPanel(
  props: BodyFeatureTaskPanelProps & {
    patternPathPickRequest?: PatternPathPickingRequest | null | undefined
    onPatternPathPickingContextChange?:
      | ((context: PatternPathPickingContext | null) => void)
      | undefined
  },
) {
  const t = useTranslations("app.bodyPattern"),
    task = useTranslations("app.shell.taskPanel")
  const { report } = props
  const count = report.snapshot.features.filter(isPatternFeature).length
  const mode = bodyFeatureTaskMode({
    tool: props.activeTool,
    features: report.snapshot.features,
    label: t("featureLabel", { number: count + 1 }),
    createKind: "create-pattern",
    editKind: "edit-pattern",
    accepts: isPatternFeature,
  })
  const copy = usePatternCopy(mode?.kind === "edit")
  const paths = usePatternPaths(report)
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
        snapshot={report.snapshot}
        paths={paths}
        pickingRequest={props.patternPathPickRequest}
        onPickingContextChange={props.onPatternPathPickingContextChange}
        {...featureTaskFormProps(props, mode)}
        variables={report.snapshot.variables}
      />
    </TaskPanelSurface>
  )
}
