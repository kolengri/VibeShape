import { structuralMaterialCatalog } from "@vibeshape/domain/lightweighting-materials"
import { useTranslations } from "@vibeshape/i18n"
import { SelectField, SelectOption } from "@vibeshape/ui/components/select-field"
import {
  applyLightweightingMaterialPreset,
  type LightweightingFields,
} from "./lightweighting-model"

export function LightweightingMaterialSelector({
  fields,
  onChange,
}: {
  fields: LightweightingFields
  onChange: (fields: LightweightingFields) => void
}) {
  const t = useTranslations("app.lightweighting")
  const preset = structuralMaterialCatalog.presets.find(
    (item) => item.id === fields.materialPresetId,
  )
  return (
    <>
      <SelectField
        id="lightweighting-material"
        label={t("materialPreset")}
        value={fields.materialPresetId}
        onValueChange={(id) => onChange(applyLightweightingMaterialPreset(fields, id))}
        aria-describedby="lightweighting-material-assumptions"
      >
        <SelectOption value="custom">{t("customMaterial")}</SelectOption>
        {structuralMaterialCatalog.presets.map((item) => (
          <SelectOption key={item.id} value={item.id}>
            {t(`presets.${item.id}`)}
          </SelectOption>
        ))}
      </SelectField>
      <p id="lightweighting-material-assumptions" className="text-xs text-muted-foreground">
        {t("presetAssumptions")}
      </p>
      {preset && (
        <div className="grid gap-1 text-xs text-muted-foreground">
          <p>
            {t("presetReference", {
              reference: preset.referenceName,
              basis: t(`presetBasis.${preset.basis}`),
              revision: preset.sourceRevision,
            })}
          </p>
          <p>{t(`presetYieldBasis.${preset.yieldStrengthBasis}`)}</p>
          <div className="flex flex-wrap gap-3">
            {preset.sourceUrls.map((url, index) => (
              <a
                key={url}
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className="underline underline-offset-2"
              >
                {t("materialSource", { index: index + 1 })}
              </a>
            ))}
          </div>
        </div>
      )}
    </>
  )
}
