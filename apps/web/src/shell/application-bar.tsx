import { useTranslations } from "@vibeshape/i18n"
import { Button } from "@vibeshape/ui/components/button"
import { CommandIcon, Keyboard } from "@vibeshape/ui/components/icons"
import { Tooltip, TooltipContent, TooltipTrigger } from "@vibeshape/ui/components/tooltip"
import { useEffect, useState, useSyncExternalStore } from "react"
import { createLocalAutomationConnection } from "../automation/local-automation-connection"
import type { DocumentControllerState } from "../document/document-controller"
import { DocumentDisplayUnitsDialog } from "../document/document-display-units-dialog"
import { DocumentExportDialog } from "../document/document-export-dialog"
import { DocumentProjectDialog } from "../document/document-project-dialog"
import { DocumentRenameDialog } from "../document/document-rename-dialog"
import { WorkspaceLayoutSettings } from "./workspace-layout-settings"

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

function LocalAutomationControl({ controller }: { controller: DocumentControllerState }) {
  const [connection] = useState(createLocalAutomationConnection)
  const current = useSyncExternalStore(
    connection.subscribe,
    connection.getSnapshot,
    connection.getSnapshot,
  )
  useEffect(() => {
    connection.start()
    void connection.status()
    return connection.dispose
  }, [connection])
  if (!current.available || controller.status !== "ready") return null
  return <LocalAutomationStatus connection={connection} current={current} />
}

function LocalAutomationStatus({
  connection,
  current,
}: {
  connection: ReturnType<typeof createLocalAutomationConnection>
  current: ReturnType<ReturnType<typeof createLocalAutomationConnection>["getSnapshot"]>
}) {
  const t = useTranslations("app.shell.applicationBar")
  const action = current.connected
    ? { label: "disableAi" as const, run: connection.disable, disabled: false }
    : { label: "enableAi" as const, run: connection.enable, disabled: current.client === null }
  const clientName = current.client?.name

  return (
    <div className="flex shrink-0 items-center gap-1">
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={action.disabled}
        onClick={action.run}
      >
        {t(action.label)}
      </Button>
      <span
        className="hidden max-w-32 truncate text-xs text-muted-foreground lg:block"
        title={clientName}
      >
        {clientName}
      </span>
      {current.error ? (
        <span role="status" className="max-w-48 text-xs text-destructive">
          {t("aiConnectionFailed")}
        </span>
      ) : null}
    </div>
  )
}

export function ApplicationBar({
  controller,
  onOpenCommandPalette,
  onOpenShortcutHelp,
}: {
  controller: DocumentControllerState
  onOpenCommandPalette: (returnFocusTarget: HTMLElement) => void
  onOpenShortcutHelp: (returnFocusTarget: HTMLElement) => void
}) {
  const t = useTranslations("app.shell.applicationBar")
  const commandsT = useTranslations("app.commands")
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
      <DocumentRenameDialog controller={controller} />
      <DocumentDisplayUnitsDialog controller={controller} />
      <WorkspaceLayoutSettings />
      <LocalAutomationControl controller={controller} />
      <span className="ml-auto min-w-0 truncate text-xs text-muted-foreground" role="status">
        {saveStatus}
      </span>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            aria-label={commandsT("open")}
            onClick={(event) => onOpenCommandPalette(event.currentTarget)}
          >
            <CommandIcon aria-hidden="true" />
          </Button>
        </TooltipTrigger>
        <TooltipContent className="flex items-center gap-3">
          <span>{commandsT("open")}</span>
          <kbd className="rounded border bg-muted px-1 font-mono text-[10px] text-muted-foreground">
            {commandsT("openShortcut")}
          </kbd>
        </TooltipContent>
      </Tooltip>
      <DocumentProjectDialog controller={controller} />
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            data-shortcut-help-trigger
            aria-label={commandsT("shortcutHelp.title")}
            onClick={(event) => onOpenShortcutHelp(event.currentTarget)}
          >
            <Keyboard aria-hidden="true" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          {commandsT("shortcutHelp.title")} <kbd>F1</kbd>
        </TooltipContent>
      </Tooltip>
      <DocumentExportDialog controller={controller} />
    </header>
  )
}
