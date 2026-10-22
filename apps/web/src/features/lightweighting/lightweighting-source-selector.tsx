import { useTranslations } from "@vibeshape/i18n"
import { Alert } from "@vibeshape/ui/components/alert"
import { SelectField, SelectOption } from "@vibeshape/ui/components/select-field"
import type { DocumentControllerState } from "../../document/document-controller"
import { availableLightweightingParts, type LightweightingSource } from "./lightweighting-model"

export function LightweightingSourceSelector({
  controller,
  state,
  disabled,
}: {
  controller: DocumentControllerState
  state: { partId: string; source: LightweightingSource | null; choosePart: (id: string) => void }
  disabled: boolean
}) {
  const t = useTranslations("app.lightweighting")
  const parts = availableLightweightingParts(controller)
  return (
    <>
      <SelectField
        id="lightweighting-part"
        label={t("part")}
        required
        value={state.partId || "unselected"}
        disabled={disabled}
        onValueChange={state.choosePart}
      >
        <SelectOption value="unselected" disabled>
          {t("choosePart")}
        </SelectOption>
        {parts.map(({ part }) => (
          <SelectOption key={part.id} value={part.id}>
            {part.name}
          </SelectOption>
        ))}
      </SelectField>
      {parts.length === 0 && (
        <p role="status" className="text-sm">
          {t("noParts")}
        </p>
      )}
      {state.partId && !state.source && <Alert>{t("partUnavailable")}</Alert>}
      <p className="text-xs text-muted-foreground">{t("partDescription")}</p>
    </>
  )
}
