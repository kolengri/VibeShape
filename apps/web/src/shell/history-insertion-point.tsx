import { useTranslations } from "@vibeshape/i18n"
import { Button } from "@vibeshape/ui/components/button"
import type { DocumentControllerState } from "../document/document-controller"

export function HistoryInsertionPoint({
  controller,
  onReturnToEnd,
}: {
  controller: DocumentControllerState
  onReturnToEnd?: (() => Promise<boolean>) | undefined
}) {
  const t = useTranslations("app.historyInsertion")
  const cursor = controller.historyInsertion
  const snapshot = controller.report?.snapshot
  if (!cursor || !snapshot) return null
  const after = cursor.historyAfter
  const record =
    after?.kind === "feature"
      ? snapshot.features.find(({ id }) => id === after.id)
      : snapshot.sketches.find(({ id }) => id === after?.id)
  return (
    <div className="grid gap-1 border-b border-primary bg-accent px-3 py-2">
      <p role="status" className="text-xs">
        {after ? t("after", { item: record?.label ?? t("unnamed") }) : t("start")}
      </p>
      <p className="text-xs text-muted-foreground">{t("description")}</p>
      {onReturnToEnd && (
        <Button size="xs" variant="ghost" onClick={onReturnToEnd}>
          {t("returnToEnd")}
        </Button>
      )}
    </div>
  )
}
