import { useTranslations } from "@vibeshape/i18n"
import { Button } from "@vibeshape/ui/components/button"
import { SelectField, SelectOption } from "@vibeshape/ui/components/select-field"
import { useState } from "react"
import type { DocumentControllerState } from "../../document/document-controller"
import {
  detachActiveLibraryDefinition,
  relinkActiveLibraryDefinition,
} from "../../document/library-controller"
import { activeAssembly } from "../assembly/assembly-model"
import type { LibrarySelection } from "./library-model"
import type { LibraryAction } from "./use-library-action"

export function LibraryReferences({
  controller,
  selection,
  action,
  writable,
}: {
  controller: DocumentControllerState
  selection: LibrarySelection | null
  action: LibraryAction
  writable: boolean
}) {
  const t = useTranslations("app.library")
  const definitions = activeAssembly(controller).definitions.filter(
    ({ libraryBinding }) => libraryBinding,
  )
  const [definitionId, setDefinitionId] = useState(definitions[0]?.id ?? "")
  const definition = definitions.find(({ id }) => id === definitionId)
  const binding = definition?.libraryBinding
  const unchanged =
    binding &&
    selection &&
    binding.itemId === selection.item.id &&
    binding.version === selection.version.version
  return (
    <section aria-label={t("referencesTitle")} className="grid gap-3 rounded-md border p-3">
      <h3 className="text-sm font-semibold">{t("referencesTitle")}</h3>
      <p className="text-xs text-muted-foreground">{t("updateExplanation")}</p>
      {definitions.length ? (
        <fieldset
          disabled={!writable || action.pending}
          aria-busy={action.pending}
          className="grid gap-3"
        >
          <legend className="sr-only">{t("referencesTitle")}</legend>
          <SelectField
            label={t("referenceDefinition")}
            value={definitionId}
            onValueChange={setDefinitionId}
          >
            {definitions.map((entry) => (
              <SelectOption key={entry.id} value={entry.id}>
                {t("boundDefinition", {
                  name: entry.name,
                  version: entry.libraryBinding?.version ?? 0,
                })}
              </SelectOption>
            ))}
          </SelectField>
          {selection && (
            <p className="text-xs">
              {t("updateTarget", { name: selection.item.name, version: selection.version.version })}
            </p>
          )}
          <Button
            type="button"
            variant="outline"
            disabled={!definition || !selection || Boolean(unchanged)}
            isLoading={action.pending}
            onClick={() => {
              if (!writable || !definition || !selection) return
              void action.run(
                () =>
                  relinkActiveLibraryDefinition({
                    definitionId: definition.id,
                    itemId: selection.item.id,
                    version: selection.version.version,
                  }),
                () => action.setNotice(t("referenceUpdated")),
                false,
              )
            }}
          >
            {t("updateReference")}
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={!definition}
            isLoading={action.pending}
            onClick={() => {
              if (!writable || !definition) return
              void action.run(
                () => detachActiveLibraryDefinition(definition.id),
                () => action.setNotice(t("referenceDetached")),
                false,
              )
            }}
          >
            {t("detachReference")}
          </Button>
          <p className="text-xs text-muted-foreground">{t("detachExplanation")}</p>
        </fieldset>
      ) : (
        <p className="text-xs text-muted-foreground">{t("noReferences")}</p>
      )}
    </section>
  )
}
