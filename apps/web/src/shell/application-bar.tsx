import { useTranslations } from "@vibeshape/i18n"
import { Button } from "@vibeshape/ui/components/button"
import { CommandIcon } from "@vibeshape/ui/components/icons"
import { Tooltip, TooltipContent, TooltipTrigger } from "@vibeshape/ui/components/tooltip"
import type { DocumentControllerState } from "../document/document-controller"
import { DocumentDisplayUnitsDialog } from "../document/document-display-units-dialog"
import { DocumentExportDialog } from "../document/document-export-dialog"
import { DocumentProjectDialog } from "../document/document-project-dialog"
import { DocumentRenameDialog } from "../document/document-rename-dialog"

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

export function ApplicationBar({
  controller,
  onOpenCommandPalette,
}: {
  controller: DocumentControllerState
  onOpenCommandPalette: (returnFocusTarget: HTMLElement) => void
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
      <span className="ml-auto text-xs text-muted-foreground" role="status">
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
      <DocumentExportDialog controller={controller} />
    </header>
  )
}
