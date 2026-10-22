import { useTranslations } from "@vibeshape/i18n"
import type { ReactNode } from "react"
import { TaskPanelLayout } from "../components/task-panel-layout"

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
      className="flex min-h-0 min-w-0 flex-col overflow-hidden border-l bg-panel"
    >
      <TaskPanelLayout title={t("title")} actions={props.actions}>
        <section aria-label={t("changes")} className="min-w-0">
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
      </TaskPanelLayout>
    </section>
  )
}
