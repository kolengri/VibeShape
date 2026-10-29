import { useTranslations } from "@vibeshape/i18n"
import { Button } from "@vibeshape/ui/components/button"
import { SelectField, SelectOption } from "@vibeshape/ui/components/select-field"
import { LightweightingMaterialSelector } from "./lightweighting-material-selector"
import type { LightweightingFields } from "./lightweighting-model"
import { LightweightingNumberField } from "./lightweighting-number-field"
import { LightweightingSettingsDetails } from "./lightweighting-settings-details"
import type { PrintOptimizationFields } from "./print-optimization-model"

export function PrintOptimizationControls({
  fields,
  material,
  disabled,
  picking,
  onChange,
  onMaterialChange,
  onPick,
}: {
  fields: PrintOptimizationFields
  material: LightweightingFields
  disabled: boolean
  picking: "bed" | "preserve" | null
  onChange: (fields: PrintOptimizationFields) => void
  onMaterialChange: (fields: LightweightingFields) => void
  onPick: (target: "bed" | "preserve") => void
}) {
  const t = useTranslations("app.printOptimization")
  const l = useTranslations("app.lightweighting")
  const numeric = (
    key:
      | "cellSizeMm"
      | "minFeatureSizeMm"
      | "layerHeightMm"
      | "stiffnessPercent"
      | "strengthPercent"
      | "maxIterations",
    min: number,
    max?: number,
  ) => (
    <LightweightingNumberField
      id={`print-optimization-${key}`}
      label={t(key)}
      value={fields[key]}
      min={min}
      {...(max === undefined ? {} : { max })}
      onChange={(value) => onChange({ ...fields, [key]: value })}
    />
  )
  return (
    <fieldset disabled={disabled} className="grid min-w-0 gap-2">
      <Button
        type="button"
        variant="outline"
        aria-pressed={picking === "bed"}
        onClick={() => onPick("bed")}
      >
        {t(fields.bedFace === null ? "chooseBed" : "changeBed")}
      </Button>
      <p className="text-xs text-muted-foreground">{t("bedHelp")}</p>
      <Button
        type="button"
        variant="outline"
        aria-pressed={picking === "preserve"}
        onClick={() => onPick("preserve")}
      >
        {t(picking === "preserve" ? "finishPreserve" : "choosePreserve", {
          count: fields.preserveFaces.length,
        })}
      </Button>
      <p className="text-xs text-muted-foreground">{t("preserveHelp")}</p>
      {picking && (
        <p role="status" className="text-sm">
          {t(picking === "bed" ? "pickingBed" : "pickingPreserve")}
        </p>
      )}
      <LightweightingMaterialSelector
        fields={material}
        onChange={onMaterialChange}
        plasticsOnly
        compact
      />
      {material.materialPresetId === "custom" && (
        <div className="grid gap-2">
          {(["youngModulusMpa", "poissonRatio", "yieldStrengthMpa", "densityKgM3"] as const).map(
            (key) => (
              <LightweightingNumberField
                key={key}
                id={`print-material-${key}`}
                label={l(key)}
                value={material[key]}
                onChange={(value) =>
                  onMaterialChange({ ...material, [key]: value, materialPresetId: "custom" })
                }
                min={key === "poissonRatio" ? 0 : 0.000001}
                {...(key === "poissonRatio" ? { max: 0.45 } : {})}
              />
            ),
          )}
        </div>
      )}
      <LightweightingSettingsDetails label={t("advanced")}>
        {numeric("stiffnessPercent", 1, 100)}
        {numeric("strengthPercent", 1, 100)}
        {numeric("cellSizeMm", 0.01)}
        {numeric("minFeatureSizeMm", 0.01)}
        {numeric("layerHeightMm", 0.001)}
        {numeric("maxIterations", 0)}
        <SelectField
          id="print-optimization-supports"
          label={t("supportMode")}
          value={fields.supportMode}
          onValueChange={(value) => {
            if (value === "allowed" || value === "forbidden")
              onChange({ ...fields, supportMode: value })
          }}
        >
          <SelectOption value="allowed">{t("supportsAllowed")}</SelectOption>
          <SelectOption value="forbidden">{t("supportsForbidden")}</SelectOption>
        </SelectField>
        <p className="text-xs text-muted-foreground">{t("constraintsHelp")}</p>
        <p className="text-xs text-muted-foreground">{t("scenarios")}</p>
        <p className="text-xs text-muted-foreground">{t("materialLimit")}</p>
      </LightweightingSettingsDetails>
    </fieldset>
  )
}
