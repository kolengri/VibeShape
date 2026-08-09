import { Button } from "@vibeshape/ui/components/button"
import { useTranslations } from "@vibeshape/i18n"

export function TaskPanel({ workspace }: { workspace: "model" | "variables" }) {
  const t = useTranslations("app.shell.taskPanel")

  if (workspace === "variables") {
    return (
      <aside aria-label={t("ariaLabel")} className="min-h-0 overflow-auto border-l bg-panel p-4">
        <h2 className="text-sm font-medium">{t("variables.title")}</h2>
        <p className="mt-2 leading-5 text-muted-foreground">{t("variables.description")}</p>
        <ul className="mt-4 grid gap-2 border-t pt-4 text-muted-foreground">
          <li>{t("variables.reference")}</li>
          <li>{t("variables.units")}</li>
          <li>{t("variables.names")}</li>
        </ul>
      </aside>
    )
  }

  return (
    <aside aria-label={t("ariaLabel")} className="min-h-0 overflow-auto border-l bg-panel p-4">
      <h2 className="text-sm font-medium">{t("startModeling")}</h2>
      <p className="mt-2 leading-5 text-muted-foreground">{t("description")}</p>
      <Button type="button" className="mt-4 w-full">
        {t("createSketch")}
      </Button>
    </aside>
  )
}
