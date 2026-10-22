import { useTranslations } from "@vibeshape/i18n"
import { Button } from "@vibeshape/ui/components/button"
import { fieldVariants } from "@vibeshape/ui/components/field"
import { FieldHelp } from "@vibeshape/ui/components/field-help"
import { SelectField, SelectOption } from "@vibeshape/ui/components/select-field"
import { cn } from "@vibeshape/ui/lib/cn"
import { LibraryMetadataFields } from "./library-fields"
import type { LibrarySource } from "./library-model"
import type { LibraryAction } from "./use-library-action"
import type { LibraryBrowser } from "./use-library-browser"
import { useLibrarySave } from "./use-library-save"

export function LibrarySaveForm({
  sources,
  browser,
  action,
  writable,
}: {
  sources: readonly LibrarySource[]
  browser: LibraryBrowser
  action: LibraryAction
  writable: boolean
}) {
  const t = useTranslations("app.library")
  const { state, sourceKey, setSourceKey, publish, setPublish, submit } = useLibrarySave(
    sources,
    browser,
    action,
    writable,
  )
  const { target } = state
  return (
    <section className="grid gap-2 rounded-md border p-3" aria-label={t("saveTitle")}>
      <div className="flex items-center gap-1">
        <h3 className="text-sm font-semibold">{t("saveTitle")}</h3>
        <FieldHelp label={t("saveTitle")}>{t("saveExplanation")}</FieldHelp>
      </div>
      <form
        aria-label={t("saveTitle")}
        noValidate
        key={state.formKey}
        className="grid gap-2"
        onSubmit={submit}
      >
        <fieldset
          disabled={!writable || action.pending}
          aria-busy={action.pending}
          className="grid gap-2"
        >
          <legend className="sr-only">{t("saveTitle")}</legend>
          <SelectField label={t("source")} value={sourceKey} onValueChange={setSourceKey} required>
            {sources.map((entry) => (
              <SelectOption key={entry.key} value={entry.key}>
                {t(entry.kind === "part" ? "partSource" : "definitionSource", { name: entry.name })}
              </SelectOption>
            ))}
          </SelectField>
          {!sources.length && <p className="text-xs text-muted-foreground">{t("noSources")}</p>}
          <div className="grid gap-2">
            <label className={cn(fieldVariants({ orientation: "horizontal" }), "min-h-8 text-sm")}>
              <span>{t("newItem")}</span>
              <input
                type="radio"
                name="publishMode"
                checked={!publish}
                onChange={() => setPublish(false)}
              />
            </label>
            <label className={cn(fieldVariants({ orientation: "horizontal" }), "min-h-8 text-sm")}>
              <span>{t("newVersion")}</span>
              <input
                type="radio"
                name="publishMode"
                checked={publish}
                disabled={!browser.selection}
                onChange={() => setPublish(true)}
              />
            </label>
          </div>
          {target && (
            <p className="text-xs">
              {t("publishTarget", { name: target.name, version: target.headVersion + 1 })}
            </p>
          )}
          <LibraryMetadataFields name={state.name} tags={state.tags} />
          <Button type="submit" disabled={state.disabled} isLoading={action.pending}>
            {t(publish ? "publishVersion" : "saveItem")}
          </Button>
        </fieldset>
      </form>
    </section>
  )
}
