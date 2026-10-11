import type { StructuralOptimizationSettings } from "@vibeshape/domain/lightweighting"
import { useTranslations } from "@vibeshape/i18n"
import { LightweightingResults } from "../features/lightweighting/lightweighting-results"
import type { ImportReviewInput } from "./import-upload-session"

export function LightweightingReviewDetails({
  evidence,
}: {
  evidence: NonNullable<ImportReviewInput["lightweighting"]>
}) {
  const t = useTranslations("app.lightweighting")
  const review = useTranslations("app.shell.taskPanel.lightweightingReview")
  const generative = useTranslations("app.generativeDesign")
  return (
    <section className="grid gap-3">
      <p className="text-sm">{review("description")}</p>
      <p className="text-sm">{review("source", { name: evidence.sourceName })}</p>
      {evidence.settings.objective?.kind === "maximize-stiffness" && (
        <p className="text-xs">
          {t("retainedMassPercent", {
            value: 100 * evidence.settings.objective.retainedMassFraction,
          })}
        </p>
      )}
      <dl className="grid gap-1 text-xs">
        <div>
          <dt className="font-medium">{t("objective")}</dt>
          <dd>
            {t(
              evidence.settings.objective?.kind === "maximize-stiffness"
                ? "maximizeStiffness"
                : "minimizeMass",
            )}
          </dd>
        </div>
        <div>
          <dt className="font-medium">{t("safetyFactor")}</dt>
          <dd>{t("number", { value: evidence.settings.safetyFactor })}</dd>
        </div>
        <div>
          <dt className="font-medium">{t("maxDisplacementMm")}</dt>
          <dd>{t("number", { value: evidence.settings.maxDisplacementMm })}</dd>
        </div>
        <div>
          <dt className="font-medium">{t("cellSizeMm")}</dt>
          <dd>{t("number", { value: evidence.settings.cellSizeMm })}</dd>
        </div>
        <div>
          <dt className="font-medium">{t("youngModulusMpa")}</dt>
          <dd>{t("number", { value: evidence.settings.material.youngModulusMpa })}</dd>
        </div>
        <div>
          <dt className="font-medium">{t("poissonRatio")}</dt>
          <dd>{t("number", { value: evidence.settings.material.poissonRatio })}</dd>
        </div>
        <div>
          <dt className="font-medium">{t("yieldStrengthMpa")}</dt>
          <dd>{t("number", { value: evidence.settings.material.yieldStrengthMpa })}</dd>
        </div>
        <div>
          <dt className="font-medium">{t("densityKgM3")}</dt>
          <dd>{t("number", { value: evidence.settings.material.densityKgM3 })}</dd>
        </div>
      </dl>
      <details className="grid gap-2 text-xs">
        <summary className="cursor-pointer font-medium">{t("support")}</summary>
        {evidence.settings.supports.map((region) => (
          <ReviewRegion key={JSON.stringify(region)} region={region} />
        ))}
      </details>
      <details className="grid gap-2 text-xs">
        <summary className="cursor-pointer font-medium">{t("loadCases")}</summary>
        {evidence.settings.loadCases.map((load) => (
          <div key={load.name} className="grid gap-1 border-b py-2">
            <h3 className="font-medium">{load.name}</h3>
            <ReviewRegion region={load.region} />
            <dl>
              {(["X", "Y", "Z"] as const).map((axis, index) => (
                <div key={axis}>
                  <dt>{t("force", { axis })}</dt>
                  <dd>{t("number", { value: load.forceN[index] ?? 0 })}</dd>
                </div>
              ))}
            </dl>
          </div>
        ))}
      </details>
      {evidence.settings.preserveRegions.length > 0 && (
        <details className="grid gap-2 text-xs">
          <summary className="cursor-pointer font-medium">{t("preservation")}</summary>
          {evidence.settings.preserveRegions.map((region) => (
            <ReviewRegion key={JSON.stringify(region)} region={region} />
          ))}
        </details>
      )}
      <LightweightingResults result={evidence.summary} />
      {!!evidence.settings.obstacleRegions?.length && (
        <details className="grid gap-2 text-xs">
          <summary className="cursor-pointer font-medium">{generative("obstacles")}</summary>
          {evidence.settings.obstacleRegions.map((region) => (
            <ReviewRegion key={JSON.stringify(region)} region={region} />
          ))}
        </details>
      )}
    </section>
  )
}

function ReviewRegion({ region }: { region: StructuralOptimizationSettings["supports"][number] }) {
  const t = useTranslations("app.lightweighting")
  const vector = (values: readonly number[]) =>
    values.map((value) => t("number", { value })).join(", ")
  if ("kind" in region)
    return (
      <div>
        <p>{t("surfaceTriangleCount", { count: region.triangleIndices.length })}</p>
        <dl>
          <div>
            <dt>{t("surfaceDepth")}</dt>
            <dd>{t("number", { value: region.depthMm })}</dd>
          </div>
        </dl>
      </div>
    )
  return (
    <dl>
      <div>
        <dt>{t("min")}</dt>
        <dd>{vector(region.min)}</dd>
      </div>
      <div>
        <dt>{t("max")}</dt>
        <dd>{vector(region.max)}</dd>
      </div>
    </dl>
  )
}
