import { useTranslations } from "@vibeshape/i18n"
import { NativeSelect } from "@vibeshape/ui/components/native-select"
import type { ViewerOriginPlane } from "@vibeshape/viewer/origin-planes"
import type { ViewerSelection } from "@vibeshape/viewer/three-viewport"
import { viewerBodyKey } from "@vibeshape/viewer/three-viewport"
import type { DocumentControllerState } from "../document/document-controller"
import { useDocumentDisplayUnits } from "../document/document-display-units"
import { type ModelBodySelection, terminalModelBodies } from "../features/part-design/model-bodies"
import type { ModelEdgeSelection } from "../features/part-design/model-edge-selection"
import { modelFaceSelectionDisplayOrdinal } from "../features/sketch/external-model-geometry"

import { AutomationStatus } from "./automation-status"

const EMPTY_GEOMETRY = [] as const

function rebuiltGeometry(controller: DocumentControllerState) {
  const rebuild = controller.report?.rebuild
  return rebuild?.ok ? rebuild.response.geometry : EMPTY_GEOMETRY
}

function selectionFaceOrdinal(controller: DocumentControllerState, selection: ViewerSelection) {
  return modelFaceSelectionDisplayOrdinal(rebuiltGeometry(controller), selection)
}

function selectedOriginPlaneLabel(
  t: ReturnType<typeof useTranslations<"app.shell.statusBar">>,
  selectedOriginPlane: ViewerOriginPlane | null,
) {
  if (!selectedOriginPlane) return t("selectionNone")
  return t("selectionOriginPlane", { plane: selectedOriginPlane })
}

function selectedBodyView(
  controller: DocumentControllerState,
  selectedBody: ModelBodySelection | ViewerSelection,
) {
  const report = controller.report
  if (!report?.rebuild.ok) return null
  const bodies = terminalModelBodies(report.snapshot.features, report.rebuild.response) ?? []
  const index = bodies.findIndex(
    ({ geometry }) => viewerBodyKey(geometry) === viewerBodyKey(selectedBody),
  )
  const body = bodies[index]
  return body ? { body, ordinal: index + 1 } : null
}

function selectedBodyLabel(
  controller: DocumentControllerState,
  selectedBody: ModelBodySelection | ViewerSelection,
  faceOrdinal: number | null,
  t: ReturnType<typeof useTranslations<"app.shell.statusBar">>,
) {
  const view = selectedBodyView(controller, selectedBody)
  if (!view) return t("selectionNone")
  const values = { feature: view.body.feature.label ?? t("unnamedFeature"), body: view.ordinal }
  return faceOrdinal === null
    ? t("selectionBody", values)
    : t("selectionBodyFace", { ...values, face: faceOrdinal })
}

function selectionFeatureLabel(
  controller: DocumentControllerState,
  featureId: string,
  t: ReturnType<typeof useTranslations<"app.shell.statusBar">>,
) {
  const feature = controller.report?.snapshot.features.find(({ id }) => id === featureId)
  return feature?.label ?? t("unnamedFeature")
}

function selectedFaceLabel(
  controller: DocumentControllerState,
  selection: ViewerSelection,
  t: ReturnType<typeof useTranslations<"app.shell.statusBar">>,
) {
  if (selection.outputRole && selection.outputRole !== "result") {
    return selectedBodyLabel(controller, selection, selection.faceOrdinal, t)
  }
  return t("selectionFace", {
    face: selectionFaceOrdinal(controller, selection),
    feature: selectionFeatureLabel(controller, selection.featureId, t),
  })
}

function useSelectionLabel(
  controller: DocumentControllerState,
  selection: ViewerSelection | null,
  selectedOriginPlane: ViewerOriginPlane | null,
  selectedBody: ModelBodySelection | null,
) {
  const t = useTranslations("app.shell.statusBar")
  if (selection) return selectedFaceLabel(controller, selection, t)
  if (selectedBody) return selectedBodyLabel(controller, selectedBody, null, t)
  return selectedOriginPlaneLabel(t, selectedOriginPlane)
}

export function StatusBar({
  controller,
  selectedOriginPlane,
  selectedBody = null,
  selection,
  selectedModelEdges = null,
  modelEdgeSelectionEnabled = false,
  onModelEdgeSelectionEnabledChange,
}: {
  controller: DocumentControllerState
  selectedOriginPlane: ViewerOriginPlane | null
  selectedBody?: ModelBodySelection | null
  selection: ViewerSelection | null
  selectedModelEdges?: ModelEdgeSelection | null
  modelEdgeSelectionEnabled?: boolean
  onModelEdgeSelectionEnabledChange?: (enabled: boolean) => void
}) {
  const t = useTranslations("app.shell.statusBar")
  const displayUnits = useDocumentDisplayUnits()
  const ordinarySelection = useSelectionLabel(
    controller,
    selection,
    selectedOriginPlane,
    selectedBody,
  )
  const selectedEntity = selectedModelEdges
    ? t("selectionEdgeSet", {
        count: selectedModelEdges.edges.length,
        feature: selectionFeatureLabel(controller, selectedModelEdges.targetBody.featureId, t),
      })
    : ordinarySelection

  return (
    <footer className="flex items-center min-w-0 gap-2 border-t bg-toolbar px-2 text-xs text-muted-foreground">
      <span>{t("units", displayUnits)}</span>
      {onModelEdgeSelectionEnabledChange ? (
        <NativeSelect
          aria-label={t("selectionFilter")}
          className="h-5 w-auto shrink-0 border-0 bg-transparent py-0 text-xs"
          value={modelEdgeSelectionEnabled ? "edges" : "any"}
          onChange={(event) =>
            onModelEdgeSelectionEnabledChange(event.currentTarget.value === "edges")
          }
        >
          <option value="any">{t("selectionAny")}</option>
          <option value="edges">{t("selectionEdges")}</option>
        </NativeSelect>
      ) : (
        <span className="hidden lg:inline">{t("filter", { filter: t("selectionAny") })}</span>
      )}
      <span className="min-w-0 truncate" role="status">
        {t("selection", { selection: selectedEntity })}
      </span>
      <div className="ml-auto flex shrink-0 items-center gap-2">
        <AutomationStatus controller={controller} />
        <span className="hidden xl:inline">{t("ready")}</span>
      </div>
    </footer>
  )
}
