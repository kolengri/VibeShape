import { useTranslations } from "@vibeshape/i18n"
import { ExactPrintOptimizationResults } from "../features/lightweighting/exact-print-optimization-results"
import type { ImportReviewInput } from "./import-upload-session"

export function PrintOptimizationReviewDetails({
  evidence,
}: {
  evidence: NonNullable<ImportReviewInput["printOptimization"]>
}) {
  const t = useTranslations("app.printOptimization")
  const review = useTranslations("app.shell.taskPanel.lightweightingReview")
  const { summary } = evidence
  return (
    <section className="grid gap-3">
      <p className="text-sm">{review("source", { name: evidence.sourceName })}</p>
      <p className="text-xs text-muted-foreground">{t("scenarios")}</p>
      {summary.exact && (
        <ExactPrintOptimizationResults
          evidence={summary.exact}
          proposal={summary.proposal}
          densityKgM3={summary.configuration.material.densityKgM3}
        />
      )}
    </section>
  )
}
