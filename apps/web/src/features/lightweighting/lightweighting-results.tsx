import type { StructuralOptimizationSummary } from "@vibeshape/domain/lightweighting"
import { useTranslations } from "@vibeshape/i18n"
import { FdmSupportDemand } from "./fdm-analysis-details"

export function LightweightingResults({ result }: { result: StructuralOptimizationSummary }) {
  const t = useTranslations("app.lightweighting")
  const rows = [
    [t("volume"), result.baseline.volumeMm3, result.optimized.volumeMm3],
    [t("mass"), result.baseline.massKg, result.optimized.massKg],
    [t("worstStress"), result.baseline.maxVonMisesMpa, result.optimized.maxVonMisesMpa],
    [t("worstDisplacement"), result.baseline.maxDisplacementMm, result.optimized.maxDisplacementMm],
    [t("achievedSafetyFactor"), result.baseline.safetyFactor, result.optimized.safetyFactor],
  ] as const
  const rounded = (value: number) => Number(value.toPrecision(6))
  return (
    <section className="grid gap-3" aria-label={t("results")}>
      <p role="status" className="font-medium">
        {t(result.status === "improved" ? "improved" : "noImprovement")}
      </p>
      <p className="text-sm text-muted-foreground">
        {t("sourceVolumeLoss", {
          source: rounded(result.sourceVolumeMm3),
          loss: rounded(result.sourceVolumeLossFraction * 100),
        })}
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <caption className="sr-only">{t("comparison")}</caption>
          <thead>
            <tr>
              <th className="p-2" scope="col">
                {t("metric")}
              </th>
              <th className="p-2" scope="col">
                {t("baseline")}
              </th>
              <th className="p-2" scope="col">
                {t("optimized")}
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([label, baseline, optimized]) => (
              <tr key={label} className="border-t">
                <th className="p-2 font-normal" scope="row">
                  {label}
                </th>
                <td className="p-2">{t("number", { value: rounded(baseline) })}</td>
                <td className="p-2">{t("number", { value: rounded(optimized) })}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-sm">
        {t("materialSaved", {
          percent: rounded((1 - result.optimized.volumeMm3 / result.baseline.volumeMm3) * 100),
        })}
      </p>
      {result.objective?.kind === "maximize-stiffness" && (
        <div className="grid gap-1 text-sm">
          <p>{t("targetMass", { value: rounded(result.objective.targetMassKg) })}</p>
          <p>
            {t("retainedMassAchieved", {
              value: rounded(result.objective.achievedRetainedMassFraction * 100),
            })}
          </p>
          <p>
            {t(
              result.objective.targetStatus === "reached"
                ? "targetMassReached"
                : "targetMassNotReached",
            )}
          </p>
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        {t("termination", {
          reason: t(
            result.termination === "target-mass-reached"
              ? "targetMassReachedTermination"
              : result.termination === "iteration-limit"
                ? "iterationLimit"
                : result.termination === "no-removable-cells"
                  ? "noRemovableCells"
                  : "constraintsOrTopology",
          ),
          iterations: result.iterations,
          evaluations: result.evaluations,
          initial: result.initialCellCount,
          final: result.finalCellCount,
        })}
      </p>
      {result.optimized.cases.map((item) => (
        <p key={item.name} className="text-xs">
          {t("caseResult", {
            name: item.name,
            stress: rounded(item.maxVonMisesMpa),
            displacement: rounded(item.maxDisplacementMm),
            safety: rounded(item.safetyFactor),
          })}
        </p>
      ))}
      {result.fdm && <FdmSupportDemand summary={result.fdm} />}
      {result.warnings.map((warning, index) => (
        <p key={`${index}-${warning}`} role="status" className="text-sm">
          {t("warning", { message: warning })}
        </p>
      ))}
      <p className="text-xs text-muted-foreground">{t("resultLimitations")}</p>
    </section>
  )
}
