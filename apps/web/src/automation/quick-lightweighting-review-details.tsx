import { useTranslations } from "@vibeshape/i18n"
import { QuickLightweightingResults } from "../features/lightweighting/quick-lightweighting-results"
import type { ImportReviewInput } from "./import-upload-session"

const cellLabels = {
  gyroid: "cellGyroid",
  "schwarz-p": "cellSchwarzP",
  "schwarz-d": "cellSchwarzD",
} as const

export function QuickLightweightingReviewDetails({
  evidence,
}: {
  evidence: NonNullable<ImportReviewInput["quickLightweighting"]>
}) {
  const t = useTranslations("app.quickLightweighting")
  return (
    <section className="grid gap-3">
      <p className="text-sm">{t("reviewDescription")}</p>
      <p className="text-sm">{t("reviewSource", { name: evidence.sourceName })}</p>
      <dl className="grid gap-1 text-xs">
        <div>
          <dt className="font-medium">{t("cellType")}</dt>
          <dd>{t(cellLabels[evidence.summary.cellType])}</dd>
        </div>
        <div>
          <dt className="font-medium">{t("latticeCellSizeMm")}</dt>
          <dd>{t("number", { value: evidence.summary.latticeCellSizeMm })}</dd>
        </div>
        <div>
          <dt className="font-medium">{t("mode")}</dt>
          <dd>
            {t(evidence.settings.mode === "preserve-exterior" ? "preserveExterior" : "openOrganic")}
          </dd>
        </div>
        <div>
          <dt className="font-medium">{t("cellSizeMm")}</dt>
          <dd>{t("number", { value: evidence.settings.cellSizeMm })}</dd>
        </div>
        {evidence.settings.mode === "preserve-exterior" && (
          <div>
            <dt className="font-medium">{t("skinThicknessMm")}</dt>
            <dd>{t("number", { value: evidence.settings.skinThicknessMm })}</dd>
          </div>
        )}
      </dl>
      <QuickLightweightingResults result={evidence.summary} />
    </section>
  )
}
