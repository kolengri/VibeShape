import { useTranslations } from "@vibeshape/i18n"
import { useReportBlockingActivity } from "@vibeshape/ui/components/activity"
import { Button } from "@vibeshape/ui/components/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSections,
  DropdownMenuTrigger,
} from "@vibeshape/ui/components/dropdown-menu"
import {
  BackupIcon,
  ChevronDown,
  CommandIcon,
  Download,
  ExtensionsIcon,
  FilesIcon,
  HelpIcon,
  ImportGeometryIcon,
  ImportSketchIcon,
  Keyboard,
  LibraryIcon,
  NewProjectIcon,
  PenLine,
  Settings,
} from "@vibeshape/ui/components/icons"
import { type ReactNode, useRef, useState } from "react"
import { NativeApplicationCommandBridge } from "../desktop/native-editor-commands"
import {
  createNewLocalProject,
  type DocumentControllerState,
  getProjectActionBlock,
  getProjectNavigationBlock,
  type ProjectSwitchResult,
  showProjectLibrary,
} from "../document/document-controller"
import { DocumentRenameDialog, projectRenameAvailable } from "../document/document-rename-dialog"
import { useProjectBackup } from "../document/use-project-backup"
import { useReportApplicationError } from "./application-notices"
import { ApplicationWordmark } from "./application-wordmark"
import { FaqDialog } from "./faq-dialog"
import { ProjectBackupFeedback } from "./project-backup-progress"
import { SettingsDialog } from "./settings-dialog"

type MenuDialog =
  | "rename"
  | "export"
  | "settings"
  | "faq"
  | "source-import"
  | "planar-import"
  | "library"
  | "extensions"

export type ApplicationMenuDialogProps = {
  dialog: MenuDialog | null
  onOpenChange: (open: boolean) => void
  onCloseAutoFocus: (event: Event) => void
}

type ApplicationMenuProps = {
  controller: DocumentControllerState
  busy?: boolean
  remoteEndpoint?: string | undefined
} & (
  | { scope: "library" }
  | {
      scope?: "editor"
      hideModelExport?: boolean
      unitChangesBlocked: boolean
      onOpenCommandPalette: (returnFocusTarget: HTMLElement) => void
      onOpenShortcutHelp: (returnFocusTarget: HTMLElement) => void
      renderDialogs: (props: ApplicationMenuDialogProps) => ReactNode
    }
)

const libraryCommands = ["settings", "faq"] as const

function useProjectNavigation(failureMessage: string, loadingMessage: string) {
  const [navigating, setNavigating] = useState(false)
  const [navigationFailure, setNavigationFailure] = useState<string | null>(null)
  const [navigationAttempt, setNavigationAttempt] = useState(0)
  const message = navigationFailure
  const centralized = useReportApplicationError(message, navigationAttempt)
  const navigationPending = useRef(false)
  useReportBlockingActivity(navigating, loadingMessage)
  const navigateProjects = async (
    action: () => Promise<ProjectSwitchResult> = showProjectLibrary,
    actionFailureMessage = failureMessage,
  ) => {
    if (navigationPending.current) return
    navigationPending.current = true
    setNavigationAttempt((attempt) => attempt + 1)
    setNavigating(true)
    setNavigationFailure(null)
    try {
      const result = await action()
      if (!result.ok) setNavigationFailure(actionFailureMessage)
    } catch {
      setNavigationFailure(actionFailureMessage)
    } finally {
      navigationPending.current = false
      setNavigating(false)
    }
  }
  return { navigateProjects, navigating, error: centralized ? null : message }
}

function ApplicationProjectMenu({
  controller,
  unitChangesBlocked,
  hideModelExport,
  backup,
  navigation,
  launchDialog,
}: {
  controller: DocumentControllerState
  unitChangesBlocked: boolean
  hideModelExport: boolean
  backup: ReturnType<typeof useProjectBackup>
  navigation: ReturnType<typeof useProjectNavigation>
  launchDialog: (next: MenuDialog) => void
}) {
  const t = useTranslations("app.shell.applicationMenu")
  const backupT = useTranslations("app.projectFile.backup")
  const tabsT = useTranslations("app.projectTabs")
  const renameT = useTranslations("app.projectRename")
  return (
    <DropdownMenuGroup aria-label={t("project")}>
      <p className="px-2 py-1.5 text-xs font-medium text-muted-foreground">{t("project")}</p>
      <DropdownMenuItem
        disabled={
          navigation.navigating ||
          controller.status !== "ready" ||
          Boolean(getProjectNavigationBlock())
        }
        onSelect={() =>
          void navigation.navigateProjects(createNewLocalProject, t("projectCreationFailed"))
        }
      >
        <NewProjectIcon aria-hidden="true" />
        {tabsT("newProject")}
      </DropdownMenuItem>
      <DropdownMenuItem
        aria-haspopup="dialog"
        disabled={navigation.navigating || !projectRenameAvailable(controller)}
        onSelect={() => launchDialog("rename")}
      >
        <PenLine aria-hidden="true" />
        {renameT("title")}
      </DropdownMenuItem>
      <DropdownMenuItem
        disabled={navigation.navigating}
        onSelect={() => void navigation.navigateProjects()}
      >
        <FilesIcon aria-hidden="true" />
        {t("files")}
      </DropdownMenuItem>
      <DropdownMenuItem
        disabled={
          backup.pending || controller.status !== "ready" || Boolean(getProjectActionBlock())
        }
        aria-busy={backup.pending || undefined}
        onSelect={() => void backup.save()}
      >
        <BackupIcon aria-hidden="true" />
        {backupT("action")}
      </DropdownMenuItem>
      <DropdownMenuItem
        aria-haspopup="dialog"
        disabled={unitChangesBlocked}
        onSelect={() => launchDialog("source-import")}
      >
        <ImportGeometryIcon aria-hidden="true" />
        {t("importGeometry")}
      </DropdownMenuItem>
      <DropdownMenuItem
        aria-haspopup="dialog"
        disabled={unitChangesBlocked}
        onSelect={() => launchDialog("planar-import")}
      >
        <ImportSketchIcon aria-hidden="true" />
        {t("importSketch")}
      </DropdownMenuItem>
      <DropdownMenuItem
        aria-haspopup="dialog"
        disabled={controller.status !== "ready"}
        onSelect={() => launchDialog("library")}
      >
        <LibraryIcon aria-hidden="true" />
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
  )
}

function ApplicationWorkspaceMenu({
  editor,
  launchDialog,
  onOpenCommandPalette,
}: {
  editor: boolean
  launchDialog: (next: MenuDialog) => void
  onOpenCommandPalette: () => void
}) {
  const t = useTranslations("app.shell.applicationMenu")
  const commandsT = useTranslations("app.commands")
  return (
    <DropdownMenuGroup aria-label={t("workspace")}>
      <p className="px-2 py-1.5 text-xs font-medium text-muted-foreground">{t("workspace")}</p>
      <DropdownMenuItem aria-haspopup="dialog" onSelect={() => launchDialog("settings")}>
        <Settings aria-hidden="true" />
        {t("settings")}
      </DropdownMenuItem>
      {editor && (
        <>
          <DropdownMenuItem aria-haspopup="dialog" onSelect={() => launchDialog("extensions")}>
            <ExtensionsIcon aria-hidden="true" />
            {t("extensions")}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={onOpenCommandPalette}>
            <CommandIcon aria-hidden="true" />
            {commandsT("open")}
            <kbd className="ml-auto text-xs text-muted-foreground">{commandsT("openShortcut")}</kbd>
          </DropdownMenuItem>
        </>
      )}
    </DropdownMenuGroup>
  )
}

function ApplicationHelpMenu({
  editor,
  launchDialog,
  onOpenShortcutHelp,
}: {
  editor: boolean
  launchDialog: (next: MenuDialog) => void
  onOpenShortcutHelp: () => void
}) {
  const t = useTranslations("app.shell.applicationMenu")
  const commandsT = useTranslations("app.commands")
  return (
    <DropdownMenuGroup aria-label={t("help")}>
      <p className="px-2 py-1.5 text-xs font-medium text-muted-foreground">{t("help")}</p>
      <DropdownMenuItem aria-haspopup="dialog" onSelect={() => launchDialog("faq")}>
        <HelpIcon aria-hidden="true" />
        {t("faq")}
      </DropdownMenuItem>
      {editor && (
        <DropdownMenuItem data-shortcut-help-trigger onSelect={onOpenShortcutHelp}>
          <Keyboard aria-hidden="true" />
          {commandsT("shortcutHelp.title")}
          <kbd className="ml-auto text-xs text-muted-foreground">F1</kbd>
        </DropdownMenuItem>
      )}
    </DropdownMenuGroup>
  )
}

function ApplicationMenuDialogs({
  controller,
  editor,
  dialog,
  blocked,
  remoteEndpoint,
  onOpenChange,
  onCloseAutoFocus,
}: {
  controller: DocumentControllerState
  editor: Extract<ApplicationMenuProps, { unitChangesBlocked: boolean }> | null
  dialog: MenuDialog | null
  blocked: boolean
  remoteEndpoint: string | undefined
  onOpenChange: (open: boolean) => void
  onCloseAutoFocus: (event: Event) => void
}) {
  return (
    <>
      {dialog === "rename" && (
        <DocumentRenameDialog
          controller={controller}
          showTrigger={false}
          open
          onOpenChange={onOpenChange}
          onCloseAutoFocus={onCloseAutoFocus}
        />
      )}
      {editor?.renderDialogs({
        dialog,
        onOpenChange: onOpenChange,
        onCloseAutoFocus: onCloseAutoFocus,
      })}
      {dialog === "settings" && (
        <SettingsDialog
          controller={controller}
          blocked={blocked}
          showTrigger={false}
          open={dialog === "settings"}
          onOpenChange={onOpenChange}
          onCloseAutoFocus={onCloseAutoFocus}
        />
      )}
      {dialog === "faq" && (
        <FaqDialog
          endpoint={remoteEndpoint}
          showTrigger={false}
          open={dialog === "faq"}
          onOpenChange={onOpenChange}
          onCloseAutoFocus={onCloseAutoFocus}
        />
      )}
    </>
  )
}

function ApplicationMenuBrand({
  busy,
  controller,
}: {
  busy: boolean
  controller: DocumentControllerState
}) {
  return (
    <>
      <ApplicationWordmark
        busy={
          busy ||
          controller.status === "idle" ||
          controller.status === "loading" ||
          (controller.status === "ready" && controller.saveStatus === "saving")
        }
      />
      <ChevronDown aria-hidden="true" />
    </>
  )
}

export function ApplicationMenu(props: ApplicationMenuProps) {
  const { controller, busy = false, remoteEndpoint } = props
  const editor = props.scope === "library" ? null : props
  const hideModelExport = editor?.hideModelExport ?? false
  const unitChangesBlocked = editor?.unitChangesBlocked ?? true
  const t = useTranslations("app.shell.applicationMenu")
  const backup = useProjectBackup(controller)
  const [open, setOpen] = useState(false)
  const [dialog, setDialog] = useState<MenuDialog | null>(null)
  const navigation = useProjectNavigation(t("projectNavigationFailed"), t("openingProjects"))
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
  const openEditorCommand = (command: "palette" | "shortcuts") => {
    if (!trigger.current || !editor) return
    openingCommandDialog.current = true
    const open = command === "palette" ? editor.onOpenCommandPalette : editor.onOpenShortcutHelp
    open(trigger.current)
  }
  return (
    <>
      <NativeApplicationCommandBridge
        exportAvailable={
          editor !== null &&
          !hideModelExport &&
          controller.status === "ready" &&
          controller.report !== null
        }
        {...(!editor ? { allowedCommands: libraryCommands } : {})}
        onCommand={(command) => {
          if (command === "shortcuts") {
            if (trigger.current) editor?.onOpenShortcutHelp(trigger.current)
          } else if (command === "projects") void navigation.navigateProjects()
          else launchDialog(command)
        }}
      />
      {navigation.error && (
        <p role="alert" className="sr-only">
          {navigation.error}
        </p>
      )}
      <ProjectBackupFeedback pending={backup.pending} stage={backup.stage} error={backup.error} />
      <DropdownMenu open={open} onOpenChange={setOpen}>
        <DropdownMenuTrigger asChild>
          <Button
            ref={trigger}
            type="button"
            size="sm"
            variant="ghost"
            aria-label={t("trigger")}
            data-application-menu-trigger
          >
            <ApplicationMenuBrand busy={busy} controller={controller} />
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
          <DropdownMenuSections>
            {editor && (
              <ApplicationProjectMenu
                controller={controller}
                unitChangesBlocked={unitChangesBlocked}
                hideModelExport={hideModelExport}
                backup={backup}
                navigation={navigation}
                launchDialog={launchDialog}
              />
            )}
            <ApplicationWorkspaceMenu
              editor={editor !== null}
              launchDialog={launchDialog}
              onOpenCommandPalette={() => openEditorCommand("palette")}
            />
            <ApplicationHelpMenu
              editor={editor !== null}
              launchDialog={launchDialog}
              onOpenShortcutHelp={() => openEditorCommand("shortcuts")}
            />
          </DropdownMenuSections>
        </DropdownMenuContent>
      </DropdownMenu>
      <ApplicationMenuDialogs
        controller={controller}
        editor={editor}
        dialog={dialog}
        blocked={unitChangesBlocked}
        remoteEndpoint={remoteEndpoint}
        onOpenChange={dialogOpenChange}
        onCloseAutoFocus={closeDialogMenu}
      />
    </>
  )
}
