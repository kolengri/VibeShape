import type { SketchRecord } from "@vibeshape/domain"
import { useTranslations } from "@vibeshape/i18n"
import { Button } from "@vibeshape/ui/components/button"
import { useSketchTextActions } from "./text-context"

export function SketchTextGroups({ draft, disabled }: { draft: SketchRecord; disabled: boolean }) {
  const t = useTranslations("app.sketchText")
  const actions = useSketchTextActions()
  return (
    <section className="grid gap-2" aria-label={t("groups")}>
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-xs font-medium">{t("groups")}</h3>
        <Button
          type="button"
          variant="outline"
          size="xs"
          disabled={disabled || !actions}
          onClick={() => actions?.create()}
        >
          {t("create")}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">{t("groupsDescription")}</p>
      {actions?.error && (
        <p role="alert" className="text-xs text-destructive">
          {actions.error}
        </p>
      )}
      {(draft.textGroups ?? []).map((group) => (
        <div
          key={group.id}
          data-text-group-id={group.id}
          className="grid gap-2 rounded-md border p-2"
        >
          <p className="break-words text-xs">{group.parameters.text}</p>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              size="xs"
              disabled={disabled || !actions}
              aria-label={t("editGroup", { text: group.parameters.text })}
              onClick={() => actions?.edit(group.id)}
            >
              {t("edit")}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="xs"
              disabled={disabled || !actions}
              aria-label={t("detachGroup", { text: group.parameters.text })}
              onClick={() => actions?.detach(group.id)}
            >
              {t("detach")}
            </Button>
          </div>
        </div>
      ))}
    </section>
  )
}
