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
import { useEffect, useRef, useState } from "react"
import type { createRemoteAutomationConnection } from "../automation/remote-automation-connection"
import { TurnstileChallenge } from "../automation/turnstile-challenge"
import { LocalAutomationStatus } from "./local-automation-status"

type Connection = ReturnType<typeof createRemoteAutomationConnection>
export function RemoteAutomationStatus({
  connection,
  current,
  blocked,
}: {
  connection: Connection
  current: ReturnType<Connection["getSnapshot"]>
  blocked: boolean
}) {
  const t = useTranslations("app.shell.remoteAi")
  const [open, setOpen] = useState(false)
  const [siteKey, setSiteKey] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let alive = true
    if (open && !current.pairingCode && !current.connecting) {
      void connection
        .configuration()
        .then((configuration) => {
          if (alive) setSiteKey(configuration.siteKey)
        })
        .catch(() => {
          if (alive) setFailed(true)
        })
    }
    return () => {
      alive = false
    }
  }, [connection, open, current.pairingCode, current.connecting])
  useEffect(() => {
    if (current.consent) setOpen(false)
  }, [current.consent])
  return current.connected ? (
    <LocalAutomationStatus
      approvalLabel={t("approvalSettings")}
      connection={{
        enable: async () => false,
        disable: connection.disable,
        enableAutoApply: connection.enableAutoApply,
        disableAutoApply: connection.disableAutoApply,
        setProjectManagement: connection.setProjectManagement,
      }}
      current={{
        available: true,
        connected: true,
        recovering: false,
        autoApply: current.autoApply,
        projectManagement: current.projectManagement,
        busy: current.busy,
        client: { name: current.client?.name ?? "", version: "OAuth" },
        error: current.error,
      }}
    />
  ) : (
    <div className="flex shrink-0 items-center gap-1">
      <Dialog open={open && current.consent === null} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <Button
            type="button"
            size="xs"
            variant="ghost"
            disabled={blocked && !current.pairingCode}
          >
            {t("trigger")}
          </Button>
        </DialogTrigger>
        <DialogContent closeLabel={t("close")}>
          <DialogHeader>
            <DialogTitle>{t("title")}</DialogTitle>
            <DialogDescription>{t("scope")}</DialogDescription>
          </DialogHeader>
          <RemoteDialogBody
            connection={connection}
            current={current}
            siteKey={open ? siteKey : null}
            blocked={blocked}
            onClose={() => setOpen(false)}
            onFailed={setFailed}
            failed={failed || Boolean(current.error)}
          />
        </DialogContent>
      </Dialog>
    </div>
  )
}

function RemoteDialogBody({
  connection,
  current,
  siteKey,
  blocked,
  onClose,
  onFailed,
  failed,
}: {
  failed: boolean
  connection: Connection
  current: ReturnType<Connection["getSnapshot"]>
  siteKey: string | null
  blocked: boolean
  onClose: () => void
  onFailed: (failed: boolean) => void
}) {
  if (current.pairingCode)
    return (
      <RemotePairingCode
        code={current.pairingCode}
        connected={current.connected}
        failed={failed}
        onStop={() => {
          void connection.disable()
          onClose()
        }}
      />
    )
  return (
    <CreateRemotePair
      connection={connection}
      siteKey={siteKey}
      blocked={blocked || current.connecting}
      onFailed={onFailed}
      failed={failed}
    />
  )
}

export function RemoteAutomationConsentDialog({
  connection,
  current,
}: {
  connection: Pick<Connection, "consent">
  current: ReturnType<Connection["getSnapshot"]>
}) {
  const t = useTranslations("app.shell.remoteAi")
  const [failed, setFailed] = useState(false)
  const returnFocus = useRef<HTMLElement | null>(null)
  return (
    <Dialog
      open={current.consent !== null}
      onOpenChange={(next) => {
        if (!next) connection.consent(false)
      }}
    >
      <DialogContent
        closeLabel={t("close")}
        onOpenAutoFocus={() => {
          returnFocus.current =
            document.activeElement instanceof HTMLElement &&
            document.activeElement !== document.body
              ? document.activeElement
              : null
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault()
          const target = returnFocus.current?.isConnected
            ? returnFocus.current
            : document.querySelector<HTMLButtonElement>("[data-application-menu-trigger]")
          target?.focus()
        }}
      >
        <DialogHeader>
          <DialogTitle>{t("consentTitle")}</DialogTitle>
          <DialogDescription>{t("scope")}</DialogDescription>
        </DialogHeader>
        {current.consent ? (
          <RemoteClientConsent
            consent={current.consent}
            failed={failed}
            onDecision={(approved) => {
              const accepted = connection.consent(approved)
              setFailed(approved && !accepted)
            }}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

function RemoteClientConsent({
  consent,
  onDecision,
  failed,
}: {
  failed: boolean
  consent: NonNullable<ReturnType<Connection["getSnapshot"]>["consent"]>
  onDecision: (approved: boolean) => void
}) {
  const t = useTranslations("app.shell.remoteAi")
  return (
    <>
      <DialogBody className="gap-2 text-sm">
        <p>{t("client", { name: consent.client.name })}</p>
        <p className="break-all">{t("returnAddress", { address: consent.client.redirectUri })}</p>
        <p>{t("verifyClient")}</p>
        {failed ? <Alert>{t("failed")}</Alert> : null}
      </DialogBody>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={() => onDecision(false)}>
          {t("deny")}
        </Button>
        <Button type="button" onClick={() => onDecision(true)}>
          {t("allow")}
        </Button>
      </DialogFooter>
    </>
  )
}

function RemotePairingCode({
  code,
  connected,
  onStop,
  failed,
}: {
  failed: boolean
  code: string
  connected: boolean
  onStop: () => void
}) {
  const t = useTranslations("app.shell.remoteAi")
  return (
    <>
      <DialogBody className="gap-3 text-sm">
        <p>{t("codeHelp")}</p>
        <output
          className="select-all rounded border bg-muted p-3 font-mono"
          aria-label={t("codeLabel")}
        >
          {code}
        </output>
        <p role="status">{t(connected ? "connected" : "waiting")}</p>
        {failed ? <Alert>{t("failed")}</Alert> : null}
      </DialogBody>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onStop}>
          {t("disconnect")}
        </Button>
      </DialogFooter>
    </>
  )
}

function CreateRemotePair({
  connection,
  siteKey,
  blocked,
  onFailed,
  failed,
}: {
  failed: boolean
  connection: Connection
  siteKey: string | null
  blocked: boolean
  onFailed: (failed: boolean) => void
}) {
  const t = useTranslations("app.shell.remoteAi")
  const [token, setToken] = useState<string | null>(null)
  return (
    <>
      <DialogBody className="gap-3 text-sm">
        <p>{t("pairHelp")}</p>
        {siteKey ? <TurnstileChallenge siteKey={siteKey} onToken={setToken} /> : null}
        {failed ? <Alert>{t("failed")}</Alert> : null}
      </DialogBody>
      <DialogFooter>
        <Button
          type="button"
          disabled={!token || blocked}
          onClick={async () => {
            if (!token) return
            onFailed(!(await connection.enable(token)))
            setToken(null)
          }}
        >
          {t("create")}
        </Button>
      </DialogFooter>
    </>
  )
}
