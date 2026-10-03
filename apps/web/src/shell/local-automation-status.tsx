import { useTranslations } from "@vibeshape/i18n"
import { Button } from "@vibeshape/ui/components/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@vibeshape/ui/components/dialog"
import { useId, useState } from "react"
import type { createLocalAutomationConnection } from "../automation/local-automation-connection"

type Connection = ReturnType<typeof createLocalAutomationConnection>

export function LocalAutomationStatus({
  connection,
  current,
}: {
  connection: Pick<Connection, "enable" | "disable" | "enableAutoApply">
  current: ReturnType<Connection["getSnapshot"]>
}) {
  const t = useTranslations("app.shell.applicationBar")
  const [open, setOpen] = useState(false)
  const [failed, setFailed] = useState(false)
  const stopDescriptionId = useId()
  const action = current.connected
    ? { label: "disableAi" as const, run: connection.disable, disabled: false }
    : { label: "enableAi" as const, run: connection.enable, disabled: current.client === null }

  return (
    <div className="flex shrink-0 items-center gap-1">
      {current.connected && current.autoApply ? (
        <>
          <span role="status" className="whitespace-nowrap text-xs font-medium text-primary">
            {t("autoApplyOn")}
          </span>
          <Button
            type="button"
            size="xs"
            variant="destructive"
            aria-describedby={stopDescriptionId}
            title={t("stopAiDescription")}
            onClick={connection.disable}
          >
            {t("stopAi")}
          </Button>
          <span id={stopDescriptionId} className="sr-only">
            {t("stopAiDescription")}
          </span>
        </>
      ) : (
        <Button
          type="button"
          size="xs"
          variant="outline"
          aria-label={t(action.label)}
          title={t(action.label)}
          disabled={action.disabled}
          onClick={action.run}
        >
          <span className="sm:hidden">{t(current.connected ? "aiConnectedShort" : "aiShort")}</span>
          <span className="hidden sm:inline">{t(action.label)}</span>
        </Button>
      )}
      {current.connected && !current.autoApply ? (
        <Dialog
          open={open}
          onOpenChange={(next) => {
            setOpen(next)
            setFailed(false)
          }}
        >
          <DialogTrigger asChild>
            <Button type="button" size="xs" variant="outline" aria-label={t("autoApplySetup")}>
              <span className="sm:hidden">{t("autoApplySetupShort")}</span>
              <span className="hidden sm:inline">{t("autoApplySetup")}</span>
            </Button>
          </DialogTrigger>
          <DialogContent
            closeLabel={t("autoApplyCancel")}
            className="flex flex-col overflow-hidden p-4"
          >
            <DialogHeader className="shrink-0">
              <DialogTitle>{t("autoApplySetup")}</DialogTitle>
              <DialogDescription>{t("autoApplyScope")}</DialogDescription>
            </DialogHeader>
            <section
              aria-label={t("autoApplySetup")}
              className="min-h-0 space-y-3 overflow-y-auto text-sm"
              // biome-ignore lint/a11y/noNoninteractiveTabindex: Keyboard users must be able to scroll the consent details.
              tabIndex={0}
            >
              <p>{t("autoApplyEdits")}</p>
              <p>{t("autoApplyManual")}</p>
              <p>{t("autoApplyExcluded")}</p>
              <p>{t("autoApplyReset")}</p>
              <p>{t("stopAiDescription")}</p>
            </section>
            {failed ? (
              <p role="alert" className="shrink-0 text-sm text-destructive">
                {t("autoApplyBusy")}
              </p>
            ) : null}
            <DialogFooter className="shrink-0">
              <DialogClose asChild>
                <Button type="button" variant="outline">
                  {t("autoApplyCancel")}
                </Button>
              </DialogClose>
              <Button
                type="button"
                onClick={() => {
                  if (connection.enableAutoApply()) setOpen(false)
                  else setFailed(true)
                }}
              >
                {t("autoApplyEnable")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
      <span
        className="hidden max-w-32 truncate text-xs text-muted-foreground lg:block"
        title={current.client?.name}
      >
        {current.client?.name}
      </span>
      {current.error ? (
        <span
          role="status"
          className="sr-only text-destructive sm:not-sr-only sm:max-w-48 sm:text-xs"
        >
          {t("aiConnectionFailed")}
        </span>
      ) : null}
    </div>
  )
}
