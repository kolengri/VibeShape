import { useTranslations } from "@vibeshape/i18n"
import { Button } from "@vibeshape/ui/components/button"
import { Textarea } from "@vibeshape/ui/components/textarea"
import { useEffect, useId, useState } from "react"
import { useOptionalAutomationConnections } from "../shell/automation-status"
import { getDesktopHost, readDesktopMcpSetup } from "./desktop-host"

export function DesktopMcpSettings() {
  const t = useTranslations("app.settings.desktopMcp")
  const title = useId()
  const [configuration, setConfiguration] = useState("")
  const [status, setStatus] = useState<"idle" | "failed" | "copied" | "copyFailed">("idle")
  const available = getDesktopHost() !== undefined
  useEffect(() => {
    let active = true
    void readDesktopMcpSetup()
      .then((setup) => {
        if (active && setup)
          setConfiguration(JSON.stringify({ mcpServers: setup.mcpServers }, null, 2))
      })
      .catch(() => {
        if (active) setStatus("failed")
      })
    return () => {
      active = false
    }
  }, [])
  return (
    <section className="grid gap-3" aria-labelledby={title}>
      <h3 id={title} className="font-medium">
        {t("title")}
      </h3>
      <p className="text-sm text-muted-foreground">
        {t(available ? "description" : "unavailable")}
      </p>
      {available ? (
        <>
          <DesktopMcpRestart />
          <Textarea
            aria-label={t("configuration")}
            readOnly
            value={configuration}
            rows={9}
            className="font-mono text-xs"
            aria-busy={!configuration && status === "idle"}
          />
          <Button
            type="button"
            variant="outline"
            disabled={!configuration}
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(configuration)
                setStatus("copied")
              } catch {
                setStatus("copyFailed")
              }
            }}
          >
            {t("copy")}
          </Button>
          <p role="status" className="text-sm text-muted-foreground">
            {status === "idle" ? "" : t(status)}
          </p>
        </>
      ) : null}
    </section>
  )
}

function DesktopMcpRestart() {
  const t = useTranslations("app.settings.desktopMcp")
  const connections = useOptionalAutomationConnections()
  const external = connections?.external
  const [failed, setFailed] = useState(false)
  if (!external?.defaultAccess || (!external.recoveryBlocked && !external.recoveryFailed))
    return null
  return (
    <>
      <p className="text-sm text-muted-foreground">
        {t(external.recoveryBlocked ? "stopped" : "connectionFailed")}
      </p>
      <Button
        type="button"
        variant="outline"
        disabled={!external.available || !external.client}
        onClick={async () => {
          setFailed(!connections || !(await connections.externalConnection.enable()))
        }}
      >
        {t("restart")}
      </Button>
      {failed ? <p role="alert">{t("restartFailed")}</p> : null}
    </>
  )
}
