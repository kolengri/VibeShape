import { useTranslations } from "@vibeshape/i18n"
import { Button } from "@vibeshape/ui/components/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@vibeshape/ui/components/dialog"
import { useEffect, useState } from "react"
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
  return (
    <div className="flex shrink-0 items-center gap-1">
      <Dialog
        open={open || current.consent !== null}
        onOpenChange={(next) => {
          setOpen(next)
          if (!next) {
            if (current.consent) connection.consent(false)
          }
        }}
      >
        <DialogTrigger asChild>
          <Button
            type="button"
            size="xs"
            variant="outline"
            disabled={blocked && !current.pairingCode}
          >
            {t("trigger")}
          </Button>
        </DialogTrigger>
        <DialogContent closeLabel={t("close")}>
          <DialogHeader>
            <DialogTitle>{t(current.consent ? "consentTitle" : "title")}</DialogTitle>
            <DialogDescription>{t("scope")}</DialogDescription>
          </DialogHeader>
          <RemoteDialogBody
            connection={connection}
            current={current}
            siteKey={open ? siteKey : null}
            blocked={blocked}
            onClose={() => setOpen(false)}
            onFailed={setFailed}
          />
          {failed || current.error ? (
            <p role="alert" className="text-sm text-destructive">
              {t("failed")}
            </p>
          ) : null}
        </DialogContent>
      </Dialog>
      {current.connected ? (
        <LocalAutomationStatus
          connection={{
            enable: async () => false,
            disable: connection.disable,
            enableAutoApply: connection.enableAutoApply,
          }}
          current={{
            available: true,
            connected: true,
            autoApply: current.autoApply,
            busy: current.busy,
            client: { name: current.client?.name ?? "", version: "OAuth" },
            error: current.error,
          }}
        />
      ) : null}
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
}: {
  connection: Connection
  current: ReturnType<Connection["getSnapshot"]>
  siteKey: string | null
  blocked: boolean
  onClose: () => void
  onFailed: (failed: boolean) => void
}) {
  if (current.consent)
    return (
      <RemoteClientConsent
        consent={current.consent}
        onDecision={(approved) => {
          const accepted = connection.consent(approved)
          if (approved) onFailed(!accepted)
          onClose()
        }}
      />
    )
  if (current.pairingCode)
    return (
      <RemotePairingCode
        code={current.pairingCode}
        connected={current.connected}
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
    />
  )
}

function RemoteClientConsent({
  consent,
  onDecision,
}: {
  consent: NonNullable<ReturnType<Connection["getSnapshot"]>["consent"]>
  onDecision: (approved: boolean) => void
}) {
  const t = useTranslations("app.shell.remoteAi")
  return (
    <div className="grid gap-2 text-sm">
      <p>{t("client", { name: consent.client.name })}</p>
      <p className="break-all">{t("returnAddress", { address: consent.client.redirectUri })}</p>
      <p>{t("verifyClient")}</p>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={() => onDecision(false)}>
          {t("deny")}
        </Button>
        <Button type="button" onClick={() => onDecision(true)}>
          {t("allow")}
        </Button>
      </DialogFooter>
    </div>
  )
}

function RemotePairingCode({
  code,
  connected,
  onStop,
}: {
  code: string
  connected: boolean
  onStop: () => void
}) {
  const t = useTranslations("app.shell.remoteAi")
  return (
    <div className="grid gap-3 text-sm">
      <p>{t("codeHelp")}</p>
      <output
        className="select-all rounded border bg-muted p-3 font-mono"
        aria-label={t("codeLabel")}
      >
        {code}
      </output>
      <p role="status">{t(connected ? "connected" : "waiting")}</p>
      <Button type="button" variant="outline" onClick={onStop}>
        {t("disconnect")}
      </Button>
    </div>
  )
}

function CreateRemotePair({
  connection,
  siteKey,
  blocked,
  onFailed,
}: {
  connection: Connection
  siteKey: string | null
  blocked: boolean
  onFailed: (failed: boolean) => void
}) {
  const t = useTranslations("app.shell.remoteAi")
  const [token, setToken] = useState<string | null>(null)
  return (
    <div className="grid gap-3 text-sm">
      <p>{t("pairHelp")}</p>
      {siteKey ? <TurnstileChallenge siteKey={siteKey} onToken={setToken} /> : null}
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
    </div>
  )
}
