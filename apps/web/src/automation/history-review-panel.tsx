import type { HistoryReviewInput } from "@vibeshape/automation-host/history-session"
import { useTranslations } from "@vibeshape/i18n"
import type { ReactNode } from "react"

export function HistoryAutomationReviewPanel({
  input,
  client,
  diagnostic,
  actions,
}: {
  input: HistoryReviewInput
  client: string
  diagnostic: ReactNode
  actions: ReactNode
}) {
  const t = useTranslations("app.shell.taskPanel.automationReview")
  const succeeded = input.preview.measurements.features.filter(
    (feature) => feature.status === "succeeded",
  ).length
  const failed = input.preview.measurements.features.filter(
    (feature) => feature.status === "failed" || feature.status === "blocked",
  ).length
  return (
    <section
      aria-label={t("title")}
      className="grid h-full max-h-full min-h-0 min-w-0 grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden border-l bg-panel"
    >
      <header className="border-b px-4 py-3">
        <h2 className="text-sm font-medium">{t("title")}</h2>
      </header>
      <section
        aria-label={t("changes")}
        className="min-h-0 min-w-0 overflow-auto overscroll-contain p-4"
      >
        {diagnostic}
        <h3 className="text-sm font-medium">
          {t(input.request.direction === "undo" ? "undoModel" : "redoModel")}
        </h3>
        <p className="mt-2 text-xs text-muted-foreground">{t("historyReviewDescription")}</p>
        <dl className="mt-4 grid gap-2 text-sm">
          <div className="flex justify-between gap-3">
            <dt>{t("client")}</dt>
            <dd className="break-all">{client}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt>{t("document")}</dt>
            <dd className="break-words">{input.documentName}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt>{t("baseRevision")}</dt>
            <dd>{input.draft.baseRevision}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt>{t("historyTargetRevision")}</dt>
            <dd>{input.draft.targetRevision}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt>{t("historyPublicationRevision")}</dt>
            <dd>{input.draft.baseRevision + 1}</dd>
          </div>
        </dl>
        <section className="mt-4 border-t pt-3">
          <h3 className="text-xs font-medium">{t("historyExactPreview")}</h3>
          <p className="mt-2 text-xs">{t("historyFeatureCount", { count: input.featureCount })}</p>
          <p className="mt-2 text-xs">{t("historyPartCount", { count: input.partCount })}</p>
          <p className="mt-2 text-xs">{t("historyGeometryCount", { succeeded, failed })}</p>
          {!input.preview.valid ? (
            <p className="mt-2 text-xs text-destructive">{t("historyGeometryInvalid")}</p>
          ) : null}
          {input.preview.assembly ? (
            <>
              <p className="mt-2 text-xs">
                {t("assemblyOccurrenceCount", { count: input.preview.assembly.occurrenceCount })}
              </p>
              <p className="mt-2 text-xs">
                {t("assemblyDof", { count: input.preview.assembly.degreesOfFreedom })}
              </p>
            </>
          ) : null}
        </section>
      </section>
      <div className="border-t px-4 py-3">{actions}</div>
    </section>
  )
}
