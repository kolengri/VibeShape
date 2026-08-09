import { useTranslations } from "@vibeshape/i18n"
import type { DocumentControllerState } from "../document/document-controller"
import { DocumentExportDialog } from "../document/document-export-dialog"
import { DocumentProjectDialog } from "../document/document-project-dialog"

function saveStatusMessage(
  controller: DocumentControllerState,
  messages: {
    loading: string
    saved: string
    saving: string
    "save-error": string
  },
) {
  const loadingStatuses = new Set<DocumentControllerState["status"]>(["idle", "loading"])
  const messageKey = loadingStatuses.has(controller.status) ? "loading" : controller.saveStatus
  return messages[messageKey]
}

export function ApplicationBar({ controller }: { controller: DocumentControllerState }) {
  const t = useTranslations("app.shell.applicationBar")
  const documentName = controller.report?.snapshot.name ?? t("untitledProject")
  const saveStatus = saveStatusMessage(controller, {
    loading: t("loading"),
    saved: t("savedInBrowser"),
    saving: t("saving"),
    "save-error": t("saveFailed"),
  })

  return (
    <header className="flex min-w-0 items-center gap-3 border-b bg-toolbar px-2">
      <strong className="truncate text-sm">VibeShape</strong>
      <span className="truncate text-muted-foreground">{documentName}</span>
      <span className="ml-auto text-xs text-muted-foreground" role="status">
        {saveStatus}
      </span>
      <DocumentProjectDialog controller={controller} />
      <DocumentExportDialog controller={controller} />
    </header>
  )
}
