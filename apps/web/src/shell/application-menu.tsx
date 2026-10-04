import { useTranslations } from "@vibeshape/i18n"
import { Button } from "@vibeshape/ui/components/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@vibeshape/ui/components/dropdown-menu"
import {
  ChevronDown,
  CommandIcon,
  Download,
  FolderOpen,
  Keyboard,
  Settings,
} from "@vibeshape/ui/components/icons"
import { useRef, useState } from "react"
import type { DocumentControllerState } from "../document/document-controller"
import { DocumentExportDialog } from "../document/document-export-dialog"
import { DocumentProjectDialog } from "../document/document-project-dialog"
import { ImportDialog } from "../features/import/import-dialog"
import { LibraryDialog } from "../features/library/library-dialog"
import { PlanarImportDialog } from "../features/planar-import/import-dialog"
import { FaqDialog } from "./faq-dialog"
import { SettingsDialog } from "./settings-dialog"
import { useViewerPreferences } from "./viewer-preferences"

type MenuDialog =
  | "projects"
  | "export"
  | "settings"
  | "faq"
  | "source-import"
  | "planar-import"
  | "library"

export function ApplicationMenu({
  controller,
  hideModelExport = false,
  blockedReason,
  unitChangesBlocked,
  remoteEndpoint,
  onOpenCommandPalette,
  onOpenShortcutHelp,
}: {
  controller: DocumentControllerState
  hideModelExport?: boolean
  blockedReason: string | null
  unitChangesBlocked: boolean
  remoteEndpoint?: string | undefined
  onOpenCommandPalette: (returnFocusTarget: HTMLElement) => void
  onOpenShortcutHelp: (returnFocusTarget: HTMLElement) => void
}) {
  const t = useTranslations("app.shell.applicationMenu")
  const commandsT = useTranslations("app.commands")
  const preferredFormat = useViewerPreferences((state) => state.preferredExportFormat)
  const [open, setOpen] = useState(false)
  const [dialog, setDialog] = useState<MenuDialog | null>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const openingCommandDialog = useRef(false)
  const closeDialogMenu = (event: Event) => {
    event.preventDefault()
    setOpen(false)
    trigger.current?.focus()
  }
  const launchDialog = (next: MenuDialog) => {
    openingCommandDialog.current = true
    setDialog(next)
  }
  const dialogOpenChange = (next: boolean) => {
    if (!next) setDialog(null)
  }
  return (
    <>
      <DropdownMenu open={open} onOpenChange={setOpen}>
        <DropdownMenuTrigger asChild>
          <Button
            ref={trigger}
            type="button"
            size="sm"
            variant="ghost"
            className="shrink-0 gap-1 px-2"
            aria-label={t("trigger")}
            data-application-menu-trigger
          >
            <strong className="text-sm">VibeShape</strong>
            <ChevronDown aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          className="max-h-[calc(100svh-4rem)] w-64 max-w-[calc(100vw-1rem)] overflow-y-auto"
          align="start"
          onCloseAutoFocus={(event) => {
            if (openingCommandDialog.current) {
              event.preventDefault()
              openingCommandDialog.current = false
            }
          }}
        >
          <DropdownMenuGroup aria-label={t("project")}>
            <p className="px-2 py-1.5 text-xs font-medium text-muted-foreground">{t("project")}</p>
            <DropdownMenuItem aria-haspopup="dialog" onSelect={() => launchDialog("projects")}>
              <FolderOpen aria-hidden="true" />
              {t("files")}
            </DropdownMenuItem>
            <DropdownMenuItem
              aria-haspopup="dialog"
              disabled={unitChangesBlocked}
              onSelect={() => launchDialog("source-import")}
            >
              {t("importGeometry")}
            </DropdownMenuItem>
            <DropdownMenuItem
              aria-haspopup="dialog"
              disabled={unitChangesBlocked}
              onSelect={() => launchDialog("planar-import")}
            >
              {t("importSketch")}
            </DropdownMenuItem>
            <DropdownMenuItem
              aria-haspopup="dialog"
              disabled={controller.status !== "ready"}
              onSelect={() => launchDialog("library")}
            >
              {t("library")}
            </DropdownMenuItem>
            {!hideModelExport && (
              <DropdownMenuItem
                aria-haspopup="dialog"
                disabled={controller.status !== "ready" || controller.report === null}
                onSelect={() => launchDialog("export")}
              >
                <Download aria-hidden="true" />
                {t("export")}
              </DropdownMenuItem>
            )}
          </DropdownMenuGroup>
          <DropdownMenuGroup aria-label={t("workspace")} className="mt-1 border-t pt-1">
            <p className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
              {t("workspace")}
            </p>
            <DropdownMenuItem aria-haspopup="dialog" onSelect={() => launchDialog("settings")}>
              <Settings aria-hidden="true" />
              {t("settings")}
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => {
                if (trigger.current) {
                  openingCommandDialog.current = true
                  onOpenCommandPalette(trigger.current)
                }
              }}
            >
              <CommandIcon aria-hidden="true" />
              {commandsT("open")}
              <kbd className="ml-auto text-xs text-muted-foreground">
                {commandsT("openShortcut")}
              </kbd>
            </DropdownMenuItem>
          </DropdownMenuGroup>
          <DropdownMenuGroup aria-label={t("help")} className="mt-1 border-t pt-1">
            <p className="px-2 py-1.5 text-xs font-medium text-muted-foreground">{t("help")}</p>
            <DropdownMenuItem aria-haspopup="dialog" onSelect={() => launchDialog("faq")}>
              {t("faq")}
            </DropdownMenuItem>
            <DropdownMenuItem
              data-shortcut-help-trigger
              onSelect={() => {
                if (trigger.current) {
                  openingCommandDialog.current = true
                  onOpenShortcutHelp(trigger.current)
                }
              }}
            >
              <Keyboard aria-hidden="true" />
              {commandsT("shortcutHelp.title")}
              <kbd className="ml-auto text-xs text-muted-foreground">F1</kbd>
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      <DocumentProjectDialog
        controller={controller}
        blockedReason={blockedReason}
        showTrigger={false}
        open={dialog === "projects"}
        onOpenChange={dialogOpenChange}
        onCloseAutoFocus={closeDialogMenu}
      />
      {!hideModelExport && (
        <DocumentExportDialog
          controller={controller}
          preferredFormat={preferredFormat}
          showTrigger={false}
          open={dialog === "export"}
          onOpenChange={dialogOpenChange}
          onCloseAutoFocus={closeDialogMenu}
        />
      )}
      <ImportDialog
        controller={controller}
        blocked={unitChangesBlocked}
        showTrigger={false}
        open={dialog === "source-import"}
        onOpenChange={dialogOpenChange}
        onCloseAutoFocus={closeDialogMenu}
      />
      <PlanarImportDialog
        controller={controller}
        blocked={unitChangesBlocked}
        showTrigger={false}
        open={dialog === "planar-import"}
        onOpenChange={dialogOpenChange}
        onCloseAutoFocus={closeDialogMenu}
      />
      <LibraryDialog
        controller={controller}
        blocked={unitChangesBlocked}
        showTrigger={false}
        open={dialog === "library"}
        onOpenChange={dialogOpenChange}
        onCloseAutoFocus={closeDialogMenu}
      />
      <SettingsDialog
        controller={controller}
        blocked={unitChangesBlocked}
        showTrigger={false}
        open={dialog === "settings"}
        onOpenChange={dialogOpenChange}
        onCloseAutoFocus={closeDialogMenu}
      />
      <FaqDialog
        endpoint={remoteEndpoint}
        showTrigger={false}
        open={dialog === "faq"}
        onOpenChange={dialogOpenChange}
        onCloseAutoFocus={closeDialogMenu}
      />
    </>
  )
}
