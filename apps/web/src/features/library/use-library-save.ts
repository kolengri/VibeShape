import { useTranslations } from "@vibeshape/i18n"
import { type FormEvent, useState } from "react"
import { saveActiveLibraryDefinition } from "../../document/library-controller"
import {
  type LibrarySource,
  librarySaveState,
  librarySelection,
  parseLibraryMetadata,
} from "./library-model"
import type { LibraryAction } from "./use-library-action"
import type { LibraryBrowser } from "./use-library-browser"

export function useLibrarySave(
  sources: readonly LibrarySource[],
  browser: LibraryBrowser,
  action: LibraryAction,
  writable: boolean,
) {
  const t = useTranslations("app.library")
  const [sourceKey, setSourceKey] = useState(sources[0]?.key ?? "")
  const [publish, setPublish] = useState(false)
  const state = librarySaveState(sources, sourceKey, publish, browser.selection)
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!writable || action.pending) return
    const data = new FormData(event.currentTarget)
    const metadata = parseLibraryMetadata(
      String(data.get("name") ?? ""),
      String(data.get("tags") ?? ""),
    )
    if (!metadata.success) return action.setError(t("invalidMetadata"))
    const { source, target } = state
    if (!source || state.disabled) return action.setError(t("chooseSourceAndItem"))
    void action.run(
      () =>
        saveActiveLibraryDefinition({
          source: { kind: source.kind, id: source.id },
          ...(target ? { itemId: target.id } : {}),
          expectedMetadataRevision: target?.metadataRevision ?? null,
          ...metadata.data,
        }),
      (value) => {
        if (!value) return
        browser.setSelection(librarySelection(value))
        browser.reload()
        action.setNotice(
          t("savedVersion", { name: value.item.name, version: value.version.version }),
        )
      },
    )
  }
  return { state, sourceKey, setSourceKey, publish, setPublish, submit }
}
