import { useTranslations } from "@vibeshape/i18n"
import type { ViewerEdgeCandidate } from "@vibeshape/viewer/three-viewport"
import { useEffect, useMemo } from "react"
import type { DocumentControllerState } from "../document/document-controller"
import type { PartVisibilityOverrides } from "../editor-session/part-visibility"
import {
  type ModelEdgeSelection,
  modelEdgeOptions,
  pickedModelEdge,
  resolveModelEdgeSelection,
} from "./model-edge-selection"

export function useModelEdgePicking(
  controller: DocumentControllerState,
  enabled: boolean,
  hiddenFeatureIds: readonly string[],
  partVisibilityOverrides: PartVisibilityOverrides | undefined,
  selection: ModelEdgeSelection | null | undefined,
  onSelect: ((selection: ModelEdgeSelection | null) => void) | undefined,
) {
  const t = useTranslations("app.shell.viewport")
  const options = useMemo(
    () =>
      enabled
        ? modelEdgeOptions(
            controller,
            hiddenFeatureIds,
            partVisibilityOverrides,
            (feature, ordinal, body) =>
              body === null
                ? t("modelEdgeLabel", { feature: feature || t("unnamedFeature"), ordinal })
                : t("modelBodyEdgeLabel", {
                    feature: feature || t("unnamedFeature"),
                    ordinal,
                    body,
                  }),
          )
        : [],
    [enabled, controller.report, controller.status, hiddenFeatureIds, partVisibilityOverrides, t],
  )
  const resolved = useMemo(
    () => resolveModelEdgeSelection(options, selection),
    [options, selection],
  )
  useEffect(() => {
    const report = controller.report
    if (
      enabled &&
      selection &&
      !resolved &&
      controller.status === "ready" &&
      report?.rebuild.ok &&
      report.rebuild.response.revision === report.snapshot.revision &&
      report.rebuild.response.documentId === report.snapshot.id
    )
      onSelect?.(null)
  }, [enabled, selection, resolved, onSelect, controller.status, controller.report])
  return useMemo(() => {
    if (!enabled || !onSelect) return undefined
    const current = resolved
    return {
      candidates: options.map((option) => ({ ...option.display, selected: option === current })),
      onSelect: (picked: ViewerEdgeCandidate | null) => {
        if (!picked) return onSelect(null)
        const option = pickedModelEdge(options, picked)
        if (option) onSelect(option === current ? null : option.selection)
      },
    }
  }, [enabled, onSelect, options, resolved])
}
