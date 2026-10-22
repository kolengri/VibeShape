import { useTranslations } from "@vibeshape/i18n"
import { Alert } from "@vibeshape/ui/components/alert"
import { Button } from "@vibeshape/ui/components/button"
import { DialogBody, DialogFooter } from "@vibeshape/ui/components/dialog"
import { SelectOption } from "@vibeshape/ui/components/select-field"
import { Form, useAppForm } from "@vibeshape/ui/integrations/tanstack-form"
import { useId, useRef, useState } from "react"
import { type ApiConfiguration, apiConfigurationSchema } from "./api-assistant-preferences"
import { useApiAssistantSettings } from "./api-assistant-provider"
import type { createApiChatController } from "./api-chat-controller"
import { useAssistantSettingsSaved } from "./assistant-settings-dialog"
import { apiPresetId, apiPresets } from "./connection-presets"

type Connection = Pick<ReturnType<typeof createApiChatController>, "connect" | "disconnect">
type ApiFormValues = ApiConfiguration & { provider: string }

function useApiConnectionForm(chat: Connection, busy: boolean, connected: boolean) {
  const t = useTranslations("app.assistant.api")
  const settings = useApiAssistantSettings()
  const onSaved = useAssistantSettingsSaved()
  const [initial] = useState(() => settings.configuration)
  const custom = useRef({
    endpoint: initial.endpoint,
    model: initial.model,
    stream: initial.stream,
  })
  const [advanced, setAdvanced] = useState(apiPresetId(initial.endpoint) === "custom")
  const [failed, setFailed] = useState(false)
  const [storageFailed, setStorageFailed] = useState(false)
  const validate = ({ provider: _provider, ...value }: ApiFormValues) => {
    const parsed = apiConfigurationSchema.safeParse(value)
    if (parsed.success) return undefined
    return {
      fields: Object.fromEntries(
        parsed.error.issues.map(({ path }) => [
          path[0],
          path[0] === "endpoint"
            ? t("endpointInvalid")
            : path[0] === "model"
              ? t("modelInvalid")
              : t("apiKeyInvalid"),
        ]),
      ),
    }
  }
  const form = useAppForm({
    defaultValues: { ...initial, provider: apiPresetId(initial.endpoint) } satisfies ApiFormValues,
    validators: {
      onSubmit: ({ value }) => validate(value),
      onChange: ({ value, formApi }) =>
        formApi.state.submissionAttempts > 0 ? validate(value) : undefined,
    },
    onSubmitInvalid: ({ formApi }) => {
      if (formApi.getFieldMeta("endpoint")?.errors.length) setAdvanced(true)
    },
    onSubmit: async ({ value }) => {
      if (busy || connected) return
      const { provider: _provider, ...configuration } = value
      const parsed = apiConfigurationSchema.parse(configuration)
      const saved = settings.configure(parsed)
      setStorageFailed(!saved)
      setFailed(false)
      try {
        const accepted = await chat.connect(parsed)
        setFailed(!accepted)
        if (accepted && saved) onSaved?.()
      } catch {
        setFailed(true)
      }
    },
  })
  const rememberCustom = () => {
    const { provider, endpoint, model, stream } = form.state.values
    if (provider === "custom") custom.current = { endpoint, model, stream }
  }
  const editEndpoint = () => {
    form.setFieldValue("provider", "custom", { dontRunListeners: true })
    form.setFieldValue("apiKey", "", { dontRunListeners: true })
    rememberCustom()
  }
  const chooseProvider = (provider: string) => {
    const preset = apiPresets.find((entry) => entry.id === provider)
    if (!preset && provider !== "custom") return
    const next = preset ? { endpoint: preset.endpoint, model: "", stream: true } : custom.current
    if (next.endpoint.trim() !== form.state.values.endpoint)
      form.setFieldValue("apiKey", "", { dontRunListeners: true })
    form.setFieldValue("endpoint", next.endpoint, { dontRunListeners: true })
    form.setFieldValue("model", next.model, { dontRunListeners: true })
    form.setFieldValue("stream", next.stream, { dontRunListeners: true })
    setAdvanced(!preset)
    if (connected) void chat.disconnect()
  }
  return {
    form,
    advanced,
    setAdvanced,
    failed,
    storageFailed,
    chooseProvider,
    editEndpoint,
    rememberCustom,
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
  const {
    form,
    advanced,
    setAdvanced,
    failed,
    storageFailed,
    chooseProvider,
    editEndpoint,
    rememberCustom,
  } = useApiConnectionForm(chat, busy, connected)
  const id = useId()
  return (
    <form.Subscribe selector={(state) => state.isSubmitting}>
      {(submitting) => {
        const locked = busy || connected || submitting
        return (
          <Form
            id={id}
            form={form}
            className="flex min-h-0 min-w-0 flex-1 flex-col gap-0 overflow-hidden"
            aria-busy={submitting || undefined}
            onSubmitCapture={(event) => {
              if (!locked) return
              event.preventDefault()
              event.stopPropagation()
            }}
          >
            <DialogBody className="gap-3">
              <form.AppField name="provider">
                {(field) => (
                  <field.SelectField
                    label={t("provider")}
                    disabled={busy || submitting}
                    onValueChange={chooseProvider}
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
                  </field.SelectField>
                )}
              </form.AppField>
              <p className="text-xs text-muted-foreground">{t("description")}</p>
              <form.AppField name="model">
                {(field) => (
                  <field.TextField
                    label={t("model")}
                    required
                    maxLength={128}
                    disabled={locked}
                    onValueChange={rememberCustom}
                  />
                )}
              </form.AppField>
              <form.AppField name="apiKey">
                {(field) => (
                  <field.TextField
                    label={t("apiKey")}
                    description={t("keyMemory")}
                    type="password"
                    autoComplete="off"
                    maxLength={4096}
                    disabled={locked}
                  />
                )}
              </form.AppField>
              <details open={advanced} onToggle={(event) => setAdvanced(event.currentTarget.open)}>
                <summary className="cursor-pointer text-xs font-medium">{t("advanced")}</summary>
                <div className="mt-2 grid gap-2">
                  <form.AppField name="endpoint">
                    {(field) => (
                      <field.TextField
                        label={t("endpoint")}
                        type="url"
                        required
                        maxLength={2048}
                        disabled={locked}
                        onValueChange={editEndpoint}
                      />
                    )}
                  </form.AppField>
                  <form.AppField name="stream">
                    {(field) => (
                      <field.CheckboxField
                        label={t("stream")}
                        disabled={locked}
                        onValueChange={rememberCustom}
                      />
                    )}
                  </form.AppField>
                </div>
              </details>
              {storageFailed && (
                <p role="status" className="text-xs text-muted-foreground">
                  {t("settingsNotSaved")}
                </p>
              )}
              {failed && <Alert>{t("errors.tools-unavailable")}</Alert>}
            </DialogBody>
            <DialogFooter>
              {connected ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={chat.disconnect}
                >
                  {t("disconnect")}
                </Button>
              ) : (
                <form.Subscribe
                  selector={(state) =>
                    Boolean(state.values.endpoint.trim() && state.values.model.trim())
                  }
                >
                  {(complete) => (
                    <form.SubmitButton
                      form={id}
                      size="sm"
                      requireDirty={false}
                      disabled={locked || !complete}
                    >
                      {t("connect")}
                    </form.SubmitButton>
                  )}
                </form.Subscribe>
              )}
            </DialogFooter>
          </Form>
        )
      }}
    </form.Subscribe>
  )
}
