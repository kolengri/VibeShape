import { useTranslations } from "@vibeshape/i18n"
import { Alert } from "@vibeshape/ui/components/alert"
import { Button } from "@vibeshape/ui/components/button"
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@vibeshape/ui/components/dialog"
import { type DialogOpenProps, useDialogOpen } from "../../components/use-dialog-open"
import type { DocumentControllerState } from "../../document/document-controller"
import { LibraryBrowserPanel } from "./library-browser"
import { LibraryItemSummary } from "./library-fields"
import { LibraryInsertForm, LibraryMetadataForm } from "./library-item-actions"
import { libraryDocumentWritable, librarySources } from "./library-model"
import { LibraryReferences } from "./library-references"
import { LibrarySaveForm } from "./library-save-form"
import { type LibraryAction, useLibraryAction } from "./use-library-action"
import { useLibraryBrowser } from "./use-library-browser"

function LibraryTask({
  controller,
  blocked,
  onClose,
  action,
}: {
  controller: DocumentControllerState
  blocked: boolean
  onClose: () => void
  action: LibraryAction
}) {
  const t = useTranslations("app.library")
  const browser = useLibraryBrowser(t("operationFailed"))
  const writable = libraryDocumentWritable(controller, blocked)
  const selection = browser.selection
  return (
    <>
      <DialogBody>
        {!writable && (
          <p role="status" className="rounded-md border p-3 text-sm">
            {t("documentBlocked")}
          </p>
        )}
        <div className="grid gap-5 lg:grid-cols-2">
          <div className="grid content-start gap-4">
            <LibraryBrowserPanel browser={browser} pending={action.pending} />
            <LibrarySaveForm
              sources={librarySources(controller)}
              browser={browser}
              action={action}
              writable={writable}
            />
          </div>
          <div className="grid content-start gap-4">
            {selection ? (
              <>
                <LibraryItemSummary item={selection.item} version={selection.version.version} />
                <LibraryInsertForm
                  key={`insert:${selection.item.id}:${selection.version.version}`}
                  selection={selection}
                  action={action}
                  writable={writable}
                />
                <LibraryMetadataForm
                  key={`metadata:${selection.item.id}:${selection.item.metadataRevision}`}
                  selection={selection}
                  browser={browser}
                  action={action}
                  writable={writable}
                />
              </>
            ) : (
              <p className="text-sm text-muted-foreground">{t("chooseItem")}</p>
            )}
            <LibraryReferences
              controller={controller}
              selection={selection}
              action={action}
              writable={writable}
            />
          </div>
        </div>
        {action.error && <Alert>{t("operationError", { message: action.error })}</Alert>}
        {action.notice && (
          <p role="status" className="text-sm">
            {action.notice}
          </p>
        )}
      </DialogBody>
      <DialogFooter>
        <Button type="button" variant="outline" disabled={action.pending} onClick={onClose}>
          {t("close")}
        </Button>
      </DialogFooter>
    </>
  )
}
export function LibraryDialog({
  controller,
  blocked,
  showTrigger = true,
  open: controlledOpen,
  onOpenChange,
  onCloseAutoFocus,
}: DialogOpenProps & {
  controller: DocumentControllerState
  blocked: boolean
}) {
  const t = useTranslations("app.library")
  const [open, setOpen] = useDialogOpen(controlledOpen, onOpenChange)
  const action = useLibraryAction(controller, t("staleDocument"), t("operationFailed"))
  const pending = action.pending
  const close = () => {
    if (!action.isPending()) setOpen(false)
  }
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!action.isPending()) setOpen(next)
      }}
    >
      {showTrigger ? (
        <DialogTrigger asChild>
          <Button type="button" variant="outline" size="sm">
            {t("trigger")}
          </Button>
        </DialogTrigger>
      ) : null}
      <DialogContent
        onCloseAutoFocus={onCloseAutoFocus}
        className="sm:max-w-4xl"
        closeLabel={t("close")}
        showCloseButton={!pending}
        onEscapeKeyDown={(event) => {
          if (pending) event.preventDefault()
        }}
        onInteractOutside={(event) => {
          if (pending) event.preventDefault()
        }}
      >
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </DialogHeader>
        {open && (
          <LibraryTask controller={controller} blocked={blocked} onClose={close} action={action} />
        )}
      </DialogContent>
    </Dialog>
  )
}
