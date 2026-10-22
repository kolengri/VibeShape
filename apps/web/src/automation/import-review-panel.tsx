import { useFormatter, useTranslations } from "@vibeshape/i18n"
import { Alert } from "@vibeshape/ui/components/alert"
import { useState } from "react"
import { TaskPanelLayout } from "../components/task-panel-layout"
import { ImportPreview } from "../features/import/import-preview"
import { ReviewActions } from "./automation-review-actions"
import type { AutomationReviewState } from "./automation-review-state"
import type { ImportReviewInput } from "./import-upload-session"
import { LightweightingReviewDetails } from "./lightweighting-review-details"
import { QuickLightweightingReviewDetails } from "./quick-lightweighting-review-details"

export function ImportReviewPanel({
  review,
}: {
  review: AutomationReviewState & { input: ImportReviewInput }
}) {
  const t = useTranslations("app.shell.taskPanel.importReview")
  const actions = useTranslations("app.shell.taskPanel.automationReview")
  const formatter = useFormatter()
  const [previewReady, setPreviewReady] = useState(false)
  const { input } = review
  const number = (value: number) => formatter.number(value, { maximumFractionDigits: 3 })
  return (
    <section
      aria-label={t("title")}
      className="flex min-h-0 min-w-0 flex-col overflow-hidden border-l bg-panel"
    >
      <TaskPanelLayout
        title={t("title")}
        actions={<ReviewActions review={review} t={actions} ready={previewReady} />}
      >
        <div className="grid min-w-0 content-start gap-3">
          <p className="text-sm">{t("description")}</p>
          {input.lightweighting && <LightweightingReviewDetails evidence={input.lightweighting} />}
          {input.quickLightweighting && (
            <QuickLightweightingReviewDetails evidence={input.quickLightweighting} />
          )}
          <dl className="grid gap-1 text-xs">
            <div>
              <dt className="font-medium">{t("file")}</dt>
              <dd>{input.source.upload.filename}</dd>
            </div>
            <div>
              <dt className="font-medium">{t("label")}</dt>
              <dd>{input.label}</dd>
            </div>
            <div>
              <dt className="font-medium">{t("representation")}</dt>
              <dd>
                {t(input.source.representation === "exact-solid" ? "exactSolid" : "triangleMesh")}
              </dd>
            </div>
            <div>
              <dt className="font-medium">{t("units")}</dt>
              <dd>
                {t("normalization", {
                  sourceUnit: input.source.normalization.sourceUnit,
                  scale: number(input.source.normalization.scaleToMillimeters),
                })}
              </dd>
            </div>
          </dl>
          <p className="text-xs text-muted-foreground">
            {t(input.source.upload.format === "3mf" ? "declaredUnits" : "explicitUnits")}
          </p>
          <ImportPreview
            inspection={input.inspection}
            label={t("preview")}
            failedMessage={t("previewFailed")}
            onReady={setPreviewReady}
          />
          <ul className="grid gap-2 text-xs" aria-label={t("outputs")}>
            {input.source.outputs.map((output) => (
              <li key={output.outputRole} className="rounded border p-2">
                <div className="break-all font-medium">{output.outputRole}</div>
                <div>
                  {t("size", {
                    x: number(output.bounds.max[0] - output.bounds.min[0]),
                    y: number(output.bounds.max[1] - output.bounds.min[1]),
                    z: number(output.bounds.max[2] - output.bounds.min[2]),
                  })}
                </div>
                {output.volumeMm3 !== null && (
                  <div>{t("volume", { value: number(output.volumeMm3) })}</div>
                )}
                <div>{t("area", { value: number(output.surfaceAreaMm2) })}</div>
                <div>{t("triangles", { count: output.triangleCount })}</div>
              </li>
            ))}
          </ul>
          {input.source.warnings.map((warning) => (
            <p key={warning.code} className="text-xs text-muted-foreground">
              {t("degenerateTriangles", { count: warning.count })}
            </p>
          ))}
          {review.status === "error" && <Alert aria-live="polite">{actions("applyFailed")}</Alert>}
        </div>
      </TaskPanelLayout>
    </section>
  )
}
