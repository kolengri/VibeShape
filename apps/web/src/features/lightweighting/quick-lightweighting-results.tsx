import type { QuickLightweightingSummary } from "@vibeshape/domain/quick-lightweighting"
import { useTranslations } from "@vibeshape/i18n"

export function QuickLightweightingResults({ result }: { result: QuickLightweightingSummary }) {
  const t = useTranslations("app.quickLightweighting")
  return (
    <section aria-label={t("results")} className="grid gap-2 text-sm">
      <p role="status" className="font-medium">
        {t("removed", { percent: result.removedPercent })}
      </p>
      <dl className="grid grid-cols-2 gap-2">
        <dt>{t("sourceVolume")}</dt>
        <dd>{t("volume", { value: result.sourceVolumeMm3 })}</dd>
        <dt>{t("resultVolume")}</dt>
        <dd>{t("volume", { value: result.resultVolumeMm3 })}</dd>
        <dt>{t("cellType")}</dt>
        <dd>
          {t(
            result.cellType === "schwarz-p"
              ? "cellSchwarzP"
              : result.cellType === "schwarz-d"
                ? "cellSchwarzD"
                : "cellGyroid",
          )}
        </dd>
        <dt>{t("latticeCellSizeMm")}</dt>
        <dd>{t("length", { value: result.latticeCellSizeMm })}</dd>
        <dt>{t("requested")}</dt>
        <dd>{t("percent", { value: result.requestedRemovalPercent })}</dd>
      </dl>
      {Math.abs(result.removedPercent - result.requestedRemovalPercent) > 2 && (
        <p>{t("targetDifference")}</p>
      )}
      {result.warnings.map((message) => (
        <p key={message} className="text-muted-foreground">
          {t("warning", { message })}
        </p>
      ))}
      <p className="text-xs text-muted-foreground">{t("limitations")}</p>
    </section>
  )
}
