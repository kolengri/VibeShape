import type { DocumentControllerState } from "../document/document-controller"
import { DocumentExportDialog } from "../document/document-export-dialog"
import { ImportDialog } from "../features/import/import-dialog"
import { LibraryDialog } from "../features/library/library-dialog"
import { PlanarImportDialog } from "../features/planar-import/import-dialog"
import { ApplicationMenu, type ApplicationMenuDialogProps } from "./application-menu"
import { ExtensionsDialog } from "./extensions-dialog"
import { useViewerPreferences } from "./viewer-preferences"

type EditorApplicationMenuProps = {
  controller: DocumentControllerState
  hideModelExport?: boolean
  blockedReason: string | null
  unitChangesBlocked: boolean
  busy?: boolean
  remoteEndpoint?: string | undefined
  onOpenCommandPalette: (returnFocusTarget: HTMLElement) => void
  onOpenShortcutHelp: (returnFocusTarget: HTMLElement) => void
}

export function EditorApplicationMenu(props: EditorApplicationMenuProps) {
  return (
    <ApplicationMenu
      {...props}
      renderDialogs={(dialog) => <EditorApplicationDialogs {...props} {...dialog} />}
    />
  )
}

function EditorApplicationDialogs({
  controller,
  hideModelExport = false,
  unitChangesBlocked,
  dialog,
  onOpenChange,
  onCloseAutoFocus,
}: EditorApplicationMenuProps & ApplicationMenuDialogProps) {
  const preferredFormat = useViewerPreferences((state) => state.preferredExportFormat)
  return (
    <>
      {!hideModelExport && (
        <DocumentExportDialog
          controller={controller}
          preferredFormat={preferredFormat}
          showTrigger={false}
          open={dialog === "export"}
          onOpenChange={onOpenChange}
          onCloseAutoFocus={onCloseAutoFocus}
        />
      )}
      <ImportDialog
        controller={controller}
        blocked={unitChangesBlocked}
        showTrigger={false}
        open={dialog === "source-import"}
        onOpenChange={onOpenChange}
        onCloseAutoFocus={onCloseAutoFocus}
      />
      <PlanarImportDialog
        controller={controller}
        blocked={unitChangesBlocked}
        showTrigger={false}
        open={dialog === "planar-import"}
        onOpenChange={onOpenChange}
        onCloseAutoFocus={onCloseAutoFocus}
      />
      <LibraryDialog
        controller={controller}
        blocked={unitChangesBlocked}
        showTrigger={false}
        open={dialog === "library"}
        onOpenChange={onOpenChange}
        onCloseAutoFocus={onCloseAutoFocus}
      />
      <ExtensionsDialog
        open={dialog === "extensions"}
        onOpenChange={onOpenChange}
        onCloseAutoFocus={onCloseAutoFocus}
      />
    </>
  )
}
