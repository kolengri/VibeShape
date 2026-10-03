import { useTranslations } from "@vibeshape/i18n"
import { Button } from "@vibeshape/ui/components/button"
import { SelectField, SelectOption } from "@vibeshape/ui/components/select-field"
import { TextField } from "@vibeshape/ui/components/text-field"
import { LibraryItemSummary } from "./library-fields"
import { libraryVersions } from "./library-model"
import type { LibraryBrowser } from "./use-library-browser"

export function LibraryBrowserPanel({
  browser,
  pending,
}: {
  browser: LibraryBrowser
  pending: boolean
}) {
  const t = useTranslations("app.library")
  return (
    <section aria-label={t("browseTitle")} className="grid content-start gap-3">
      <TextField
        label={t("search")}
        type="search"
        value={browser.query}
        maxLength={256}
        disabled={pending}
        onChange={(event) => browser.setQuery(event.currentTarget.value)}
      />
      <Button type="button" variant="outline" disabled={pending} onClick={browser.reload}>
        {t("refresh")}
      </Button>
      {browser.loading && (
        <p role="status" className="text-xs text-muted-foreground">
          {t("loading")}
        </p>
      )}
      <ul className="grid max-h-64 gap-2 overflow-y-auto" aria-label={t("items")}>
        {browser.items.map((item) => (
          <li key={item.id}>
            <Button
              type="button"
              variant={browser.selection?.item.id === item.id ? "secondary" : "outline"}
              className="h-auto justify-start whitespace-normal text-left"
              disabled={pending}
              aria-pressed={browser.selection?.item.id === item.id}
              aria-label={t("selectItem", { name: item.name })}
              onClick={() => void browser.select(item.id)}
            >
              <LibraryItemSummary item={item} version={item.headVersion} />
            </Button>
          </li>
        ))}
      </ul>
      {!browser.loading && !browser.items.length && (
        <p className="text-xs text-muted-foreground">{t("empty")}</p>
      )}
      {browser.selection && (
        <SelectField
          label={t("version")}
          value={String(browser.selection.version.version)}
          disabled={pending}
          onValueChange={(value) => {
            if (browser.selection) void browser.select(browser.selection.item.id, Number(value))
          }}
        >
          {libraryVersions(browser.selection.item).map((version) => (
            <SelectOption key={version} value={String(version)}>
              {t("versionLabel", { version })}
            </SelectOption>
          ))}
        </SelectField>
      )}
      {browser.error && (
        <p role="alert" className="text-sm text-destructive">
          {t("operationError", { message: browser.error })}
        </p>
      )}
    </section>
  )
}
