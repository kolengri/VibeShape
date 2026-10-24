import type { DocumentRebuildOutcome } from "@vibeshape/application/persistent-document-session"
import type { DocumentSnapshot } from "@vibeshape/domain"
import { useTranslations } from "@vibeshape/i18n"
import { useMemo } from "react"
import { extrusionBodyOptions } from "./extrusion-body-options"

export function useExtrusionBodyOptions(
  snapshot: DocumentSnapshot,
  rebuild: DocumentRebuildOutcome,
  editingId: string | undefined,
  available: boolean,
) {
  const t = useTranslations("app.extrusionExtent")
  const tree = useTranslations("app.shell.modelTree")
  return useMemo(
    () =>
      available
        ? extrusionBodyOptions(
            snapshot,
            rebuild,
            editingId,
            (name, role) => t("bodyLabel", { label: name ?? tree("unnamedFeature"), role }),
            (name) => t("legacyBodyLabel", { label: name ?? tree("unnamedFeature") }),
          )
        : [],
    [snapshot, rebuild, editingId, available, t, tree],
  )
}
