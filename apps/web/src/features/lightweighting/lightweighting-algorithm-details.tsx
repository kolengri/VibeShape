import type { StructuralOptimizationSummary } from "@vibeshape/domain/lightweighting"
import { useTranslations } from "@vibeshape/i18n"

export function LightweightingAlgorithmDetails({
  result,
}: {
  result: StructuralOptimizationSummary
}) {
  const t = useTranslations("app.lightweighting.algorithm")
  const number = useTranslations("app.lightweighting")
  const algorithm = result.algorithm
  if (!algorithm) return null
  const settings = algorithm.settings
  const rows =
    settings.kind === "simp"
      ? ([
          [t("filterRadiusMm"), settings.filterRadiusMm],
          [t("penalty"), settings.penalty],
        ] as const)
      : ([
          [t("cellPeriodMm"), settings.cellPeriodMm],
          [t("minWallThicknessMm"), settings.minWallThicknessMm],
          [t("maxWallThicknessMm"), settings.maxWallThicknessMm],
          [t("skinThicknessMm"), settings.skinThicknessMm],
          [t("gamma"), settings.gamma],
        ] as const)
  return (
    <section className="grid gap-2 text-xs" aria-label={t("method")}>
      <p className="font-medium">{t(algorithm.kind === "simp" ? "simp" : "adaptiveLattice")}</p>
      <p>{t("finalVerification")}</p>
      {algorithm.kind === "simp" && algorithm.settings.kind === "simp" && (
        <>
          <p>
            {t("convergence", {
              change: algorithm.maxDensityChange,
              converged: algorithm.converged ? "yes" : "no",
            })}
          </p>
          <p>
            {t("retainedVolume", {
              target: 100 * algorithm.settings.volumeFraction,
              achieved: (100 * result.finalCellCount) / result.initialCellCount,
            })}
          </p>
          <p>{t(algorithm.targetStatus === "reached" ? "targetReached" : "targetNotReached")}</p>
        </>
      )}
      {algorithm.kind === "adaptive-lattice" && algorithm.settings.kind === "adaptive-lattice" && (
        <>
          <p>{t(algorithm.settings.field === "strain-energy" ? "strainEnergy" : "vonMises")}</p>
          <p>{t("fieldRange", { min: algorithm.fieldMin, max: algorithm.fieldMax })}</p>
          <p>{t("measuredFeatureBound", { value: algorithm.minimumFeatureSizeBoundMm })}</p>
        </>
      )}
      <details>
        <summary className="cursor-pointer font-medium">{t("parameters")}</summary>
        <dl className="grid gap-1 py-2">
          {settings.kind === "adaptive-lattice" && (
            <div>
              <dt>{t("lattice")}</dt>
              <dd>
                {settings.lattice === "gyroid"
                  ? "Gyroid"
                  : settings.lattice === "schwarz-p"
                    ? "Schwarz P"
                    : "Schwarz D"}
              </dd>
            </div>
          )}
          {rows.map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{number("number", { value })}</dd>
            </div>
          ))}
        </dl>
      </details>
    </section>
  )
}
