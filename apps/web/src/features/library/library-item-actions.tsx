import { authoredItemNameSchema } from "@vibeshape/domain/parts"
import { useTranslations } from "@vibeshape/i18n"
import { SelectOption } from "@vibeshape/ui/components/select-field"
import { Form, useAppForm } from "@vibeshape/ui/integrations/tanstack-form"
import {
  insertLocalLibraryVersion,
  updateLocalLibraryMetadata,
} from "../../document/library-controller"
import { LibraryMetadataFields, libraryMetadataValidation } from "./library-fields"
import { type LibrarySelection, parseLibraryMetadata } from "./library-model"
import type { LibraryAction } from "./use-library-action"
import type { LibraryBrowser } from "./use-library-browser"
import { useLibrarySubmissionGuard } from "./use-library-save"

export function LibraryMetadataForm({
  selection,
  browser,
  action,
  writable,
}: {
  selection: LibrarySelection
  browser: LibraryBrowser
  action: LibraryAction
  writable: boolean
}) {
  const t = useTranslations("app.library")
  const canSubmit = useLibrarySubmissionGuard(action, writable)
  const form = useAppForm({
    defaultValues: { name: selection.item.name, tags: selection.item.tags.join(", ") },
    validators: {
      onChange: ({ value, formApi }) =>
        formApi.state.submissionAttempts > 0
          ? libraryMetadataValidation(value, t("invalidMetadata"))
          : undefined,
      onSubmit: ({ value }) => libraryMetadataValidation(value, t("invalidMetadata")),
    },
    onSubmit: async ({ value }) => {
      if (!canSubmit()) return
      const metadata = parseLibraryMetadata(value.name, value.tags)
      if (!metadata.success) return
      await action.run(
        () =>
          updateLocalLibraryMetadata({
            itemId: selection.item.id,
            expectedMetadataRevision: selection.item.metadataRevision,
            ...metadata.data,
          }),
        (item) => {
          if (!item) return
          browser.setSelection({ ...selection, item })
          browser.reload()
          action.setNotice(t("metadataSaved"))
        },
      )
    },
  })
  return (
    <Form form={form} aria-label={t("metadataTitle")} className="grid gap-3 rounded-md border p-3">
      <form.Subscribe selector={(state) => state.isSubmitting}>
        {(submitting) => (
          <fieldset
            disabled={!writable || action.pending || submitting}
            aria-busy={action.pending || submitting}
            className="grid gap-3"
          >
            <legend className="mb-3 text-sm font-semibold">{t("metadataTitle")}</legend>
            <LibraryMetadataFields form={form} fields={{ name: "name", tags: "tags" }} />
            <form.FormError />
            <form.SubmitButton variant="outline" requireDirty={false}>
              {t("saveMetadata")}
            </form.SubmitButton>
          </fieldset>
        )}
      </form.Subscribe>
    </Form>
  )
}

function insertionValidation(
  values: { definitionName: string; instanceName: string },
  message: string,
) {
  const fields: Partial<Record<"definitionName" | "instanceName", string>> = {}
  for (const field of ["definitionName", "instanceName"] as const) {
    if (!authoredItemNameSchema.safeParse(values[field]).success) fields[field] = message
  }
  return Object.keys(fields).length ? { fields } : undefined
}

export function LibraryInsertForm({
  selection,
  action,
  writable,
}: {
  selection: LibrarySelection
  action: LibraryAction
  writable: boolean
}) {
  const t = useTranslations("app.library")
  const canSubmit = useLibrarySubmissionGuard(action, writable)
  const form = useAppForm({
    defaultValues: {
      mode: "copy" as "copy" | "reference",
      definitionName: selection.item.name,
      instanceName: t("defaultInstance", { name: selection.item.name }),
    },
    validators: {
      onChange: ({ value, formApi }) =>
        formApi.state.submissionAttempts > 0
          ? insertionValidation(value, t("invalidNames"))
          : undefined,
      onSubmit: ({ value }) => insertionValidation(value, t("invalidNames")),
    },
    onSubmit: async ({ value }) => {
      if (!canSubmit()) return
      const definitionName = authoredItemNameSchema.safeParse(value.definitionName)
      const instanceName = authoredItemNameSchema.safeParse(value.instanceName)
      if (!definitionName.success || !instanceName.success) return
      await action.run(
        () =>
          insertLocalLibraryVersion({
            itemId: selection.item.id,
            version: selection.version.version,
            mode: value.mode,
            definitionName: definitionName.data,
            instanceName: instanceName.data,
          }),
        () => action.setNotice(t("inserted")),
        false,
      )
    },
  })
  return (
    <Form form={form} aria-label={t("insertTitle")} className="grid gap-3 rounded-md border p-3">
      <form.Subscribe selector={(state) => [state.values.mode, state.isSubmitting] as const}>
        {([mode, submitting]) => (
          <fieldset
            disabled={!writable || action.pending || submitting}
            aria-busy={action.pending || submitting}
            className="grid gap-3"
          >
            <legend className="mb-3 text-sm font-semibold">{t("insertTitle")}</legend>
            <form.AppField name="mode">
              {(field) => (
                <field.SelectField label={t("insertMode")}>
                  <SelectOption value="copy">{t("copy")}</SelectOption>
                  <SelectOption value="reference">{t("reference")}</SelectOption>
                </field.SelectField>
              )}
            </form.AppField>
            <p className="text-xs text-muted-foreground">
              {t(mode === "copy" ? "copyExplanation" : "referenceExplanation")}
            </p>
            <form.AppField name="definitionName">
              {(field) => <field.TextField label={t("definitionName")} required maxLength={128} />}
            </form.AppField>
            <form.AppField name="instanceName">
              {(field) => <field.TextField label={t("instanceName")} required maxLength={128} />}
            </form.AppField>
            <form.FormError />
            <form.SubmitButton requireDirty={false}>
              {t(mode === "copy" ? "insertCopy" : "insertReference")}
            </form.SubmitButton>
          </fieldset>
        )}
      </form.Subscribe>
    </Form>
  )
}
