import { useTranslations } from "@vibeshape/i18n"
import { Button } from "@vibeshape/ui/components/button"
import { Input } from "@vibeshape/ui/components/input"
import { SelectField, SelectOption } from "@vibeshape/ui/components/select-field"
import { type FormEvent, useId, useRef, useState } from "react"
import { apiConfigurationSchema } from "./api-assistant-preferences"
import { useApiAssistantSettings } from "./api-assistant-provider"
import type { createApiChatController } from "./api-chat-controller"
import { useAssistantSettingsSaved } from "./assistant-settings-dialog"
import { apiPresetId, apiPresets } from "./connection-presets"

type Connection = Pick<ReturnType<typeof createApiChatController>, "connect" | "disconnect">

function useApiConnectionForm(chat: Connection, connected: boolean) {
  const settings = useApiAssistantSettings()
  const onSaved = useAssistantSettingsSaved()
  const active = useRef(false)
  const [submitting, setSubmitting] = useState(false)
  const [endpoint, setEndpoint] = useState(settings.configuration.endpoint)
  const [model, setModel] = useState(settings.configuration.model)
  const [apiKey, setApiKey] = useState(settings.configuration.apiKey)
  const [stream, setStream] = useState(settings.configuration.stream)
  const [choice, setChoice] = useState(() => apiPresetId(settings.configuration.endpoint))
  const [advanced, setAdvanced] = useState(choice === "custom")
  const [custom, setCustom] = useState({ endpoint, model, stream })
  const [invalid, setInvalid] = useState(false)
  const [failed, setFailed] = useState(false)
  const [storageFailed, setStorageFailed] = useState(false)
  const changeEndpoint = (value: string) => {
    if (value.trim() !== endpoint) setApiKey("")
    setEndpoint(value)
  }
  const choose = (value: string) => {
    const preset = apiPresets.find((entry) => entry.id === value)
    if (!preset && value !== "custom") return
    if (choice === "custom") setCustom({ endpoint, model, stream })
    const next = preset ? { endpoint: preset.endpoint, model: "", stream: true } : custom
    changeEndpoint(next.endpoint)
    setModel(next.model)
    setStream(next.stream)
    setChoice(preset?.id ?? "custom")
    setAdvanced(!preset)
    setInvalid(false)
    if (connected) void chat.disconnect()
  }
  const editEndpoint = (value: string) => {
    setChoice("custom")
    changeEndpoint(value)
  }
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (active.current) return
    const parsed = apiConfigurationSchema.safeParse({ endpoint, model, apiKey, stream })
    if (!parsed.success) {
      setInvalid(true)
      return
    }
    setInvalid(false)
    const saved = settings.configure(parsed.data)
    setStorageFailed(!saved)
    active.current = true
    setSubmitting(true)
    setFailed(false)
    try {
      if ((await chat.connect(parsed.data)) && saved) onSaved?.()
    } catch {
      setFailed(true)
    } finally {
      active.current = false
      setSubmitting(false)
    }
  }
  return {
    endpoint,
    model,
    apiKey,
    stream,
    choice,
    advanced,
    invalid,
    failed,
    storageFailed,
    submitting,
    submit,
    choose,
    editEndpoint,
    setModel,
    setApiKey,
    setStream,
    setAdvanced,
  }
}

export function ApiConfigurationForm({
  chat,
  busy,
  connected,
}: {
  chat: Connection
  busy: boolean
  connected: boolean
}) {
  const t = useTranslations("app.assistant.api")
  const id = useId()
  const form = useApiConnectionForm(chat, connected)
  const locked = busy || connected || form.submitting
  return (
    <form className="grid gap-3" onSubmit={form.submit} aria-busy={form.submitting || undefined}>
      <SelectField
        label={t("provider")}
        value={form.choice}
        disabled={busy || form.submitting}
        onValueChange={form.choose}
      >
        <SelectOption value="choose" disabled>
          {t("chooseProvider")}
        </SelectOption>
        {apiPresets.map((preset) => (
          <SelectOption key={preset.id} value={preset.id}>
            {t(`providers.${preset.id}`)}
          </SelectOption>
        ))}
        <SelectOption value="custom">{t("customProvider")}</SelectOption>
      </SelectField>
      <p className="text-xs text-muted-foreground">{t("description")}</p>
      <label htmlFor={`${id}-model`} className="text-xs font-medium">
        {t("model")}
      </label>
      <Input
        id={`${id}-model`}
        required
        value={form.model}
        maxLength={128}
        disabled={locked}
        onChange={(event) => form.setModel(event.currentTarget.value)}
      />
      <label htmlFor={`${id}-key`} className="text-xs font-medium">
        {t("apiKey")}
      </label>
      <Input
        id={`${id}-key`}
        type="password"
        autoComplete="off"
        value={form.apiKey}
        maxLength={4096}
        disabled={locked}
        onChange={(event) => form.setApiKey(event.currentTarget.value)}
        aria-describedby={`${id}-memory`}
      />
      <p id={`${id}-memory`} className="text-xs text-muted-foreground">
        {t("keyMemory")}
      </p>
      <details
        open={form.advanced}
        onToggle={(event) => form.setAdvanced(event.currentTarget.open)}
      >
        <summary className="cursor-pointer text-xs font-medium">{t("advanced")}</summary>
        <div className="mt-3 grid gap-2">
          <label htmlFor={`${id}-endpoint`} className="text-xs font-medium">
            {t("endpoint")}
          </label>
          <Input
            id={`${id}-endpoint`}
            type="url"
            required
            value={form.endpoint}
            maxLength={2048}
            disabled={locked}
            onChange={(event) => form.editEndpoint(event.currentTarget.value)}
          />
          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={form.stream}
              disabled={locked}
              onChange={(event) => form.setStream(event.currentTarget.checked)}
            />
            {t("stream")}
          </label>
        </div>
      </details>
      {form.invalid && (
        <p role="alert" className="text-sm text-destructive">
          {t("errors.invalid-configuration")}
        </p>
      )}
      {form.storageFailed && (
        <p role="status" className="text-xs text-muted-foreground">
          {t("settingsNotSaved")}
        </p>
      )}
      {form.failed && (
        <p role="alert" className="text-sm text-destructive">
          {t("errors.tools-unavailable")}
        </p>
      )}
      {connected ? (
        <Button type="button" size="sm" variant="outline" disabled={busy} onClick={chat.disconnect}>
          {t("disconnect")}
        </Button>
      ) : (
        <Button
          type="submit"
          size="sm"
          disabled={locked || !form.endpoint.trim() || !form.model.trim()}
          isLoading={form.submitting}
        >
          {t("connect")}
        </Button>
      )}
    </form>
  )
}
