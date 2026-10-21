import type {
  AssistantAgent,
  AssistantConnectionTestResult,
} from "@vibeshape/automation-api/assistant"
import type { AssistantJevCredentials } from "@vibeshape/automation-api/assistant-jev"
import { useTranslations } from "@vibeshape/i18n"
import { useRef, useState } from "react"

type Probe = (
  agent: AssistantAgent,
  credentials?: AssistantJevCredentials,
) => Promise<AssistantConnectionTestResult>

export function useAssistantConnectionTest(probe: Probe | undefined) {
  const active = useRef(false)
  const [pending, setPending] = useState(false)
  const [result, setResult] = useState<AssistantConnectionTestResult | null>(null)
  return {
    pending,
    result,
    clear: () => setResult(null),
    async run(agent: AssistantAgent, credentials?: AssistantJevCredentials) {
      if (active.current) return
      active.current = true
      setPending(true)
      setResult(null)
      try {
        setResult(
          probe
            ? await probe(agent, credentials)
            : { ok: false, code: "unsupported", stage: "agent" },
        )
      } catch {
        setResult({ ok: false, code: "request-failed", stage: "agent" })
      } finally {
        active.current = false
        setPending(false)
      }
    },
  }
}

export function AssistantConnectionTestFeedback({
  result,
}: {
  result: AssistantConnectionTestResult | null
}) {
  const t = useTranslations("app.assistant")
  if (!result) return null
  return (
    <p role={result.ok ? "status" : "alert"} className="text-xs text-muted-foreground">
      {result.ok
        ? t(
            result.checks.includes("arguments")
              ? "connectionTestProvidersPassed"
              : result.checks.includes("jev")
                ? "connectionTestJevPassed"
                : "connectionTestAgentPassed",
          )
        : t("connectionTestFailed", {
            stage: result.stage,
            httpStatus: result.httpStatus === undefined ? "none" : String(result.httpStatus),
            reason: t(`errors.${result.code}`),
          })}
    </p>
  )
}
