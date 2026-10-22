import { useTranslations } from "@vibeshape/i18n"
import { SelectField, SelectOption } from "@vibeshape/ui/components/select-field"
import type { LightweightingAlgorithmFields } from "./lightweighting-algorithm-model"
import type { LightweightingFields } from "./lightweighting-model"
import { LightweightingNumberField } from "./lightweighting-number-field"

export function LightweightingAlgorithmControls({
  fields,
  onChange,
  study,
}: {
  fields: LightweightingFields
  onChange: (fields: LightweightingFields) => void
  study: boolean
}) {
  const t = useTranslations("app.lightweighting.algorithm")
  const settings = fields.optimization
  const update = (next: Partial<LightweightingAlgorithmFields>) =>
    onChange({ ...fields, optimization: { ...settings, ...next } })
  const numeric = (
    key:
      | "volumePercent"
      | "filterRadiusMm"
      | "penalty"
      | "cellPeriodMm"
      | "minWallThicknessMm"
      | "maxWallThicknessMm"
      | "skinThicknessMm"
      | "gamma",
    min: number,
    max?: number,
  ) => (
    <LightweightingNumberField
      id={`lightweighting-algorithm-${key}`}
      label={t(key)}
      description={key === "cellPeriodMm" ? t("resolutionHelp") : undefined}
      value={settings[key]}
      onChange={(value) => update({ [key]: value })}
      min={min}
      {...(max === undefined ? {} : { max })}
    />
  )
  return (
    <fieldset className="grid min-w-0 grid-cols-1 gap-2" aria-label={t("method")}>
      <SelectField
        id="lightweighting-method"
        label={t("method")}
        value={settings.kind}
        description={
          <>
            <span className="block">
              {t(
                settings.kind === "adaptive-lattice"
                  ? "latticeHelp"
                  : settings.kind === "simp"
                    ? "simpHelp"
                    : "greedyHelp",
              )}
            </span>
            {settings.kind !== "greedy" && <span className="block">{t("verificationHelp")}</span>}
          </>
        }
        onValueChange={(kind) => {
          if (kind === "greedy" || kind === "simp" || kind === "adaptive-lattice") update({ kind })
        }}
      >
        <SelectOption value="greedy">{t("greedy")}</SelectOption>
        <SelectOption value="simp">{t("simp")}</SelectOption>
        <SelectOption value="adaptive-lattice">{t("adaptiveLattice")}</SelectOption>
      </SelectField>
      {settings.kind === "simp" && (
        <>
          {study ? (
            <p className="text-xs text-muted-foreground">{t("studyVolume")}</p>
          ) : (
            numeric("volumePercent", 10, 100)
          )}
          <div className="grid grid-cols-1 gap-2">
            {numeric("filterRadiusMm", 0.01)}
            {numeric("penalty", 1, 5)}
          </div>
        </>
      )}
      {settings.kind === "adaptive-lattice" && (
        <>
          <SelectField
            id="lightweighting-lattice"
            label={t("lattice")}
            value={settings.lattice}
            onValueChange={(lattice) => {
              if (lattice === "gyroid" || lattice === "schwarz-p" || lattice === "schwarz-d")
                update({ lattice })
            }}
          >
            <SelectOption value="gyroid">Gyroid</SelectOption>
            <SelectOption value="schwarz-p">Schwarz P</SelectOption>
            <SelectOption value="schwarz-d">Schwarz D</SelectOption>
          </SelectField>
          <SelectField
            id="lightweighting-field"
            label={t("field")}
            value={settings.field}
            onValueChange={(field) => {
              if (field === "strain-energy" || field === "von-mises") update({ field })
            }}
          >
            <SelectOption value="strain-energy">{t("strainEnergy")}</SelectOption>
            <SelectOption value="von-mises">{t("vonMises")}</SelectOption>
          </SelectField>
          <div className="grid grid-cols-1 gap-2">
            {numeric("cellPeriodMm", 0.01)}
            {numeric("gamma", 0.1, 8)}
            {numeric("minWallThicknessMm", 0.01)}
            {numeric("maxWallThicknessMm", 0.01)}
            {numeric("skinThicknessMm", 0)}
          </div>
          {Number.isFinite(Number(fields.cellSizeMm)) && Number(fields.cellSizeMm) > 0 && (
            <p className="text-xs text-muted-foreground">
              {t("resolutionValues", {
                cell: Number(fields.cellSizeMm),
                period: 8 * Number(fields.cellSizeMm),
                wall: 2 * Number(fields.cellSizeMm),
              })}
            </p>
          )}
        </>
      )}
    </fieldset>
  )
}
