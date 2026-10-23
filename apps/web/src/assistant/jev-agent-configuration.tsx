import {
  type AssistantJevCredentials,
  type AssistantJevSettings,
  assistantJevCredentialsSchema,
  assistantJevSettingsSchema,
} from "@vibeshape/automation-api/assistant-jev"
import { useTranslations } from "@vibeshape/i18n"
import { Alert } from "@vibeshape/ui/components/alert"
import { Button } from "@vibeshape/ui/components/button"
import { DialogBody, DialogFooter } from "@vibeshape/ui/components/dialog"
import { SelectOption } from "@vibeshape/ui/components/select-field"
import { Form, useAppForm, withFieldGroup } from "@vibeshape/ui/integrations/tanstack-form"
import { type ReactNode, useId, useState } from "react"
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

type JevFormValues = {
  argumentChoice: string
  model: string
  apiKey: string
  argumentsEndpoint: string
  argumentsModel: string
  argumentsApiKey: string
  minConfidence: string
  timeoutMs: string
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

function optional(value: string) {
  return value.trim() || undefined
}

function argumentApiSettings(
  data: JevFormValues,
): Pick<AssistantJevSettings, "argumentsEndpoint" | "argumentsModel"> {
  if (data.argumentChoice !== "api") return {}
  const argumentsEndpoint = optional(data.argumentsEndpoint)
  const argumentsModel = optional(data.argumentsModel)
  return {
    ...(argumentsEndpoint ? { argumentsEndpoint } : {}),
    ...(argumentsModel ? { argumentsModel } : {}),
  }
}

function configurationCredentials(data: JevFormValues): AssistantJevCredentials {
  const apiKey = optional(data.apiKey)
  const argumentsApiKey = data.argumentChoice === "api" ? optional(data.argumentsApiKey) : undefined
  return {
    ...(apiKey ? { apiKey } : {}),
    ...(argumentsApiKey ? { argumentsApiKey } : {}),
  }
}

function configuration(data: JevFormValues, initial: AssistantJevSettings) {
  const argumentApi = argumentApiSettings(data)
  const credentialValues = configurationCredentials(data)
  const settings = assistantJevSettingsSchema.safeParse({
    ...argumentAgent(data.argumentChoice, initial),
    model: data.model,
    images: true,
    minConfidence: data.minConfidence.trim() ? Number(data.minConfidence) : Number.NaN,
    timeoutMs: Number(data.timeoutMs),
    ...argumentApi,
  })
  const credentials = assistantJevCredentialsSchema.safeParse(credentialValues)
  return {
    value:
      settings.success &&
      credentials.success &&
      (!credentialValues.argumentsApiKey || argumentApi.argumentsEndpoint)
        ? {
            agent: { kind: "jev" as const, settings: settings.data },
            credentials: credentials.data,
          }
        : null,
    fields: configurationFieldErrors(
      settings,
      credentials,
      argumentApi.argumentsEndpoint,
      credentialValues.argumentsApiKey,
    ),
  }
}

function initialArgumentChoice(initial: AssistantJevSettings) {
  if (!initial.argumentsAgent) return initial.argumentsEndpoint ? "api" : "none"
  const preset = agentPresetId(initial.argumentsAgent)
  return preset === "custom" ? "saved" : preset
}

function initialFormValues(initial: AssistantJevSettings): JevFormValues {
  return {
    argumentChoice: initialArgumentChoice(initial),
    model: initial.model,
    apiKey: "",
    argumentsEndpoint: initial.argumentsEndpoint ?? "",
    argumentsModel: initial.argumentsModel ?? "",
    argumentsApiKey: "",
    minConfidence: String(initial.minConfidence),
    timeoutMs: String(initial.timeoutMs),
  }
}

type JevConfigurationProps = {
  agentField?: ReactNode
  feedback?: ReactNode
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

function useJevConnectionForm({
  chat,
  connected,
  pending,
  testConnection,
  clearTest,
}: JevConfigurationProps) {
  const t = useTranslations("app.assistant")
  const onSaved = useAssistantSettingsSaved()
  const [initial] = useState(initialSettings)
  const [advanced, setAdvanced] = useState(false)
  const [failed, setFailed] = useState(false)
  const [storageFailed, setStorageFailed] = useState(false)
  const validate = (value: JevFormValues) => {
    const parsed = configuration(value, initial)
    return parsed.value
      ? undefined
      : {
          fields: Object.fromEntries(parsed.fields.map((name) => [name, t("jev.invalid")])),
        }
  }
  const form = useAppForm({
    defaultValues: initialFormValues(initial),
    onSubmitMeta: "connect" as "connect" | "test",
    validators: {
      onSubmit: ({ value }) => validate(value),
      onChange: ({ value, formApi }) =>
        formApi.state.submissionAttempts > 0 ? validate(value) : undefined,
    },
    listeners: {
      onChange: ({ formApi, fieldApi }) => {
        clearTest()
        if (fieldApi.name === "argumentsEndpoint")
          formApi.setFieldValue("argumentsApiKey", "", { dontRunListeners: true })
        if (fieldApi.name === "argumentChoice") {
          formApi.setFieldValue("argumentsEndpoint", initial.argumentsEndpoint ?? "", {
            dontRunListeners: true,
          })
          formApi.setFieldValue("argumentsModel", initial.argumentsModel ?? "", {
            dontRunListeners: true,
          })
          formApi.setFieldValue("argumentsApiKey", "", { dontRunListeners: true })
        }
      },
    },
    onSubmitInvalid: ({ formApi }) => {
      if (
        (["minConfidence", "timeoutMs"] as const).some(
          (name) => formApi.getFieldMeta(name)?.errors.length,
        )
      )
        setAdvanced(true)
    },
    onSubmit: async ({ value, meta }): Promise<void> => {
      if (pending || (connected && meta === "connect")) return
      const parsed = configuration(value, initial).value
      if (!parsed) return
      if (meta === "test") {
        await testConnection(parsed.agent, parsed.credentials)
        return
      }
      await connect(parsed)
    },
  })
  async function connect(
    parsed: NonNullable<ReturnType<typeof configuration>["value"]>,
  ): Promise<void> {
    setFailed(false)
    const saved = saveAssistantPreferences({ version: 1, agent: parsed.agent })
    setStorageFailed(!saved)
    try {
      const accepted = await chat.connect(parsed.agent, parsed.credentials)
      setFailed(!accepted)
      if (accepted) {
        form.setFieldValue("apiKey", "", { dontRunListeners: true })
        form.setFieldValue("argumentsApiKey", "", { dontRunListeners: true })
        if (saved) onSaved?.()
      }
    } catch {
      setFailed(true)
    }
  }
  return { form, initial, advanced, setAdvanced, failed, storageFailed }
}

const JevIdentityFields = withFieldGroup({
  defaultValues: { model: "", apiKey: "" },
  render: function JevIdentityFields({ group }) {
    const t = useTranslations("app.assistant")
    return (
      <>
        <group.AppField name="model">
          {(field) => (
            <field.TextField
              label={t("jev.model")}
              description={t("jev.description")}
              required
              maxLength={128}
            />
          )}
        </group.AppField>
        <group.AppField name="apiKey">
          {(field) => (
            <field.TextField
              label={t("jev.apiKey")}
              description={t("jev.keyNotice")}
              type="password"
              autoComplete="off"
              maxLength={4096}
            />
          )}
        </group.AppField>
      </>
    )
  },
})

const JevArgumentFields = withFieldGroup({
  defaultValues: {
    argumentChoice: "",
    argumentsEndpoint: "",
    argumentsModel: "",
    argumentsApiKey: "",
  },
  props: { locked: false, hasSavedAgent: false },
  render: function JevArgumentFields({ group, locked, hasSavedAgent }) {
    const t = useTranslations("app.assistant")
    return (
      <group.Subscribe selector={(state) => state.values.argumentChoice}>
        {(argumentChoice) => (
          <div className="grid gap-2">
            <group.AppField name="argumentChoice">
              {(field) => (
                <field.SelectField
                  label={t("jev.argumentModel")}
                  description={t("jev.argumentNotice")}
                  disabled={locked}
                >
                  <SelectOption value="none">{t("jev.noArgumentAgent")}</SelectOption>
                  {agentPresets.map((preset) => (
                    <SelectOption key={preset.id} value={preset.id}>
                      {t(`agents.${preset.id}`)}
                    </SelectOption>
                  ))}
                  {hasSavedAgent && (
                    <SelectOption value="saved">{t("jev.savedAgent")}</SelectOption>
                  )}
                  <SelectOption value="api">{t("jev.apiArgumentAgent")}</SelectOption>
                </field.SelectField>
              )}
            </group.AppField>
            {argumentChoice === "api" && (
              <>
                <group.AppField name="argumentsEndpoint">
                  {(field) => (
                    <field.TextField type="url" label={t("jev.endpoint")} maxLength={2048} />
                  )}
                </group.AppField>
                <group.AppField name="argumentsModel">
                  {(field) => <field.TextField label={t("jev.helperModel")} maxLength={128} />}
                </group.AppField>
                <group.AppField name="argumentsApiKey">
                  {(field) => (
                    <field.TextField
                      type="password"
                      label={t("jev.helperKey")}
                      autoComplete="off"
                      maxLength={4096}
                    />
                  )}
                </group.AppField>
              </>
            )}
          </div>
        )}
      </group.Subscribe>
    )
  },
})

const JevAdvancedFields = withFieldGroup({
  defaultValues: { minConfidence: "", timeoutMs: "" },
  props: {} as { open: boolean; onOpenChange: (open: boolean) => void },
  render: function JevAdvancedFields({ group, open, onOpenChange }) {
    const t = useTranslations("app.assistant")
    return (
      <details open={open} onToggle={(event) => onOpenChange(event.currentTarget.open)}>
        <summary className="cursor-pointer text-xs font-medium">{t("jev.advanced")}</summary>
        <div className="mt-2 grid gap-2">
          <group.AppField name="minConfidence">
            {(field) => (
              <field.TextField
                type="number"
                label={t("jev.minConfidence")}
                min={0}
                max={1}
                step="0.01"
                required
              />
            )}
          </group.AppField>
          <group.AppField name="timeoutMs">
            {(field) => (
              <field.TextField
                type="number"
                label={t("jev.timeoutMs")}
                min={1000}
                max={120000}
                required
              />
            )}
          </group.AppField>
        </div>
      </details>
    )
  },
})

export function JevAgentConfiguration(props: JevConfigurationProps) {
  const t = useTranslations("app.assistant")
  const { form, initial, advanced, setAdvanced, failed, storageFailed } =
    useJevConnectionForm(props)
  const { connected, pending, testing, disconnect, clearTest } = props
  const id = useId()
  return (
    <form.Subscribe selector={(state) => state.isSubmitting}>
      {(submitting) => {
        const working = pending || submitting
        const locked = connected || working
        return (
          <Form
            id={id}
            form={form}
            className="flex min-h-0 min-w-0 flex-1 flex-col gap-0 overflow-hidden"
            onInput={clearTest}
            aria-label={t("jev.settings")}
            aria-busy={working || undefined}
            onSubmitCapture={(event) => {
              if (!locked) return
              event.preventDefault()
              event.stopPropagation()
            }}
          >
            <DialogBody className="gap-2">
              {props.agentField}
              <fieldset disabled={locked} className="grid min-w-0 gap-2">
                <JevIdentityFields form={form} fields={{ model: "model", apiKey: "apiKey" }} />
                <JevArgumentFields
                  form={form}
                  fields={{
                    argumentChoice: "argumentChoice",
                    argumentsEndpoint: "argumentsEndpoint",
                    argumentsModel: "argumentsModel",
                    argumentsApiKey: "argumentsApiKey",
                  }}
                  locked={locked}
                  hasSavedAgent={initialArgumentChoice(initial) === "saved"}
                />
                <JevAdvancedFields
                  form={form}
                  fields={{
                    minConfidence: "minConfidence",
                    timeoutMs: "timeoutMs",
                  }}
                  open={advanced}
                  onOpenChange={setAdvanced}
                />
              </fieldset>
              {failed && <Alert>{t("errors.request-failed")}</Alert>}
              {storageFailed && (
                <p role="status" className="text-xs text-muted-foreground">
                  {t("settingsNotSaved")}
                </p>
              )}
              <p className="text-xs text-muted-foreground">{t("connectionTestNotice")}</p>
              <p className="text-xs text-muted-foreground">{t("historyNotice")}</p>
              {props.feedback}
            </DialogBody>
            <DialogFooter>
              <NativeAgentActions
                form={id}
                connected={connected}
                pending={working}
                disconnect={disconnect}
              />
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={working}
                isLoading={testing}
                onClick={() => form.handleSubmit("test")}
              >
                {t("testConnection")}
              </Button>
            </DialogFooter>
          </Form>
        )
      }}
    </form.Subscribe>
  )
}
