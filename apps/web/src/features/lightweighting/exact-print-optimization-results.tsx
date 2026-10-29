import type { StructuralOptimizationSummary } from "@vibeshape/domain/lightweighting"
import { useTranslations } from "@vibeshape/i18n"
import { FdmSupportDemand } from "./fdm-analysis-details"
import { LightweightingAlgorithmDetails } from "./lightweighting-algorithm-details"
import { RelativePerformanceResults } from "./lightweighting-results"
import type { ExactPrintOptimizationEvidence } from "./prepare-exact-print-snapshot"

export function ExactPrintOptimizationResults({
  evidence,
  proposal,
  densityKgM3,
}: {
  evidence: ExactPrintOptimizationEvidence
  proposal: StructuralOptimizationSummary
  densityKgM3: number
}) {
  const t = useTranslations("app.printOptimization")
  const l = useTranslations("app.lightweighting")
  const rows = [
    [t("exactVolume"), evidence.sourceVolumeMm3, evidence.volumeMm3],
    [
      t("exactMass"),
      evidence.sourceVolumeMm3 * densityKgM3 * 1e-9,
      evidence.volumeMm3 * densityKgM3 * 1e-9,
    ],
  ] as const
  return (
    <section className="grid gap-2" aria-label={t("exactResults")}>
      <p role="status" className="text-sm font-medium">
        {t("exactVerified")}
      </p>
      <p className="text-sm">
        {t("savedMaterial", { percent: 100 * (1 - evidence.volumeMm3 / evidence.sourceVolumeMm3) })}
      </p>
      <p className="text-xs">{t("preservedExactly", { count: evidence.preservedFaceCount })}</p>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <caption className="sr-only">{t("exactResults")}</caption>
          <thead>
            <tr>
              <th scope="col">{l("metric")}</th>
              <th scope="col">{t("sourceCad")}</th>
              <th scope="col">{t("resultCad")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([label, original, candidate]) => (
              <tr key={label} className="border-t">
                <th scope="row" className="py-1 font-normal">
                  {label}
                </th>
                <td>{l("number", { value: Number(original.toPrecision(6)) })}</td>
                <td>{l("number", { value: Number(candidate.toPrecision(6)) })}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <RelativePerformanceResults
        baseline={proposal.baseline}
        optimized={evidence.verification.optimized}
        settings={proposal.relativePerformance}
      />
      {evidence.verification.fdm && <FdmSupportDemand summary={evidence.verification.fdm} />}
      <LightweightingAlgorithmDetails result={proposal} />
      <details>
        <summary className="cursor-pointer text-xs">{t("diagnostics")}</summary>
        <ul className="list-disc space-y-1 pl-4 text-xs">
          {proposal.warnings.map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      </details>
      <p className="text-xs text-muted-foreground">{t("exactAnalysisLimit")}</p>
    </section>
  )
}
