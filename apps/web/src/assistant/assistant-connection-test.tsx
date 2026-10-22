import type {
  AssistantAgent,
  AssistantConnectionTestResult,
} from "@vibeshape/automation-api/assistant"
import type { AssistantJevCredentials } from "@vibeshape/automation-api/assistant-jev"
import { useTranslations } from "@vibeshape/i18n"
import { Alert } from "@vibeshape/ui/components/alert"
import { useRef, useState } from "react"
import { useReportApplicationSuccess } from "../shell/application-notices"

type Probe = (
  agent: AssistantAgent,
  credentials?: AssistantJevCredentials,
) => Promise<AssistantConnectionTestResult>

export function useAssistantConnectionTest(probe: Probe | undefined) {
  const active = useRef(false)
  const [pending, setPending] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [result, setResult] = useState<AssistantConnectionTestResult | null>(null)
  return {
    pending,
    result,
    attempt,
    clear: () => setResult(null),
    async run(agent: AssistantAgent, credentials?: AssistantJevCredentials) {
      if (active.current) return
      active.current = true
      setPending(true)
      setAttempt((value) => value + 1)
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
  attempt,
}: {
  result: AssistantConnectionTestResult | null
  attempt: number
}) {
  const t = useTranslations("app.assistant")
  const success = result?.ok
    ? t(
        result.checks.includes("arguments")
          ? "connectionTestProvidersPassed"
          : result.checks.includes("jev")
            ? "connectionTestJevPassed"
            : "connectionTestAgentPassed",
      )
    : null
  useReportApplicationSuccess(success, attempt)
  if (!result || result.ok) return null
  return (
    <Alert>
      {t("connectionTestFailed", {
        stage: result.stage,
        httpStatus: result.httpStatus === undefined ? "none" : String(result.httpStatus),
        reason: t(`errors.${result.code}`),
      })}
    </Alert>
  )
}
