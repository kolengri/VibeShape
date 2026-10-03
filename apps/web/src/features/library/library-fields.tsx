import type { AssemblyLibraryItem } from "@vibeshape/domain/assembly-library"
import { useTranslations } from "@vibeshape/i18n"
import { TextField } from "@vibeshape/ui/components/text-field"

export function LibraryMetadataFields({
  name,
  tags = [],
}: {
  name: string
  tags?: readonly string[]
}) {
  const t = useTranslations("app.library")
  return (
    <div className="grid gap-3">
      <TextField name="name" label={t("name")} defaultValue={name} required maxLength={128} />
      <TextField
        name="tags"
        label={t("tags")}
        defaultValue={tags.join(", ")}
        description={t("tagsHelp")}
      />
    </div>
  )
}
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
