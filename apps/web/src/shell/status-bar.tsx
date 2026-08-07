import { useTranslations } from "@vibeshape/i18n"

export function StatusBar() {
  const t = useTranslations("app.shell.statusBar")

  return (
    <footer
      className="flex items-center gap-4 border-t bg-toolbar px-2 text-xs text-muted-foreground"
      role="status"
    >
      <span>{t("units", { unit: "mm" })}</span>
      <span>{t("selection", { filter: t("selectionAny") })}</span>
      <span className="ml-auto">{t("ready")}</span>
    </footer>
  )
}
