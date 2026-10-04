import { useFormatter, useTranslations } from "@vibeshape/i18n"
import { Button } from "@vibeshape/ui/components/button"
import { PlanarImportPreview } from "../features/planar-import/import-preview"
import { automationReviews } from "./automation-review-controller"
import type { AutomationReviewState } from "./automation-review-state"
import type { PlanarImportReviewInput } from "./planar-import-upload-session"

export function PlanarImportReviewPanel({
  review,
}: {
  review: AutomationReviewState & { input: PlanarImportReviewInput }
}) {
  const t = useTranslations("app.shell.taskPanel.planarImportReview")
  const actions = useTranslations("app.shell.taskPanel.automationReview")
  const formatter = useFormatter()
  const { input } = review
  const number = (value: number) => formatter.number(value, { maximumFractionDigits: 3 })
  return (
    <section
      aria-label={t("title")}
      className="grid h-full max-h-full min-h-0 min-w-0 grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden border-l bg-panel"
    >
      <header className="border-b px-4 py-3">
        <h2 className="text-sm font-medium">{t("title")}</h2>
      </header>
      <div className="grid min-h-0 gap-3 overflow-auto p-4">
        <p className="text-sm">{t("description")}</p>
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
            <dt className="font-medium">{t("units")}</dt>
            <dd>
              {t("normalization", {
                sourceUnit: input.source.normalization.sourceUnit,
                scale: number(input.source.normalization.scaleToMillimeters),
              })}
            </dd>
          </div>
        </dl>
        <p className="text-xs">{t("plane", { plane: input.source.upload.plane.toUpperCase() })}</p>
        <p className="text-xs text-muted-foreground">{t(input.source.unitPolicy)}</p>
        <PlanarImportPreview inspection={input.inspection} label={t("preview")} />
        <p className="text-xs">
          {t("size", {
            x: number(input.source.bounds.max[0] - input.source.bounds.min[0]),
            y: number(input.source.bounds.max[1] - input.source.bounds.min[1]),
          })}
        </p>
        <ul className="grid gap-1 text-xs">
          <li>{t("paths", { count: input.source.pathOutputs.length })}</li>
          <li>{t("closedPaths", { count: input.source.closedPaths })}</li>
          <li>{t("curves", { count: input.source.curves })}</li>
        </ul>
        {review.status === "error" && (
          <p role="status" className="text-sm text-destructive">
            {actions("applyFailed")}
          </p>
        )}
      </div>
      <footer className="flex justify-end gap-2 border-t px-4 py-3">
        {review.status === "error" ? (
          <Button variant="outline" onClick={() => automationReviews.dismiss(review.id)}>
            {actions("close")}
          </Button>
        ) : (
          <>
            <Button
              variant="outline"
              disabled={review.status !== "ready"}
              onClick={() => automationReviews.decide(review.id, "rejected")}
            >
              {actions("discard")}
            </Button>
            <Button
              disabled={review.status !== "ready"}
              isLoading={review.status === "applying"}
              onClick={() => automationReviews.decide(review.id, "approved")}
            >
              {actions("apply")}
            </Button>
          </>
        )}
      </footer>
    </section>
  )
}
