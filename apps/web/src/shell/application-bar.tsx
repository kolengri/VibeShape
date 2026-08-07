import { Button } from "@vibeshape/ui/components/button"
import { useTranslations } from "@vibeshape/i18n"

export function ApplicationBar() {
  const t = useTranslations("app.shell.applicationBar")

  return (
    <header className="flex min-w-0 items-center gap-3 border-b bg-toolbar px-2">
      <strong className="truncate text-sm">VibeShape</strong>
      <span className="truncate text-muted-foreground">{t("untitledProject")}</span>
      <span className="ml-auto text-xs text-muted-foreground">{t("savedInBrowser")}</span>
      <Button type="button" size="sm" variant="outline">
        {t("export")}
      </Button>
    </header>
  )
}
