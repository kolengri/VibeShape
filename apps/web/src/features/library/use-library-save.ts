import { useTranslations } from "@vibeshape/i18n"
import { useIsMounted } from "@vibeshape/ui/hooks/use-is-mounted"
import { useAppForm } from "@vibeshape/ui/integrations/tanstack-form"
import { useEffect, useRef, useState } from "react"
import { saveActiveLibraryDefinition } from "../../document/library-controller"
import { libraryMetadataValidation } from "./library-fields"
import {
  type LibrarySource,
  librarySaveState,
  librarySelection,
  parseLibraryMetadata,
} from "./library-model"
import type { LibraryAction } from "./use-library-action"
import type { LibraryBrowser } from "./use-library-browser"

export function useLibrarySubmissionGuard(action: LibraryAction, writable: boolean) {
  const isMounted = useIsMounted()
  return () => isMounted() && writable && !action.isPending()
}

export function useLibrarySave(
  sources: readonly LibrarySource[],
  browser: LibraryBrowser,
  action: LibraryAction,
  writable: boolean,
) {
  const t = useTranslations("app.library")
  const canSubmit = useLibrarySubmissionGuard(action, writable)
  const [initial] = useState(() => {
    const sourceKey = sources[0]?.key ?? ""
    return { sourceKey, ...librarySaveState(sources, sourceKey, false, browser.selection) }
  })
  const resetKey = useRef(initial.formKey)
  const form = useAppForm({
    defaultValues: {
      sourceKey: initial.sourceKey,
      publishMode: "new",
      name: initial.name,
      tags: initial.tags.join(", "),
    },
    validators: {
      onChange: ({ value, formApi }) =>
        formApi.state.submissionAttempts > 0
          ? libraryMetadataValidation(value, t("invalidMetadata"))
          : undefined,
      onSubmit: ({ value }) => {
        const metadata = libraryMetadataValidation(value, t("invalidMetadata"))
        if (metadata) return metadata
        return librarySaveState(
          sources,
          value.sourceKey,
          value.publishMode === "publish",
          browser.selection,
        ).disabled
          ? t("chooseSourceAndItem")
          : undefined
      },
    },
    listeners: {
      onChange: ({ fieldApi, formApi }) => {
        if (fieldApi.name !== "sourceKey" && fieldApi.name !== "publishMode") return
        const value = formApi.state.values
        const state = librarySaveState(
          sources,
          value.sourceKey,
          value.publishMode === "publish",
          browser.selection,
        )
        if (state.formKey === resetKey.current) return
        resetKey.current = state.formKey
        formApi.reset(
          { ...value, name: state.name, tags: state.tags.join(", ") },
          { keepDefaultValues: true },
        )
      },
    },
    onSubmit: async ({ value }) => {
      if (!canSubmit()) return
      const metadata = parseLibraryMetadata(value.name, value.tags)
      const { source, target, disabled } = librarySaveState(
        sources,
        value.sourceKey,
        value.publishMode === "publish",
        browser.selection,
      )
      if (!metadata.success || !source || disabled) return
      await action.run(
        () =>
          saveActiveLibraryDefinition({
            source: { kind: source.kind, id: source.id },
            ...(target ? { itemId: target.id } : {}),
            expectedMetadataRevision: target?.metadataRevision ?? null,
            ...metadata.data,
          }),
        (saved) => {
          if (!saved) return
          browser.setSelection(librarySelection(saved))
          browser.reload()
          action.setNotice(
            t("savedVersion", { name: saved.item.name, version: saved.version.version }),
          )
        },
      )
    },
  })
  useEffect(() => {
    const value = form.state.values
    const state = librarySaveState(
      sources,
      value.sourceKey,
      value.publishMode === "publish",
      browser.selection,
    )
    if (state.formKey === resetKey.current) return
    resetKey.current = state.formKey
    form.reset(
      { ...value, name: state.name, tags: state.tags.join(", ") },
      { keepDefaultValues: true },
    )
  }, [sources, browser.selection, form])
  return form
}
