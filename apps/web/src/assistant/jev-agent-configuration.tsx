import {
  assistantJevCredentialsSchema,
  assistantJevSettingsSchema,
} from "@vibeshape/automation-api/assistant-jev"
import { useTranslations } from "@vibeshape/i18n"
import { Button } from "@vibeshape/ui/components/button"
import { TextField } from "@vibeshape/ui/components/text-field"
import { type FormEvent, useRef, useState } from "react"
import { readAssistantPreferences, saveAssistantPreferences } from "./assistant-preferences"
import { NativeAgentActions } from "./native-agent-actions"
import type { createNativeChatController } from "./native-chat-controller"

function initialSettings() {
  const agent = readAssistantPreferences()?.agent
  return agent && "kind" in agent ? agent.settings : assistantJevSettingsSchema.parse({})
}

function configuration(data: FormData) {
  const optional = (name: string) => {
    const value = data.get(name)
    return typeof value === "string" && value.trim() ? value.trim() : undefined
  }
  const argumentsEndpoint = optional("argumentsEndpoint")
  const argumentsModel = optional("argumentsModel")
  const apiKey = optional("apiKey")
  const argumentsApiKey = optional("argumentsApiKey")
  const settings = assistantJevSettingsSchema.safeParse({
    model: data.get("model"),
    images: true,
    maxSteps: Number(data.get("maxSteps")),
    minConfidence: Number(data.get("minConfidence")),
    timeoutMs: Number(data.get("timeoutMs")),
    ...(argumentsEndpoint ? { argumentsEndpoint } : {}),
    ...(argumentsModel ? { argumentsModel } : {}),
  })
  const credentials = assistantJevCredentialsSchema.safeParse({
    ...(apiKey ? { apiKey } : {}),
    ...(argumentsApiKey ? { argumentsApiKey } : {}),
  })
  return settings.success && credentials.success && (!argumentsApiKey || argumentsEndpoint)
    ? { agent: { kind: "jev" as const, settings: settings.data }, credentials: credentials.data }
    : null
}

type JevConfigurationProps = {
  chat: Pick<ReturnType<typeof createNativeChatController>, "connect">
  connected: boolean
  pending: boolean
  testing: boolean
  disconnect: () => Promise<void>
  testConnection: (
    ...args: Parameters<ReturnType<typeof createNativeChatController>["testConnection"]>
  ) => Promise<void>
  clearTest: () => void
}

function useJevConnectionForm({ chat, connected, pending, testConnection }: JevConfigurationProps) {
  const [initial] = useState(initialSettings)
  const active = useRef(false)
  const formRef = useRef<HTMLFormElement>(null)
  const [submitting, setSubmitting] = useState(false)
  const [invalid, setInvalid] = useState(false)
  const [failed, setFailed] = useState(false)
  const [storageFailed, setStorageFailed] = useState(false)
  const locked = connected || pending || submitting
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (active.current || locked) return
    const form = event.currentTarget
    const parsed = configuration(new window.FormData(form))
    setInvalid(!parsed)
    if (!parsed) return
    active.current = true
    setSubmitting(true)
    setFailed(false)
    setStorageFailed(!saveAssistantPreferences({ version: 1, agent: parsed.agent }))
    try {
      if (await chat.connect(parsed.agent, parsed.credentials))
        for (const input of form.querySelectorAll<HTMLInputElement>('input[type="password"]'))
          input.value = ""
    } catch {
      setFailed(true)
    } finally {
      active.current = false
      setSubmitting(false)
    }
  }
  async function test() {
    if (!formRef.current || active.current || pending) return
    const data = new window.FormData(formRef.current)
    for (const input of formRef.current.querySelectorAll<HTMLInputElement>("input:disabled[name]"))
      data.set(input.name, input.value)
    const parsed = configuration(data)
    setInvalid(!parsed)
    if (parsed) await testConnection(parsed.agent, parsed.credentials)
  }
  return { initial, formRef, submitting, invalid, failed, storageFailed, locked, submit, test }
}

export function JevAgentConfiguration(props: JevConfigurationProps) {
  const t = useTranslations("app.assistant")
  const { connected, pending, testing, disconnect, clearTest } = props
  const { initial, formRef, submitting, invalid, failed, storageFailed, locked, submit, test } =
    useJevConnectionForm(props)
  return (
    <form
      ref={formRef}
      className="grid gap-3"
      onInput={clearTest}
      onSubmit={submit}
      aria-label={t("jev.settings")}
      aria-busy={pending || submitting || undefined}
    >
      <p className="text-xs text-muted-foreground">{t("jev.description")}</p>
      <fieldset disabled={locked} className="grid min-w-0 gap-3">
        <TextField
          name="model"
          label={t("jev.model")}
          defaultValue={initial.model}
          required
          maxLength={128}
        />
        <TextField
          name="apiKey"
          type="password"
          label={t("jev.apiKey")}
          autoComplete="off"
          maxLength={4096}
          description={t("jev.keyNotice")}
        />
        <details open={Boolean(initial.argumentsEndpoint)}>
          <summary className="cursor-pointer text-xs font-medium">{t("jev.argumentModel")}</summary>
          <div className="mt-3 grid gap-3">
            <p className="text-xs text-muted-foreground">{t("jev.argumentNotice")}</p>
            <TextField
              name="argumentsEndpoint"
              type="url"
              label={t("jev.endpoint")}
              defaultValue={initial.argumentsEndpoint}
              maxLength={2048}
            />
            <TextField
              name="argumentsModel"
              label={t("jev.helperModel")}
              defaultValue={initial.argumentsModel}
              maxLength={128}
            />
            <TextField
              name="argumentsApiKey"
              type="password"
              label={t("jev.helperKey")}
              autoComplete="off"
              maxLength={4096}
            />
          </div>
        </details>
        <details>
          <summary className="cursor-pointer text-xs font-medium">{t("jev.advanced")}</summary>
          <div className="mt-3 grid gap-3">
            <TextField
              name="maxSteps"
              type="number"
              label={t("jev.maxSteps")}
              defaultValue={initial.maxSteps}
              min={1}
              max={48}
              required
            />
            <TextField
              name="minConfidence"
              type="number"
              label={t("jev.minConfidence")}
              defaultValue={initial.minConfidence}
              min={0}
              max={1}
              step="0.01"
              required
            />
            <TextField
              name="timeoutMs"
              type="number"
              label={t("jev.timeoutMs")}
              defaultValue={initial.timeoutMs}
              min={1000}
              max={120000}
              required
            />
          </div>
        </details>
      </fieldset>
      {invalid && (
        <p role="alert" className="text-xs text-destructive">
          {t("jev.invalid")}
        </p>
      )}
      {failed && (
        <p role="alert" className="text-xs text-destructive">
          {t("errors.request-failed")}
        </p>
      )}
      {storageFailed && (
        <p role="status" className="text-xs text-muted-foreground">
          {t("settingsNotSaved")}
        </p>
      )}
      <NativeAgentActions
        connected={connected}
        pending={pending || submitting}
        disconnect={disconnect}
      />
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={pending || submitting}
        isLoading={testing}
        onClick={test}
      >
        {t("testConnection")}
      </Button>
      <p className="text-xs text-muted-foreground">{t("connectionTestNotice")}</p>
      <p className="text-xs text-muted-foreground">{t("historyNotice")}</p>
    </form>
  )
}
