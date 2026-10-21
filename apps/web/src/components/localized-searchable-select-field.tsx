import { useTranslations } from "@vibeshape/i18n"
import {
  SearchableSelectControl,
  type SearchableSelectControlProps,
  SearchableSelectField,
  type SearchableSelectFieldProps,
} from "@vibeshape/ui/components/searchable-select-field"

type LocalizedStrings = "searchPlaceholder" | "searchLabel" | "emptyMessage"

export function LocalizedSearchableSelectField(
  props: Omit<SearchableSelectFieldProps, LocalizedStrings>,
) {
  const t = useTranslations("app.searchableSelect")
  return (
    <SearchableSelectField {...props} searchPlaceholder={t("search")} emptyMessage={t("empty")} />
  )
}

export function LocalizedSearchableSelectControl(
  props: Omit<SearchableSelectControlProps, LocalizedStrings>,
) {
  const t = useTranslations("app.searchableSelect")
  return (
    <SearchableSelectControl {...props} searchPlaceholder={t("search")} emptyMessage={t("empty")} />
  )
}
