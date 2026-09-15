import { useTranslations } from "@vibeshape/i18n"
import type { ViewerOriginPlane } from "@vibeshape/viewer/origin-planes"
import type { ViewerSelection } from "@vibeshape/viewer/three-viewport"
import { viewerBodyKey } from "@vibeshape/viewer/three-viewport"
import type { DocumentControllerState } from "../document/document-controller"
import { useDocumentDisplayUnits } from "../document/document-display-units"
import { type ModelBodySelection, terminalModelBodies } from "../features/part-design/model-bodies"
import { modelFaceSelectionDisplayOrdinal } from "../features/sketch/external-model-geometry"

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
  if (selectedBody) return selectedBodyLabel(controller, selectedBody, null, t)
  if (!selection) return selectedOriginPlaneLabel(t, selectedOriginPlane)
  return selectedFaceLabel(controller, selection, t)
}

export function StatusBar({
  controller,
  selectedOriginPlane,
  selectedBody = null,
  selection,
}: {
  controller: DocumentControllerState
  selectedOriginPlane: ViewerOriginPlane | null
  selectedBody?: ModelBodySelection | null
  selection: ViewerSelection | null
}) {
  const t = useTranslations("app.shell.statusBar")
  const displayUnits = useDocumentDisplayUnits()
  const selectedEntity = useSelectionLabel(controller, selection, selectedOriginPlane, selectedBody)

  return (
    <footer
      className="flex items-center gap-4 border-t bg-toolbar px-2 text-xs text-muted-foreground"
      role="status"
    >
      <span>{t("units", displayUnits)}</span>
      <span>{t("filter", { filter: t("selectionAny") })}</span>
      <span>{t("selection", { selection: selectedEntity })}</span>
      <span className="ml-auto">{t("ready")}</span>
    </footer>
  )
}
