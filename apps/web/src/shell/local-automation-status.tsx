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
} from "@vibeshape/ui/components/dialog"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@vibeshape/ui/components/dropdown-menu"
import { useId, useRef, useState } from "react"
import type { createLocalAutomationConnection } from "../automation/local-automation-connection"

type Connection = ReturnType<typeof createLocalAutomationConnection>

export function LocalAutomationStatus({
  connection,
  current,
}: {
  connection: Pick<
    Connection,
    "enable" | "disable" | "enableAutoApply" | "disableAutoApply" | "setProjectManagement"
  >
  current: ReturnType<Connection["getSnapshot"]>
}) {
  const t = useTranslations("app.shell.applicationBar")
  const [open, setOpen] = useState(false)
  const [failed, setFailed] = useState(false)
  const trigger = useRef<HTMLButtonElement>(null)
  const openingDialog = useRef(false)
  const projectScopeId = useId()
  return (
    <div className="flex shrink-0 items-center gap-1">
      {current.connected ? (
        <Dialog
          open={open}
          onOpenChange={(next) => {
            setOpen(next)
            setFailed(false)
          }}
        >
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                ref={trigger}
                type="button"
                size="xs"
                variant="ghost"
                aria-label={t("approvalSettings")}
              >
                <span role="status" className="whitespace-nowrap">
                  {t("approvalStatus", {
                    mode: t(current.autoApply ? "autoApplyOn" : "manualApproval"),
                  })}
                </span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              side="top"
              align="end"
              onCloseAutoFocus={(event) => {
                if (openingDialog.current) {
                  event.preventDefault()
                  openingDialog.current = false
                }
              }}
            >
              <p className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
                {current.client?.name ?? t("aiConnectedShort")}
              </p>
              <DropdownMenuRadioGroup value={current.autoApply ? "automatic" : "manual"}>
                <DropdownMenuRadioItem
                  value="manual"
                  disabled={current.busy}
                  onSelect={() => {
                    if (current.autoApply) setFailed(!connection.disableAutoApply())
                  }}
                >
                  {t("manualApproval")}
                </DropdownMenuRadioItem>
                <DropdownMenuRadioItem
                  value="automatic"
                  disabled={current.busy}
                  onSelect={() => {
                    if (!current.autoApply) {
                      setFailed(false)
                      openingDialog.current = true
                      setOpen(true)
                    }
                  }}
                >
                  {t("automaticApproval")}
                </DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
              <DropdownMenuSeparator />
              <DropdownMenuCheckboxItem
                checked={current.projectManagement}
                disabled={current.busy}
                aria-describedby={projectScopeId}
                onCheckedChange={(enabled) => {
                  setFailed(!connection.setProjectManagement(enabled === true))
                }}
              >
                {t("allowProjectManagement")}
              </DropdownMenuCheckboxItem>
              <p id={projectScopeId} className="max-w-72 px-2 py-1.5 text-xs text-muted-foreground">
                {t("projectManagementScope")}
              </p>
            </DropdownMenuContent>
          </DropdownMenu>
          <AutoApplyConsentContent
            failed={failed}
            onClose={() => trigger.current?.focus()}
            onEnable={() => {
              if (connection.enableAutoApply()) {
                setFailed(false)
                setOpen(false)
              } else setFailed(true)
            }}
          />
        </Dialog>
      ) : (
        <InactiveConnectionStatus connection={connection} current={current} />
      )}
      <StopConnectionControl connection={connection} current={current} />
      {failed && !open ? (
        <span role="alert" className="sr-only">
          {t("autoApplyBusy")}
        </span>
      ) : null}
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
function InactiveConnectionStatus({
  connection,
  current,
}: {
  connection: Pick<Connection, "enable">
  current: ReturnType<Connection["getSnapshot"]>
}) {
  const t = useTranslations("app.shell.applicationBar")
  return current.recovering ? (
    <span role="status" className="px-2 text-xs text-muted-foreground">
      {t("aiRecovering")}
    </span>
  ) : (
    <Button
      type="button"
      size="xs"
      variant="ghost"
      aria-label={t("enableAi")}
      title={t("enableAi")}
      disabled={current.client === null}
      onClick={connection.enable}
    >
      {t("aiShort")}
    </Button>
  )
}
function StopConnectionControl({
  connection,
  current,
}: {
  connection: Pick<Connection, "disable">
  current: ReturnType<Connection["getSnapshot"]>
}) {
  const t = useTranslations("app.shell.applicationBar")
  if (!current.connected && !current.recovering) return null
  return (
    <Button
      type="button"
      size="xs"
      variant="ghost"
      title={t("stopAiDescription")}
      onClick={connection.disable}
    >
      {t("stopAi")}
    </Button>
  )
}

function AutoApplyConsentContent({
  failed,
  onClose,
  onEnable,
}: {
  failed: boolean
  onClose: () => void
  onEnable: () => void
}) {
  const t = useTranslations("app.shell.applicationBar")
  return (
    <DialogContent
      closeLabel={t("autoApplyCancel")}
      onCloseAutoFocus={(event) => {
        event.preventDefault()
        onClose()
      }}
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
        <Button type="button" onClick={onEnable}>
          {t("autoApplyEnable")}
        </Button>
      </DialogFooter>
    </DialogContent>
  )
}
