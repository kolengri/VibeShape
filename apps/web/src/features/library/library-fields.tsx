import type { AssemblyLibraryItem } from "@vibeshape/domain/assembly-library"
import { useTranslations } from "@vibeshape/i18n"
import { withFieldGroup } from "@vibeshape/ui/integrations/tanstack-form"
import { parseLibraryMetadata } from "./library-model"

export function libraryMetadataValidation(values: { name: string; tags: string }, message: string) {
  const parsed = parseLibraryMetadata(values.name, values.tags)
  if (parsed.success) return undefined
  const fields: Partial<Record<"name" | "tags", string>> = {}
  for (const issue of parsed.error.issues) {
    const field = issue.path[0]
    if (field === "name" || field === "tags") fields[field] = message
  }
  return { fields }
}

export const LibraryMetadataFields = withFieldGroup({
  defaultValues: { name: "", tags: "" },
  render: function LibraryMetadataFields({ group }) {
    const t = useTranslations("app.library")
    return (
      <div className="grid gap-3">
        <group.AppField name="name">
          {(field) => <field.TextField label={t("name")} required maxLength={128} />}
        </group.AppField>
        <group.AppField name="tags">
          {(field) => <field.TextField label={t("tags")} description={t("tagsHelp")} />}
        </group.AppField>
      </div>
    )
  },
})
export function LibraryItemSummary({
  item,
  version,
}: {
  item: AssemblyLibraryItem
  version: number
}) {
  const t = useTranslations("app.library")
  return (
    <div className="grid gap-1">
      <h3 className="break-words text-sm font-semibold">{item.name}</h3>
      <p className="text-xs text-muted-foreground">
        {t("versionSummary", { version, latest: item.headVersion })}
      </p>
      {item.tags.length > 0 && (
        <p className="break-words text-xs text-muted-foreground">
          {t("tagSummary", { tags: item.tags.join(", ") })}
        </p>
      )}
    </div>
  )
}
