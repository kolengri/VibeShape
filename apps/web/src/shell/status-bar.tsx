import { useTranslations } from "@vibeshape/i18n"
import type { ViewerSelection } from "@vibeshape/viewer/three-viewport"
import type { DocumentControllerState } from "../document/document-controller"

function useSelectionLabel(controller: DocumentControllerState, selection: ViewerSelection | null) {
  const t = useTranslations("app.shell.statusBar")
  if (!selection) return t("selectionNone")
  const feature = controller.report?.snapshot.features.find(({ id }) => id === selection.featureId)
  return t("selectionFace", {
    face: selection.faceOrdinal,
    feature: feature?.label ?? t("unnamedFeature"),
  })
}

export function StatusBar({
  controller,
  selection,
}: {
  controller: DocumentControllerState
  selection: ViewerSelection | null
}) {
  const t = useTranslations("app.shell.statusBar")
  const selectedEntity = useSelectionLabel(controller, selection)

  return (
    <footer
      className="flex items-center gap-4 border-t bg-toolbar px-2 text-xs text-muted-foreground"
      role="status"
    >
      <span>{t("units", { unit: "mm" })}</span>
      <span>{t("filter", { filter: t("selectionAny") })}</span>
      <span>{t("selection", { selection: selectedEntity })}</span>
      <span className="ml-auto">{t("ready")}</span>
    </footer>
  )
}
