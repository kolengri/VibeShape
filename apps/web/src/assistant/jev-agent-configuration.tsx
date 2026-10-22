import {
  assistantJevCredentialsSchema,
  assistantJevSettingsSchema,
} from "@vibeshape/automation-api/assistant-jev"
import { useTranslations } from "@vibeshape/i18n"
import { Alert } from "@vibeshape/ui/components/alert"
import { Button } from "@vibeshape/ui/components/button"
import { Field, FieldDescription, FieldError, FieldLabel } from "@vibeshape/ui/components/field"
import { Input } from "@vibeshape/ui/components/input"
import { SelectField, SelectOption } from "@vibeshape/ui/components/select-field"
import { TextField } from "@vibeshape/ui/components/text-field"
import { type FormEvent, useId, useRef, useState } from "react"
import { readAssistantPreferences, saveAssistantPreferences } from "./assistant-preferences"
import { useAssistantSettingsSaved } from "./assistant-settings-dialog"
import { agentPresetId, agentPresets } from "./connection-presets"
import { NativeAgentActions } from "./native-agent-actions"
import type { createNativeChatController } from "./native-chat-controller"

function initialSettings() {
  const agent = readAssistantPreferences()?.agent
  return agent && "kind" in agent
    ? agent.settings
    : assistantJevSettingsSchema.parse(agent ? { argumentsAgent: agent } : {})
}

function argumentAgent(choice: string, initial: ReturnType<typeof initialSettings>) {
  if (choice === "saved") return { argumentsAgent: initial.argumentsAgent }
  const preset = agentPresets.find((entry) => entry.id === choice)
  return preset ? { argumentsAgent: { command: preset.command, args: [...preset.args] } } : {}
}

function configurationFieldErrors(
  settings: ReturnType<typeof assistantJevSettingsSchema.safeParse>,
  credentials: ReturnType<typeof assistantJevCredentialsSchema.safeParse>,
  argumentsEndpoint: string | undefined,
  argumentsApiKey: string | undefined,
) {
  const fields = [...(settings.error?.issues ?? []), ...(credentials.error?.issues ?? [])].flatMap(
    ({ path }) => {
      const field = path[0] ?? (argumentsEndpoint ? "argumentsModel" : "argumentsEndpoint")
      return typeof field === "string" ? [field] : []
    },
  )
  if (argumentsApiKey && !argumentsEndpoint) fields.push("argumentsEndpoint")
  return fields
}

function configuration(
  data: FormData,
  choice: string,
  initial: ReturnType<typeof initialSettings>,
) {
  const optional = (name: string) => {
    const value = data.get(name)
    return typeof value === "string" && value.trim() ? value.trim() : undefined
  }
  const argumentsEndpoint = optional("argumentsEndpoint")
  const argumentsModel = optional("argumentsModel")
  const apiKey = optional("apiKey")
  const argumentsApiKey = optional("argumentsApiKey")
  const settings = assistantJevSettingsSchema.safeParse({
    ...argumentAgent(choice, initial),
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

  return {
    value:
      settings.success && credentials.success && (!argumentsApiKey || argumentsEndpoint)
        ? {
            agent: { kind: "jev" as const, settings: settings.data },
            credentials: credentials.data,
          }
        : null,
    fields: configurationFieldErrors(settings, credentials, argumentsEndpoint, argumentsApiKey),
  }
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
  const onSaved = useAssistantSettingsSaved()
  const [initial] = useState(initialSettings)
  const [argumentChoice, setArgumentChoice] = useState(() =>
    initial.argumentsAgent
      ? agentPresetId(initial.argumentsAgent) === "custom"
        ? "saved"
        : agentPresetId(initial.argumentsAgent)
      : initial.argumentsEndpoint
        ? "api"
        : "none",
  )
  const active = useRef(false)
  const formRef = useRef<HTMLFormElement>(null)
  const [submitting, setSubmitting] = useState(false)
  const [invalidFields, setInvalidFields] = useState<readonly string[]>([])
  const [advanced, setAdvanced] = useState(false)
  const [failed, setFailed] = useState(false)
  const [storageFailed, setStorageFailed] = useState(false)
  const locked = connected || pending || submitting
  function validate(data: FormData) {
    const validation = configuration(data, argumentChoice, initial)
    setInvalidFields(validation.fields)
    if (validation.fields.some((name) => ["maxSteps", "minConfidence", "timeoutMs"].includes(name)))
      setAdvanced(true)
    return validation.value
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (active.current || locked) return
    const form = event.currentTarget
    const parsed = validate(new window.FormData(form))
    if (!parsed) return
    active.current = true
    setSubmitting(true)
    setFailed(false)
    const saved = saveAssistantPreferences({ version: 1, agent: parsed.agent })
    setStorageFailed(!saved)
    try {
      const accepted = await chat.connect(parsed.agent, parsed.credentials)
      setFailed(!accepted)
      if (accepted) {
        for (const input of form.querySelectorAll<HTMLInputElement>('input[type="password"]'))
          input.value = ""
        if (saved) onSaved?.()
      }
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
    const parsed = validate(data)
    if (parsed) await testConnection(parsed.agent, parsed.credentials)
  }
  return {
    initial,
    argumentChoice,
    setArgumentChoice,
    formRef,
    submitting,
    invalidFields,
    advanced,
    setAdvanced,
    clearInvalidField: (name: string) =>
      setInvalidFields((fields) => fields.filter((field) => field !== name)),
    failed,
    storageFailed,
    locked,
    submit,
    test,
  }
}

export function JevAgentConfiguration(props: JevConfigurationProps) {
  const t = useTranslations("app.assistant")
  const id = useId()
  const { connected, pending, testing, disconnect, clearTest } = props
  const {
    initial,
    argumentChoice,
    setArgumentChoice,
    formRef,
    submitting,
    invalidFields,
    advanced,
    setAdvanced,
    clearInvalidField,
    failed,
    storageFailed,
    locked,
    submit,
    test,
  } = useJevConnectionForm(props)
  const fieldError = (name: string) => (invalidFields.includes(name) ? t("jev.invalid") : undefined)
  const apiKeyError = fieldError("apiKey")
  return (
    <form
      ref={formRef}
      className="grid gap-2"
      onInput={(event) => {
        clearTest()
        if (event.target instanceof HTMLInputElement) clearInvalidField(event.target.name)
      }}
      onSubmit={submit}
      aria-label={t("jev.settings")}
      aria-busy={pending || submitting || undefined}
    >
      <fieldset disabled={locked} className="grid min-w-0 gap-2">
        <TextField
          name="model"
          error={fieldError("model")}
          label={t("jev.model")}
          description={t("jev.description")}
          defaultValue={initial.model}
          required
          maxLength={128}
        />
        <Field data-invalid={Boolean(apiKeyError) || undefined}>
          <FieldLabel htmlFor={`${id}-api-key`}>{t("jev.apiKey")}</FieldLabel>
          <Input
            id={`${id}-api-key`}
            name="apiKey"
            type="password"
            autoComplete="off"
            maxLength={4096}
            aria-invalid={Boolean(apiKeyError) || undefined}
            aria-describedby={
              apiKeyError ? `${id}-key-notice ${id}-api-key-error` : `${id}-key-notice`
            }
          />
          <FieldError id={`${id}-api-key-error`}>{apiKeyError}</FieldError>
        </Field>
        <FieldDescription id={`${id}-key-notice`}>{t("jev.keyNotice")}</FieldDescription>
        <div className="grid gap-2">
          <SelectField
            label={t("jev.argumentModel")}
            description={t("jev.argumentNotice")}
            value={argumentChoice}
            disabled={locked}
            onValueChange={(value) => {
              setArgumentChoice(value)
              clearTest()
            }}
          >
            <SelectOption value="none">{t("jev.noArgumentAgent")}</SelectOption>
            {agentPresets.map((preset) => (
              <SelectOption key={preset.id} value={preset.id}>
                {t(`agents.${preset.id}`)}
              </SelectOption>
            ))}
            {initial.argumentsAgent && agentPresetId(initial.argumentsAgent) === "custom" && (
              <SelectOption value="saved">{t("jev.savedAgent")}</SelectOption>
            )}
            <SelectOption value="api">{t("jev.apiArgumentAgent")}</SelectOption>
          </SelectField>
          {argumentChoice === "api" && (
            <>
              <TextField
                name="argumentsEndpoint"
                error={fieldError("argumentsEndpoint")}
                type="url"
                label={t("jev.endpoint")}
                defaultValue={initial.argumentsEndpoint}
                maxLength={2048}
              />
              <TextField
                name="argumentsModel"
                error={fieldError("argumentsModel")}
                label={t("jev.helperModel")}
                defaultValue={initial.argumentsModel}
                maxLength={128}
              />
              <TextField
                name="argumentsApiKey"
                error={fieldError("argumentsApiKey")}
                type="password"
                label={t("jev.helperKey")}
                autoComplete="off"
                maxLength={4096}
              />
            </>
          )}
        </div>
        <details open={advanced} onToggle={(event) => setAdvanced(event.currentTarget.open)}>
          <summary className="cursor-pointer text-xs font-medium">{t("jev.advanced")}</summary>
          <div className="mt-2 grid gap-2">
            <TextField
              name="maxSteps"
              error={fieldError("maxSteps")}
              type="number"
              label={t("jev.maxSteps")}
              defaultValue={initial.maxSteps}
              min={1}
              max={48}
              required
            />
            <TextField
              name="minConfidence"
              error={fieldError("minConfidence")}
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
              error={fieldError("timeoutMs")}
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
      {failed && <Alert>{t("errors.request-failed")}</Alert>}
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
