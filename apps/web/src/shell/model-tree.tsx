import { Button } from "@vibeshape/ui/components/button"
import { useTranslations } from "@vibeshape/i18n"

const modelItemKeys = ["origin", "sketches", "features", "bodies"] as const

export function ModelTree() {
  const t = useTranslations("app.shell.modelTree")

  return (
    <aside aria-label={t("ariaLabel")} className="min-h-0 overflow-auto border-r bg-panel p-2">
      <h2 className="px-2 py-1 text-sm font-medium">{t("title")}</h2>
      <div className="mt-1 grid gap-0.5" role="tree" aria-label={t("projectFeatures")}>
        {modelItemKeys.map((itemKey) => (
          <Button
            key={itemKey}
            type="button"
            variant="ghost"
            size="sm"
            className="w-full justify-start font-normal"
            role="treeitem"
          >
            {t(`items.${itemKey}`)}
          </Button>
        ))}
      </div>
    </aside>
  )
}
