import { authoredItemNameSchema } from "@vibeshape/domain/parts"
import { useTranslations } from "@vibeshape/i18n"
import { Button } from "@vibeshape/ui/components/button"
import { SelectField, SelectOption } from "@vibeshape/ui/components/select-field"
import { TextField } from "@vibeshape/ui/components/text-field"
import { useState } from "react"
import {
  insertLocalLibraryVersion,
  updateLocalLibraryMetadata,
} from "../../document/library-controller"
import { LibraryMetadataFields } from "./library-fields"
import { type LibrarySelection, parseLibraryMetadata } from "./library-model"
import type { LibraryAction } from "./use-library-action"
import type { LibraryBrowser } from "./use-library-browser"

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
  return (
    <form
      aria-label={t("metadataTitle")}
      className="grid gap-3 rounded-md border p-3"
      noValidate
      onSubmit={(event) => {
        event.preventDefault()
        if (!writable || action.pending) return
        const data = new FormData(event.currentTarget)
        const metadata = parseLibraryMetadata(
          String(data.get("name") ?? ""),
          String(data.get("tags") ?? ""),
        )
        if (!metadata.success) return action.setError(t("invalidMetadata"))
        void action.run(
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
      }}
    >
      <fieldset
        disabled={!writable || action.pending}
        aria-busy={action.pending}
        className="grid gap-3"
      >
        <legend className="mb-3 text-sm font-semibold">{t("metadataTitle")}</legend>
        <LibraryMetadataFields name={selection.item.name} tags={selection.item.tags} />
        <Button type="submit" variant="outline" isLoading={action.pending}>
          {t("saveMetadata")}
        </Button>
      </fieldset>
    </form>
  )
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
  const [mode, setMode] = useState<"copy" | "reference">("copy")
  return (
    <form
      aria-label={t("insertTitle")}
      className="grid gap-3 rounded-md border p-3"
      noValidate
      onSubmit={(event) => {
        event.preventDefault()
        if (!writable || action.pending) return
        const data = new FormData(event.currentTarget)
        const definitionName = authoredItemNameSchema.safeParse(
          String(data.get("definitionName") ?? ""),
        )
        const instanceName = authoredItemNameSchema.safeParse(
          String(data.get("instanceName") ?? ""),
        )
        if (!definitionName.success || !instanceName.success)
          return action.setError(t("invalidNames"))
        void action.run(
          () =>
            insertLocalLibraryVersion({
              itemId: selection.item.id,
              version: selection.version.version,
              mode,
              definitionName: definitionName.data,
              instanceName: instanceName.data,
            }),
          () => action.setNotice(t("inserted")),
          false,
        )
      }}
    >
      <fieldset
        disabled={!writable || action.pending}
        aria-busy={action.pending}
        className="grid gap-3"
      >
        <legend className="mb-3 text-sm font-semibold">{t("insertTitle")}</legend>
        <SelectField
          label={t("insertMode")}
          value={mode}
          onValueChange={(value) => {
            if (value === "copy" || value === "reference") setMode(value)
          }}
        >
          <SelectOption value="copy">{t("copy")}</SelectOption>
          <SelectOption value="reference">{t("reference")}</SelectOption>
        </SelectField>
        <p className="text-xs text-muted-foreground">
          {t(mode === "copy" ? "copyExplanation" : "referenceExplanation")}
        </p>
        <TextField
          name="definitionName"
          label={t("definitionName")}
          defaultValue={selection.item.name}
          required
          maxLength={128}
        />
        <TextField
          name="instanceName"
          label={t("instanceName")}
          defaultValue={t("defaultInstance", { name: selection.item.name })}
          required
          maxLength={128}
        />
        <Button type="submit" isLoading={action.pending}>
          {t(mode === "copy" ? "insertCopy" : "insertReference")}
        </Button>
      </fieldset>
    </form>
  )
}
