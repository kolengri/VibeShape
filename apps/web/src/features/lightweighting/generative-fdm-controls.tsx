import { useTranslations } from "@vibeshape/i18n"
import { Field, FieldLabel } from "@vibeshape/ui/components/field"
import { Input } from "@vibeshape/ui/components/input"
import { SelectField, SelectOption } from "@vibeshape/ui/components/select-field"
import { LightweightingSettingsDetails } from "./lightweighting-settings-details"
import type { useGenerativeDesignTask } from "./use-generative-design-task"

const directions = ["+x", "-x", "+y", "-y", "+z", "-z"] as const
const numericFields = ["minFeatureSizeMm", "layerHeightMm", "maxOverhangAngleDeg"] as const

export function GenerativeFdmControls({
  state,
}: {
  state: ReturnType<typeof useGenerativeDesignTask>
}) {
  const t = useTranslations("app.generativeDesign.fdm")
  const fields = state.studyFields
  const change = (next: Partial<typeof fields.fdm>) =>
    state.changeStudyFields({ ...fields, fdm: { ...fields.fdm, ...next } })
  return (
    <fieldset className="grid min-w-0 grid-cols-1 gap-2">
      <legend className="mb-1 font-medium">{t("title")}</legend>
      <SelectField
        id="generative-fdm-supports"
        label={t("supportMode")}
        value={fields.fdm.supportMode}
        onValueChange={(supportMode) => {
          if (supportMode === "forbidden" || supportMode === "allowed") change({ supportMode })
        }}
      >
        <SelectOption value="forbidden">{t("forbidden")}</SelectOption>
        <SelectOption value="allowed">{t("allowed")}</SelectOption>
      </SelectField>
      <p className="text-xs text-muted-foreground" role="note">
        {t(fields.fdm.supportMode === "forbidden" ? "forbiddenHelp" : "allowedHelp")}
      </p>
      <SelectField
        id="generative-fdm-direction"
        label={t("buildDirection")}
        description={t("directionHelp")}
        value={fields.fdm.buildDirection}
        onValueChange={(value) => {
          const buildDirection = directions.find((direction) => direction === value)
          if (buildDirection) change({ buildDirection })
        }}
      >
        {directions.map((direction) => (
          <SelectOption key={direction} value={direction}>
            {t("direction", { direction: direction.toUpperCase() })}
          </SelectOption>
        ))}
      </SelectField>
      <p className="text-xs text-muted-foreground">
        {t("settingsSummary", {
          feature: fields.fdm.minFeatureSizeMm,
          layer: fields.fdm.layerHeightMm,
          angle: fields.fdm.maxOverhangAngleDeg,
        })}
      </p>
      <LightweightingSettingsDetails label={t("printerSettings")}>
        <div className="grid min-w-0 grid-cols-1 gap-2">
          {numericFields.map((key) => (
            <Field key={key}>
              <FieldLabel htmlFor={`generative-fdm-${key}`} className="max-w-full">
                {t(key)}
              </FieldLabel>
              <Input
                id={`generative-fdm-${key}`}
                type="number"
                required
                step="any"
                min={key === "maxOverhangAngleDeg" ? 0 : key === "layerHeightMm" ? 0.001 : 0.01}
                max={key === "maxOverhangAngleDeg" ? 89 : undefined}
                value={fields.fdm[key]}
                onChange={(event) => change({ [key]: event.currentTarget.value })}
              />
            </Field>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">{t("constraintsHelp")}</p>
      </LightweightingSettingsDetails>
    </fieldset>
  )
}
