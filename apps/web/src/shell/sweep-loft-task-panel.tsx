import type { FeatureRecord } from "@vibeshape/domain"
import { readLoftFeatureParameters } from "@vibeshape/domain/part-design-loft"
import { readLoftFeatureParametersV3 } from "@vibeshape/domain/part-design-loft-v3"
import { readSweepFeatureParameters } from "@vibeshape/domain/part-design-sweep"
import { useFormatter, useTranslations } from "@vibeshape/i18n"
import type { ReactNode } from "react"
import {
  createBrowserFeatureId,
  type DocumentControllerState,
} from "../document/document-controller"
import type { ActivePartDesignTool } from "../features/part-design/part-design-tool"
import { ineligibleProfileSketchIds } from "../features/part-design/profile-feature-selection"
import type { FeaturePreviewState } from "../features/preview/use-feature-preview"
import { loftSupportCatalogue } from "../features/sweep-loft/loft-support-catalogue"
import { sweepLoftCatalogue } from "../features/sweep-loft/sweep-loft-catalogue"
import { SweepLoftForm, type SweepLoftFormCopy } from "../features/sweep-loft/sweep-loft-form"
import type {
  SweepLoftFormMode,
  SweepLoftOperation,
} from "../features/sweep-loft/sweep-loft-form-model"
import { featureTaskFormProps } from "./feature-task-form-props"

type Props = {
  activeTool: ActivePartDesignTool
  documentBusy: boolean
  report: NonNullable<DocumentControllerState["report"]>
  onCloseTool: () => void
  onCompleteTool: () => void
  onFeaturePreviewChange: (feature: FeatureRecord | null) => void
  featurePreviewStatus: FeaturePreviewState["status"]
  featurePreviewDiagnostic?: string | undefined
  renderDelete: (feature: FeatureRecord) => ReactNode
}
const parameterReaders = {
  loft: (feature: FeatureRecord) =>
    readLoftFeatureParametersV3(feature) ?? readLoftFeatureParameters(feature),
  sweep: readSweepFeatureParameters,
}
function createMode(
  operation: SweepLoftOperation,
  features: readonly FeatureRecord[],
  label: (operation: SweepLoftOperation, number: number) => string,
): SweepLoftFormMode {
  const read = parameterReaders[operation]
  return {
    kind: "create",
    operation,
    createFeatureId: createBrowserFeatureId,
    featureLabel: label(operation, features.filter((feature) => read(feature)).length + 1),
  }
}
function formMode(
  tool: ActivePartDesignTool,
  features: readonly FeatureRecord[],
  label: (operation: "loft" | "sweep", number: number) => string,
): SweepLoftFormMode | null {
  switch (tool.kind) {
    case "create-loft":
      return createMode("loft", features, label)
    case "create-sweep":
      return createMode("sweep", features, label)
    case "edit-loft":
    case "edit-sweep": {
      const operation = tool.kind === "edit-loft" ? "loft" : "sweep"
      const feature = features.find(({ id }) => id === tool.featureId)
      return feature && parameterReaders[operation](feature)
        ? { kind: "edit", operation, feature }
        : null
    }
    default:
      return null
  }
}
const titleKeys = {
  loft: { create: "loftTitle", edit: "editLoftTitle" },
  sweep: { create: "sweepTitle", edit: "editSweepTitle" },
} as const
const descriptionKeys = { loft: "loftDescription", sweep: "sweepDescription" } as const
const submitKeys = { create: "create", edit: "update" } as const
function useFormCopy(mode: SweepLoftFormMode | null): SweepLoftFormCopy {
  const t = useTranslations("app.sweepLoft")
  const operation = mode?.operation ?? "sweep"
  const kind = mode?.kind ?? "create"
  return {
    title: t(titleKeys[operation][kind]),
    submit: t(submitKeys[kind]),
    description: t(descriptionKeys[operation]),
    cancel: t("cancel"),
    parameters: t("parameters"),
    validationSummary: t("validationSummary"),
    previewFailed: t("previewFailed"),
    staleRevision: t("staleRevision"),
    saveFailed: t("saveFailed"),
    sectionProfile: t("sectionProfile"),
    chooseProfile: t("chooseProfile"),
    addSection: t("addSection"),
    section: (number) => t("section", { number }),
    unavailableSection: (number) => t("unavailableSection", { number }),
    removeSection: (profile) => t("removeSection", { profile }),
    moveEarlier: (number) => t("moveEarlier", { number }),
    moveLater: (number) => t("moveLater", { number }),
    ruled: t("ruled"),
    ruledDescription: t("ruledDescription"),
    profile: t("profile"),
    pathSketch: t("pathSketch"),
    choosePath: t("choosePath"),
    pathCurves: t("pathCurves"),
    pathDescription: t("pathDescription"),
    startPoint: t("startPoint"),
    chooseStart: t("chooseStart"),
    unavailablePath: t("unavailablePath"),
    constrained: t("constrained"),
    constraintsDescription: t("constraintsDescription"),
    outerTracks: t("outerTracks"),
    addTrack: t("addTrack"),
    chooseSegment: t("chooseSegment"),
    unavailableSegment: t("unavailableSegment"),
    vertexTrack: t("vertexTrack"),
    segmentTrack: t("segmentTrack"),
    addRail: t("addRail"),
    addGuide: t("addGuide"),
    guideName: t("guideName"),
    guideContinuity: t("guideContinuity"),
    startContinuity: t("startContinuity"),
    endContinuity: t("endContinuity"),
    addEnd: t("addEnd"),
    supportFace: t("supportFace"),
    chooseSupport: t("chooseSupport"),
    unavailableSupport: t("unavailableSupport"),
    continuity: t("continuity"),
    remove: t("remove"),
    track: (number) => t("track", { number }),
    rail: (number) => t("rail", { number }),
    guide: (number) => t("guide", { number }),
    endConstraint: (number) => t("endConstraint", { number }),
    directedSegment: (track, section) => t("directedSegment", { track, section }),
    directionOption: (curve, point) => t("directionOption", { curve, point }),
  }
}
export function SweepLoftTaskPanel(props: Props) {
  const t = useTranslations("app.sweepLoft")
  const task = useTranslations("app.shell.taskPanel")
  const format = useFormatter()
  const { report } = props
  const mode = formMode(props.activeTool, report.snapshot.features, (operation, number) =>
    t(operation === "loft" ? "loftFeatureLabel" : "sweepFeatureLabel", { number }),
  )
  const copy = useFormCopy(mode)
  if (!mode) return null
  const rebuild = report.rebuild
  const displays =
    rebuild.ok &&
    rebuild.response.documentId === report.snapshot.id &&
    rebuild.response.revision === report.snapshot.revision
      ? rebuild.response.sketches
      : []
  const catalogue = sweepLoftCatalogue(
    report.snapshot,
    displays,
    ineligibleProfileSketchIds(report.snapshot, props.activeTool),
    mode.operation,
    {
      profile: (sketch, number) => t("profileOption", { sketch, number }),
      curve: (kind, number) => t("curveOption", { kind: kind.replaceAll("-", "_"), number }),
      point: (number, [x, y, z]) =>
        t("pointOption", {
          number,
          x: format.number(Math.abs(x) < 0.0005 ? 0 : x, { maximumFractionDigits: 3 }),
          y: format.number(Math.abs(y) < 0.0005 ? 0 : y, { maximumFractionDigits: 3 }),
          z: format.number(Math.abs(z) < 0.0005 ? 0 : z, { maximumFractionDigits: 3 }),
        }),
    },
  )
  const key =
    mode.kind === "edit"
      ? `edit:${mode.feature.id}:${report.snapshot.revision}`
      : `${mode.operation}:${report.snapshot.revision}`
  const supports = loftSupportCatalogue(
    report.snapshot,
    report.rebuild,
    mode.kind === "edit" ? mode.feature.id : null,
    (body, role, number, [x, y, z]) =>
      t("supportFaceOption", {
        body,
        role,
        number,
        x: format.number(Math.abs(x) < 0.0005 ? 0 : x, { maximumFractionDigits: 3 }),
        y: format.number(Math.abs(y) < 0.0005 ? 0 : y, { maximumFractionDigits: 3 }),
        z: format.number(Math.abs(z) < 0.0005 ? 0 : z, { maximumFractionDigits: 3 }),
      }),
  )
  return (
    <aside aria-label={task("ariaLabel")} className="min-h-0 overflow-auto border-l bg-panel p-4">
      <SweepLoftForm
        key={key}
        copy={copy}
        mode={mode}
        snapshot={report.snapshot}
        {...catalogue}
        supports={supports}
        previewDiagnostic={props.featurePreviewDiagnostic}
        {...featureTaskFormProps(props, mode)}
        variables={report.snapshot.variables}
      />
      {mode.kind === "edit" && props.renderDelete(mode.feature)}
    </aside>
  )
}
