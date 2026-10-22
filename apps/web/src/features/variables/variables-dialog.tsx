import { useTranslations } from "@vibeshape/i18n"
import { Button } from "@vibeshape/ui/components/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
      >
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </DialogHeader>
        <VariablesPanel
          controller={controller}
          closeAction={
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={() => changeOpen(false)}
            >
              {t("actions.close")}
            </Button>
          }
        />
      </DialogContent>
    </Dialog>
  )
}
