import { useTranslations } from "@vibeshape/i18n"
import type { ReactNode } from "react"

export function AutomationReviewFrame(props: {
  client: string
  documentName: string
  baseRevision: number
  description: string
  diagnostic: ReactNode
  actions: ReactNode
  children: ReactNode
}) {
  const t = useTranslations("app.shell.taskPanel.automationReview")
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
        {props.diagnostic}
        <p className="text-xs text-muted-foreground">{props.description}</p>
        <dl className="mt-4 grid gap-2 text-sm">
          <div className="flex justify-between gap-3">
            <dt>{t("client")}</dt>
            <dd className="break-all">{props.client}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt>{t("document")}</dt>
            <dd className="break-words">{props.documentName}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt>{t("baseRevision")}</dt>
            <dd>{props.baseRevision}</dd>
          </div>
        </dl>
        {props.children}
      </section>
      <div className="border-t px-4 py-3">{props.actions}</div>
    </section>
  )
}
