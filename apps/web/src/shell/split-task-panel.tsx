import { resolveReferencePlane } from "@vibeshape/application/reference-frame"
import {
  readSplitFeatureParameters,
  readSplitFeatureParametersV2,
} from "@vibeshape/domain/part-design-split"
import type { ReferencePlane } from "@vibeshape/domain/reference-frame"
import { useTranslations } from "@vibeshape/i18n"
import { useCallback, useMemo } from "react"
import { referenceFrameOptions } from "../features/reference-geometry/reference-frame-options"
import { SplitForm, type SplitFormCopy } from "../features/split/split-form"
import { splitTargetBody } from "../features/split/split-form-model"
import type { SplitManipulator } from "../features/split/split-manipulator"
import { type BodyFeatureTaskPanelProps, bodyFeatureTaskMode } from "./body-feature-task-mode"
import { exactTaskSource, featureTaskFormProps } from "./feature-task-form-props"

function useSplitCopy(editing: boolean): SplitFormCopy {
  const t = useTranslations("app.split")
  return useMemo(
    () => ({
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
    }),
    [editing, t],
  )
}
export function SplitTaskPanel(
  props: BodyFeatureTaskPanelProps & {
    onSplitManipulatorChange?: ((value: SplitManipulator | null) => void) | undefined
  },
) {
  const t = useTranslations("app.split")
  const task = useTranslations("app.shell.taskPanel")
  const { report } = props
  const count = report.snapshot.features.filter(
    (feature) => readSplitFeatureParameters(feature) || readSplitFeatureParametersV2(feature),
  ).length
  const label = t("featureLabel", { number: count + 1 })
  const mode = useMemo(
    () =>
      bodyFeatureTaskMode({
        tool: props.activeTool,
        features: report.snapshot.features,
        label,
        createKind: "create-split",
        editKind: "edit-split",
        accepts: (feature) =>
          Boolean(readSplitFeatureParameters(feature) || readSplitFeatureParametersV2(feature)),
      }),
    [props.activeTool, report.snapshot.features, label],
  )
  const copy = useSplitCopy(mode?.kind === "edit")
  const bounds = useMemo(
    () => (mode ? (exactTaskSource(report, splitTargetBody(mode))?.shape.bounds ?? null) : null),
    [report, mode],
  )
  const resolvePlane = useCallback(
    (support: ReferencePlane) =>
      report.rebuild.ok
        ? resolveReferencePlane(support, {
            document: report.snapshot,
            features: report.snapshot.features,
            geometry: report.snapshot.features.flatMap((feature) => {
              if (!report.rebuild.ok) return []
              const record = report.rebuild.response.geometry.find(
                ({ featureId }) => featureId === feature.id,
              )
              return record ? [{ ...record, featureId: feature.id }] : []
            }),
          })
        : null,
    [report],
  )
  if (!mode) return null
  const key =
    mode.kind === "edit"
      ? `edit:${mode.feature.id}:${report.snapshot.revision}`
      : `create:${mode.targetBody.featureId}:${mode.targetBody.outputRole}:${report.snapshot.revision}`
  return (
    <aside
      aria-label={task("ariaLabel")}
      className="flex min-h-0 min-w-0 flex-col overflow-hidden border-l bg-panel"
    >
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
        resolvePlane={resolvePlane}
        onManipulatorChange={props.onSplitManipulatorChange}
        {...featureTaskFormProps(props, mode)}
        variables={report.snapshot.variables}
      />
      {mode.kind === "edit" && props.renderDelete(mode.feature)}
    </aside>
  )
}
