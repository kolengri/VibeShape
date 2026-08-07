import { useTranslations } from "@vibeshape/i18n"

export function ViewportPlaceholder() {
  const t = useTranslations("app.shell.viewport")

  return (
    <section
      aria-label={t("ariaLabel")}
      className="relative grid min-h-0 place-items-center overflow-hidden bg-viewport-background"
    >
      <div className="max-w-sm px-6 text-center">
        <p className="text-sm font-medium">{t("title")}</p>
        <p className="mt-2 text-muted-foreground">{t("description")}</p>
      </div>
      <div className="absolute bottom-3 left-3 rounded-sm border bg-background/90 px-2 py-1 font-mono text-xs text-muted-foreground">
        {t("orientation", { plane: "XY" })}
      </div>
    </section>
  )
}
