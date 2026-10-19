import { useTranslations } from "@vibeshape/i18n"
import { Button } from "@vibeshape/ui/components/button"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@vibeshape/ui/components/dialog"
import type { DocumentControllerState } from "../../document/document-controller"
import { VariablesPanel } from "./variables-panel"

export function VariablesDialog({
  controller,
  open,
  onOpenChange,
  onCloseAutoFocus,
}: {
  controller: DocumentControllerState
  open: boolean
  onOpenChange: (open: boolean) => void
  onCloseAutoFocus?: ((event: Event) => void) | undefined
}) {
  const t = useTranslations("app.variables")
  const pending = controller.saveStatus === "saving"
  const changeOpen = (next: boolean) => {
    if (!pending) onOpenChange(next)
  }
  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogContent
        className="max-w-4xl"
        closeLabel={t("actions.close")}
        showCloseButton={!pending}
        onCloseAutoFocus={onCloseAutoFocus}
        aria-describedby={undefined}
      >
        <DialogHeader className="sr-only">
          <DialogTitle>{t("title")}</DialogTitle>
        </DialogHeader>
        <VariablesPanel controller={controller} />
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            disabled={pending}
            onClick={() => changeOpen(false)}
          >
            {t("actions.close")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
