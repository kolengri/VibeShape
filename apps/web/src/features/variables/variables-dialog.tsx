import { useTranslations } from "@vibeshape/i18n"
import { Button } from "@vibeshape/ui/components/button"
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@vibeshape/ui/components/dialog"
import { useState } from "react"
import type { DocumentControllerState } from "../../document/document-controller"
import { CustomizerPanel } from "./customizer-panel"
import { FitClearancePanel } from "./fit-clearance-panel"
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
  const customizer = useTranslations("app.customizer")
  const fit = useTranslations("app.printFit")
  const [tab, setTab] = useState<"variables" | "customizer" | "fit">("variables")
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
        <fieldset
          className="flex flex-wrap gap-2 border-b px-6 pb-3"
          aria-label={customizer("views")}
        >
          <Button
            type="button"
            variant={tab === "variables" ? "secondary" : "ghost"}
            disabled={pending}
            aria-pressed={tab === "variables"}
            onClick={() => setTab("variables")}
          >
            {t("title")}
          </Button>
          <Button
            type="button"
            variant={tab === "customizer" ? "secondary" : "ghost"}
            disabled={pending}
            aria-pressed={tab === "customizer"}
            onClick={() => setTab("customizer")}
          >
            {customizer("title")}
          </Button>
          <Button
            type="button"
            variant={tab === "fit" ? "secondary" : "ghost"}
            disabled={pending}
            aria-pressed={tab === "fit"}
            onClick={() => setTab("fit")}
          >
            {fit("title")}
          </Button>
        </fieldset>

        {tab === "variables" ? (
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
        ) : tab === "customizer" ? (
          <CustomizerPanel
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
        ) : (
          <>
            <DialogBody>
              <FitClearancePanel controller={controller} />
            </DialogBody>
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
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
