import { Button } from "@vibeshape/ui/components/button"
import { useTranslations } from "@vibeshape/i18n"

export function TaskPanel() {
  const t = useTranslations("app.shell.taskPanel")

  return (
    <aside aria-label={t("ariaLabel")} className="min-h-0 overflow-auto border-l bg-panel p-4">
      <h2 className="text-sm font-medium">{t("startModeling")}</h2>
      <p className="mt-2 leading-5 text-muted-foreground">{t("description")}</p>
      <Button type="button" className="mt-4 w-full">
        {t("createSketch")}
      </Button>
      <div className="mt-6 border-t pt-4">
        <h3 className="text-sm font-medium">{t("foundationStatus")}</h3>
        <ul className="mt-2 grid gap-2 text-muted-foreground">
          <li>{t("workspacesConfigured")}</li>
          <li>{t("sharedUiTokensActive")}</li>
          <li>{t("geometryEngineNotLoaded")}</li>
        </ul>
      </div>
    </aside>
  )
}
