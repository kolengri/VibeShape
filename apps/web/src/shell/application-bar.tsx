import { useTranslations } from "@vibeshape/i18n"
import type { ReactNode } from "react"
import {
  type DocumentControllerState,
  getProjectActionBlock,
  getProjectActiveWorkBlock,
} from "../document/document-controller"
import { DocumentRenameDialog } from "../document/document-rename-dialog"
import { ApplicationMenu } from "./application-menu"
import { useAutomationConnections } from "./automation-status"

function saveStatusMessage(
  controller: DocumentControllerState,
  messages: {
    error: string
    loading: string
    saved: string
    saving: string
    "save-error": string
  },
) {
  if (controller.status === "error") return messages.error
  const loadingStatuses = new Set<DocumentControllerState["status"]>(["idle", "loading"])
  const messageKey = loadingStatuses.has(controller.status) ? "loading" : controller.saveStatus
  return messages[messageKey]
}

export function ApplicationBar({
  children,
  controller,
  onOpenCommandPalette,
  onOpenShortcutHelp,
  hideModelExport = false,
}: {
  children?: ReactNode
  controller: DocumentControllerState
  hideModelExport?: boolean
  onOpenCommandPalette: (returnFocusTarget: HTMLElement) => void
  onOpenShortcutHelp: (returnFocusTarget: HTMLElement) => void
}) {
  const t = useTranslations("app.shell.applicationBar")
  const { remote } = useAutomationConnections()
  const blockedReason = getProjectActionBlock()
  const unitChangesBlocked =
    controller.status !== "ready" ||
    controller.saveStatus === "saving" ||
    getProjectActiveWorkBlock() !== null
  const documentName = controller.report?.snapshot.name ?? t("untitledProject")
  const saveStatus = saveStatusMessage(controller, {
    error: t("projectUnavailable"),
    loading: t("loading"),
    saved: t("savedInBrowser"),
    saving: t("saving"),
    "save-error": t("saveFailed"),
  })

  return (
    <header className="flex min-w-0 items-center gap-1 border-b bg-toolbar px-2 sm:gap-3">
      <ApplicationMenu
        controller={controller}
        hideModelExport={hideModelExport}
        blockedReason={blockedReason}
        unitChangesBlocked={unitChangesBlocked}
        remoteEndpoint={remote.available ? import.meta.env.VITE_REMOTE_MCP_URL : undefined}
        onOpenCommandPalette={onOpenCommandPalette}
        onOpenShortcutHelp={onOpenShortcutHelp}
      />
      <div className="flex min-w-0 flex-1 items-center gap-1">
        <span className="min-w-0 truncate text-muted-foreground" title={documentName}>
          {documentName}
        </span>
        <DocumentRenameDialog controller={controller} />
      </div>
      {children}
      <span
        className="sr-only sm:not-sr-only sm:ml-auto sm:min-w-0 sm:truncate sm:text-xs sm:text-muted-foreground"
        role="status"
      >
        {saveStatus}
      </span>
    </header>
  )
}
