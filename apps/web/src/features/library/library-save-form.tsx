import { useTranslations } from "@vibeshape/i18n"
import { FieldHelp } from "@vibeshape/ui/components/field-help"
import { SelectOption } from "@vibeshape/ui/components/select-field"
import { Form } from "@vibeshape/ui/integrations/tanstack-form"
import { LibraryMetadataFields } from "./library-fields"
import { type LibrarySource, librarySaveState } from "./library-model"
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
  const form = useLibrarySave(sources, browser, action, writable)
  return (
    <section className="grid gap-2 rounded-md border p-3" aria-label={t("saveTitle")}>
      <div className="flex items-center gap-1">
        <h3 className="text-sm font-semibold">{t("saveTitle")}</h3>
        <FieldHelp label={t("saveTitle")}>{t("saveExplanation")}</FieldHelp>
      </div>
      <Form form={form} aria-label={t("saveTitle")} className="grid gap-2">
        <form.Subscribe
          selector={(state) =>
            [state.values.sourceKey, state.values.publishMode, state.isSubmitting] as const
          }
        >
          {([sourceKey, publishMode, submitting]) => {
            const state = librarySaveState(
              sources,
              sourceKey,
              publishMode === "publish",
              browser.selection,
            )
            const pending = action.pending || submitting
            return (
              <fieldset disabled={!writable || pending} aria-busy={pending} className="grid gap-2">
                <legend className="sr-only">{t("saveTitle")}</legend>
                <form.AppField name="sourceKey">
                  {(field) => (
                    <field.SelectField label={t("source")} required>
                      {sources.map((entry) => (
                        <SelectOption key={entry.key} value={entry.key}>
                          {t(entry.kind === "part" ? "partSource" : "definitionSource", {
                            name: entry.name,
                          })}
                        </SelectOption>
                      ))}
                    </field.SelectField>
                  )}
                </form.AppField>
                {!sources.length && (
                  <p className="text-xs text-muted-foreground">{t("noSources")}</p>
                )}
                <form.AppField name="publishMode">
                  {(field) => (
                    <field.ChoiceField
                      label={t("saveTitle")}
                      options={[
                        { value: "new", label: t("newItem") },
                        { value: "publish", label: t("newVersion"), disabled: !browser.selection },
                      ]}
                    />
                  )}
                </form.AppField>
                {state.target && (
                  <p className="text-xs">
                    {t("publishTarget", {
                      name: state.target.name,
                      version: state.target.headVersion + 1,
                    })}
                  </p>
                )}
                <LibraryMetadataFields form={form} fields={{ name: "name", tags: "tags" }} />
                <form.FormError />
                <form.SubmitButton disabled={state.disabled} requireDirty={false}>
                  {t(publishMode === "publish" ? "publishVersion" : "saveItem")}
                </form.SubmitButton>
              </fieldset>
            )
          }}
        </form.Subscribe>
      </Form>
    </section>
  )
}
