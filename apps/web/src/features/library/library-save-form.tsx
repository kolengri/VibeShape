import { useTranslations } from "@vibeshape/i18n"
import { Button } from "@vibeshape/ui/components/button"
import { SelectField, SelectOption } from "@vibeshape/ui/components/select-field"
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
    <section className="grid gap-3 rounded-md border p-3" aria-label={t("saveTitle")}>
      <h3 className="text-sm font-semibold">{t("saveTitle")}</h3>
      <p className="text-xs text-muted-foreground">{t("saveExplanation")}</p>
      <form
        aria-label={t("saveTitle")}
        noValidate
        key={state.formKey}
        className="grid gap-3"
        onSubmit={submit}
      >
        <fieldset
          disabled={!writable || action.pending}
          aria-busy={action.pending}
          className="grid gap-3"
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
          <div className="flex flex-wrap gap-3 text-sm">
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="publishMode"
                checked={!publish}
                onChange={() => setPublish(false)}
              />
              {t("newItem")}
            </label>
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="publishMode"
                checked={publish}
                disabled={!browser.selection}
                onChange={() => setPublish(true)}
              />
              {t("newVersion")}
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
