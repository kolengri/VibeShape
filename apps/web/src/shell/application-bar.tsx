import { useTranslations } from "@vibeshape/i18n"
import type { ReactNode } from "react"
import {
  type DocumentControllerState,
  getProjectActionBlock,
  getProjectActiveWorkBlock,
} from "../document/document-controller"
import { ApplicationHeader } from "./application-header"
import { useReportApplicationError } from "./application-notices"
import { useAutomationConnections } from "./automation-status"
import { EditorApplicationMenu as ApplicationMenu } from "./editor-application-menu"

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

function applicationBarActivity(controller: DocumentControllerState) {
  return {
    busy:
      controller.status === "loading" ||
      controller.status === "idle" ||
      controller.saveStatus === "saving",
    unitChangesBlocked:
      controller.status !== "ready" ||
      controller.saveStatus === "saving" ||
      getProjectActiveWorkBlock() !== null,
  }
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
  const { busy, unitChangesBlocked } = applicationBarActivity(controller)
  const { remote } = useAutomationConnections()
  const blockedReason = getProjectActionBlock()
  const documentName = controller.report?.snapshot.name ?? t("untitledProject")
  const saveStatus = saveStatusMessage(controller, {
    error: t("projectUnavailable"),
    loading: t("loading"),
    saved: t("saved"),
    saving: t("saving"),
    "save-error": t("saveFailed"),
  })
  useReportApplicationError(
    controller.status === "error" || controller.saveStatus === "save-error" ? saveStatus : null,
  )

  return (
    <ApplicationHeader
      busy={busy}
      className="grid grid-cols-[auto_minmax(0,1fr)] grid-rows-2 gap-x-1 sm:flex sm:gap-3"
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
          <span className="min-w-0 truncate text-muted-foreground">{documentName}</span>
        )}
      </div>
      <div className="col-span-2 flex min-w-0 items-center justify-end gap-1 sm:shrink-0">
        {children}
      </div>
      <span className="sr-only" role="status" aria-label={t("saveStatusLabel")}>
        {saveStatus}
      </span>
    </ApplicationHeader>
  )
}
