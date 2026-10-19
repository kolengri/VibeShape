import { useTranslations } from "@vibeshape/i18n"
import type { ReactNode } from "react"
import { getDesktopHost } from "../desktop/desktop-host"
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
  projectNavigation,
  controller,
  onOpenCommandPalette,
  onOpenShortcutHelp,
  hideModelExport = false,
}: {
  children?: ReactNode
  projectNavigation?: ReactNode
  controller: DocumentControllerState
  hideModelExport?: boolean
  onOpenCommandPalette: (returnFocusTarget: HTMLElement) => void
  onOpenShortcutHelp: (returnFocusTarget: HTMLElement) => void
}) {
  const t = useTranslations("app.shell.applicationBar")
  const desktop = getDesktopHost()
  const unifiedChrome = desktop?.platform === "darwin" && desktop.windowChrome === "unified"
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
    saved: t("saved"),
    saving: t("saving"),
    "save-error": t("saveFailed"),
  })

  return (
    <header
      data-unified-chrome={unifiedChrome || undefined}
      className="application-bar grid min-w-0 grid-cols-[auto_minmax(0,1fr)] grid-rows-2 items-center gap-x-1 border-b bg-toolbar px-2 sm:flex sm:gap-3"
    >
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
        {projectNavigation ?? (
          <span className="min-w-0 truncate text-muted-foreground" title={documentName}>
            {documentName}
          </span>
        )}
        <DocumentRenameDialog controller={controller} />
      </div>
      <div className="col-span-2 flex min-w-0 items-center justify-end gap-1 sm:shrink-0">
        {children}
      </div>
      <span
        className={
          controller.status === "ready" && controller.saveStatus !== "save-error"
            ? "sr-only"
            : "sr-only sm:not-sr-only sm:ml-auto sm:min-w-0 sm:truncate sm:text-xs sm:text-muted-foreground"
        }
        role="status"
        aria-label={t("saveStatusLabel")}
      >
        {saveStatus}
      </span>
    </header>
  )
}
