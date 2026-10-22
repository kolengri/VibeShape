import { assistantExternalAgentSchema } from "@vibeshape/automation-api/assistant"
import { useTranslations } from "@vibeshape/i18n"
import { useReportActivity } from "@vibeshape/ui/components/activity"
import { Alert } from "@vibeshape/ui/components/alert"
import { Button } from "@vibeshape/ui/components/button"
import { SelectOption } from "@vibeshape/ui/components/select-field"
import { Form, useAppForm } from "@vibeshape/ui/integrations/tanstack-form"
import { useRef, useState } from "react"
import {
  AssistantConnectionTestFeedback,
  useAssistantConnectionTest,
} from "./assistant-connection-test"
import { readAssistantPreferences, saveAssistantPreferences } from "./assistant-preferences"
import { useAssistantSettingsSaved } from "./assistant-settings-dialog"
import { agentPresetId, agentPresets } from "./connection-presets"
import { JevAgentConfiguration } from "./jev-agent-configuration"
import { NativeAgentActions } from "./native-agent-actions"
import type { createNativeChatController } from "./native-chat-controller"

type Connection = Pick<ReturnType<typeof createNativeChatController>, "connect" | "disconnect"> &
  Partial<Pick<ReturnType<typeof createNativeChatController>, "testConnection">>

function initialConfiguration() {
  const agent = readAssistantPreferences()?.agent ?? { command: "", args: [] }
  if ("kind" in agent) return { command: "", args: "[]", choice: "jev" }
  return { command: agent.command, args: JSON.stringify(agent.args), choice: agentPresetId(agent) }
}
function parseConfiguration({ command, args }: { command: string; args: string }) {
  try {
    return assistantExternalAgentSchema.safeParse({ command, args: JSON.parse(args) })
  } catch {
    return null
  }
}

export function NativeAgentConfiguration({
  chat,
  connecting,
  connected,
}: {
  chat: Connection
  connecting: boolean
  connected: boolean
}) {
  const t = useTranslations("app.assistant")
  const onSaved = useAssistantSettingsSaved()
  const test = useAssistantConnectionTest(chat.testConnection)
  const [initial] = useState(initialConfiguration)
  const custom = useRef({ command: initial.command, args: initial.args })
  const [advanced, setAdvanced] = useState(initial.choice === "custom")
  const [failed, setFailed] = useState(false)
  const [storageFailed, setStorageFailed] = useState(false)
  const [disconnecting, setDisconnecting] = useState(false)
  useReportActivity(disconnecting)
  const disconnect = async () => {
    setDisconnecting(true)
    try {
      await chat.disconnect()
    } finally {
      setDisconnecting(false)
    }
  }
  const connect = async (agent: Parameters<Connection["connect"]>[0]) => {
    const saved = saveAssistantPreferences({ version: 1, agent })
    setStorageFailed(!saved)
    setFailed(false)
    try {
      const accepted = await chat.connect(agent)
      setFailed(!accepted)
      if (accepted && saved) onSaved?.()
    } catch {
      setFailed(true)
    }
  }
  const validation = (value: typeof initial) => {
    const parsed = parseConfiguration(value)
    if (parsed?.success) return undefined
    return {
      fields: {
        command: parsed?.error?.issues.some(({ path }) => path[0] === "command")
          ? t("invalidAgent")
          : undefined,
        args:
          !parsed || parsed.error?.issues.some(({ path }) => path[0] === "args")
            ? t("invalidAgent")
            : undefined,
      },
    }
  }
  const form = useAppForm({
    defaultValues: initial,
    onSubmitMeta: "connect" as "connect" | "test",
    validators: {
      onSubmit: ({ value }) => validation(value),
      onChange: ({ value, formApi }) =>
        formApi.state.submissionAttempts > 0 ? validation(value) : undefined,
    },
    listeners: {
      onChange: ({ formApi, fieldApi }) => {
        test.clear()
        const { choice, command, args } = formApi.state.values
        if (fieldApi.name === "choice") {
          const preset = agentPresets.find((entry) => entry.id === choice)
          if (!preset && choice !== "custom" && choice !== "jev") return
          const next = preset
            ? { command: preset.command, args: JSON.stringify(preset.args) }
            : custom.current
          formApi.setFieldValue("command", next.command, { dontRunListeners: true })
          formApi.setFieldValue("args", next.args, { dontRunListeners: true })
          setAdvanced(choice === "custom")
          if (connected) void disconnect()
        } else {
          formApi.setFieldValue("choice", "custom", { dontRunListeners: true })
          custom.current = { command, args }
        }
      },
    },
    onSubmitInvalid: () => setAdvanced(true),
    onSubmit: async ({ value, meta }) => {
      if (connecting || disconnecting || test.pending) return
      const parsed = parseConfiguration(value)
      if (!parsed?.success) return
      if (meta === "test") {
        await test.run(parsed.data)
        return
      }
      if (connected) return
      await connect(parsed.data)
    },
  })
  return (
    <form.Subscribe selector={(state) => [state.values.choice, state.isSubmitting] as const}>
      {([choice, submitting]) => {
        const pending = connecting || disconnecting || submitting || test.pending
        const locked = pending || connected
        return (
          <div className="grid gap-2">
            <form.AppField name="choice">
              {(field) => (
                <field.SelectField label={t("agent")} disabled={pending}>
                  <SelectOption value="choose" disabled>
                    {t("chooseAgent")}
                  </SelectOption>
                  {agentPresets.map((preset) => (
                    <SelectOption key={preset.id} value={preset.id}>
                      {t(`agents.${preset.id}`)}
                    </SelectOption>
                  ))}
                  <SelectOption value="jev">{t("agents.jev")}</SelectOption>
                  <SelectOption value="custom">{t("agents.custom")}</SelectOption>
                </field.SelectField>
              )}
            </form.AppField>
            {choice === "jev" ? (
              <JevAgentConfiguration
                chat={chat}
                connected={connected}
                pending={pending}
                disconnect={disconnect}
                testing={test.pending}
                testConnection={test.run}
                clearTest={test.clear}
              />
            ) : (
              <Form
                form={form}
                onInput={test.clear}
                aria-busy={pending || undefined}
                onSubmitCapture={(event) => {
                  if (!locked) return
                  event.preventDefault()
                  event.stopPropagation()
                }}
              >
                <p className="text-xs text-muted-foreground">{t("presetNotice")}</p>
                <details
                  open={advanced}
                  onToggle={(event) => setAdvanced(event.currentTarget.open)}
                >
                  <summary className="cursor-pointer text-xs font-medium">{t("advanced")}</summary>
                  <div className="mt-2 grid gap-2">
                    <form.AppField name="command">
                      {(field) => (
                        <field.TextField
                          label={t("executable")}
                          disabled={locked}
                          placeholder={t("executablePlaceholder")}
                        />
                      )}
                    </form.AppField>
                    <form.AppField name="args">
                      {(field) => <field.TextField label={t("arguments")} disabled={locked} />}
                    </form.AppField>
                  </div>
                </details>
                {failed && <Alert>{t("errors.request-failed")}</Alert>}
                {storageFailed && (
                  <p role="status" className="text-xs text-muted-foreground">
                    {t("settingsNotSaved")}
                  </p>
                )}
                <form.Subscribe selector={(state) => Boolean(state.values.command.trim())}>
                  {(complete) => (
                    <>
                      <NativeAgentActions
                        connected={connected}
                        pending={pending}
                        disabled={!complete}
                        disconnect={disconnect}
                      />
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={pending || !complete}
                        isLoading={test.pending}
                        onClick={() => form.handleSubmit("test")}
                      >
                        {t("testConnection")}
                      </Button>
                    </>
                  )}
                </form.Subscribe>
                <p className="text-xs text-muted-foreground">{t("historyNotice")}</p>
              </Form>
            )}
            <AssistantConnectionTestFeedback result={test.result} attempt={test.attempt} />
          </div>
        )
      }}
    </form.Subscribe>
  )
}
