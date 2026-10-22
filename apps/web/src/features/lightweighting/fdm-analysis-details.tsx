import type { StructuralFdmSettings, StructuralFdmSummary } from "@vibeshape/domain/lightweighting"
import { useTranslations } from "@vibeshape/i18n"

export function FdmSettingsDetails({ settings }: { settings: StructuralFdmSettings }) {
  const t = useTranslations("app.generativeDesign.fdm")
  const number = useTranslations("app.lightweighting")
  return (
    <section className="grid min-w-0 gap-2 text-xs" aria-label={t("reviewSettings")}>
      <h3 className="text-xs font-medium">{t("reviewSettings")}</h3>
      <dl className="grid grid-cols-1 gap-1 @xs:grid-cols-2">
        <dt>{t("supportMode")}</dt>
        <dd>{t(settings.supportMode)}</dd>
        <dt>{t("buildDirection")}</dt>
        <dd>{t("direction", { direction: settings.buildDirection.toUpperCase() })}</dd>
        {(["minFeatureSizeMm", "layerHeightMm", "maxOverhangAngleDeg"] as const).map((key) => (
          <div key={key} className="contents">
            <dt>{t(key)}</dt>
            <dd>{number("number", { value: settings[key] })}</dd>
          </div>
        ))}
      </dl>
      <p className="text-muted-foreground">{t("constraintsHelp")}</p>
    </section>
  )
}

export function FdmSupportDemand({ summary }: { summary: StructuralFdmSummary }) {
  const t = useTranslations("app.generativeDesign.fdm")
  const number = useTranslations("app.lightweighting")
  const rounded = (value: number) => Number(value.toPrecision(6))
  return (
    <section className="grid min-w-0 gap-2 text-xs" aria-label={t("supportDemand")}>
      <dl className="grid grid-cols-1 gap-1 @xs:grid-cols-2">
        <dt>{t("unsupportedArea")}</dt>
        <dd>{number("number", { value: rounded(summary.optimized.unsupportedAreaMm2) })}</dd>
        <dt>{t("minimumFeatureBound")}</dt>
        <dd>{number("number", { value: rounded(summary.optimized.minFeatureSizeBoundMm) })}</dd>
      </dl>
      <p className="text-muted-foreground">
        {t(summary.optimized.requiresSupports ? "supportRequired" : "supportNotRequired")}
      </p>
    </section>
  )
}
