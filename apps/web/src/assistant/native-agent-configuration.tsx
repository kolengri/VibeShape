import { assistantAgentSchema } from "@vibeshape/automation-api/assistant"
import { useTranslations } from "@vibeshape/i18n"
import { useReportActivity } from "@vibeshape/ui/components/activity"
import { Button } from "@vibeshape/ui/components/button"
import { Input } from "@vibeshape/ui/components/input"
import { SelectField, SelectOption } from "@vibeshape/ui/components/select-field"
import { type FormEvent, useId, useRef, useState } from "react"
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
function parseConfiguration(command: string, args: string) {
  try {
    return assistantAgentSchema.safeParse({ command, args: JSON.parse(args) })
  } catch {
    return null
  }
}
function useAgentConfiguration(chat: Connection, connected: boolean) {
  const onSaved = useAssistantSettingsSaved()
  const active = useRef(false)
  const [submitting, setSubmitting] = useState(false)
  const [failed, setFailed] = useState(false)
  const [initial] = useState(initialConfiguration)
  const [draft, setDraft] = useState({ command: initial.command, args: initial.args })
  const [custom, setCustom] = useState(draft)
  const [choice, setChoice] = useState(initial.choice)
  const [advanced, setAdvanced] = useState(initial.choice === "custom")
  const [invalid, setInvalid] = useState(false)
  const [storageFailed, setStorageFailed] = useState(false)
  const [disconnecting, setDisconnecting] = useState(false)
  useReportActivity(disconnecting || submitting)
  const disconnect = async () => {
    setDisconnecting(true)
    try {
      await chat.disconnect()
    } finally {
      setDisconnecting(false)
    }
  }
  const choose = (value: string) => {
    const preset = agentPresets.find((entry) => entry.id === value)
    if (!preset && value !== "custom" && value !== "jev") return
    if (choice === "custom") setCustom(draft)
    setChoice(preset?.id ?? value)
    setDraft(preset ? { command: preset.command, args: JSON.stringify(preset.args) } : custom)
    setAdvanced(value === "custom")
    setInvalid(false)
    if (connected) void disconnect()
  }
  const edit = (key: "command" | "args", value: string) => {
    setChoice("custom")
    setDraft((previous) => ({ ...previous, [key]: value }))
  }
  const validate = () => {
    const parsed = parseConfiguration(draft.command, draft.args)
    setInvalid(!parsed?.success)
    return parsed?.success ? parsed.data : null
  }
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (disconnecting || active.current) return
    const agent = validate()
    if (!agent) return
    const saved = saveAssistantPreferences({ version: 1, agent })
    setStorageFailed(!saved)
    active.current = true
    setSubmitting(true)
    setFailed(false)
    try {
      const accepted = await chat.connect(agent)
      setFailed(!accepted)
      if (accepted && saved) onSaved?.()
    } catch {
      setFailed(true)
    } finally {
      active.current = false
      setSubmitting(false)
    }
  }
  return {
    draft,
    choice,
    advanced,
    invalid,
    storageFailed,
    submitting,
    failed,
    disconnecting,
    choose,
    edit,
    submit,
    validate,
    disconnect,
    setAdvanced,
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
  const id = useId()
  const form = useAgentConfiguration(chat, connected)
  const test = useAssistantConnectionTest(chat.testConnection)
  const pending = connecting || form.disconnecting || form.submitting || test.pending
  const locked = pending || connected
  return (
    <div className="grid gap-3">
      <SelectField
        label={t("agent")}
        value={form.choice}
        disabled={pending}
        onValueChange={(value) => {
          test.clear()
          form.choose(value)
        }}
      >
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
      </SelectField>
      {form.choice === "jev" ? (
        <JevAgentConfiguration
          chat={chat}
          connected={connected}
          pending={pending}
          disconnect={form.disconnect}
          testing={test.pending}
          testConnection={test.run}
          clearTest={test.clear}
        />
      ) : (
        <form
          className="grid gap-3"
          onInput={test.clear}
          onSubmit={(event) => {
            if (test.pending) event.preventDefault()
            else form.submit(event)
          }}
          aria-busy={pending || undefined}
        >
          <p className="text-xs text-muted-foreground">{t("presetNotice")}</p>
          <details
            open={form.advanced}
            onToggle={(event) => form.setAdvanced(event.currentTarget.open)}
          >
            <summary className="cursor-pointer text-xs font-medium">{t("advanced")}</summary>
            <div className="mt-3 grid gap-2">
              <label htmlFor={`${id}-command`} className="text-xs font-medium">
                {t("executable")}
              </label>
              <Input
                id={`${id}-command`}
                value={form.draft.command}
                disabled={locked}
                onChange={(event) => form.edit("command", event.currentTarget.value)}
                placeholder={t("executablePlaceholder")}
              />
              <label htmlFor={`${id}-args`} className="text-xs font-medium">
                {t("arguments")}
              </label>
              <Input
                id={`${id}-args`}
                value={form.draft.args}
                disabled={locked}
                onChange={(event) => form.edit("args", event.currentTarget.value)}
              />
            </div>
          </details>
          {form.invalid && (
            <p role="alert" className="text-xs text-destructive">
              {t("invalidAgent")}
            </p>
          )}
          {form.failed && (
            <p role="alert" className="text-xs text-destructive">
              {t("errors.request-failed")}
            </p>
          )}
          {form.storageFailed && (
            <p role="status" className="text-xs text-muted-foreground">
              {t("settingsNotSaved")}
            </p>
          )}
          <NativeAgentActions
            connected={connected}
            pending={pending}
            disabled={!form.draft.command.trim()}
            disconnect={form.disconnect}
          />
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={pending || !form.draft.command.trim()}
            isLoading={test.pending}
            onClick={async () => {
              const agent = form.validate()
              if (agent) await test.run(agent)
            }}
          >
            {t("testConnection")}
          </Button>
          <p className="text-xs text-muted-foreground">{t("historyNotice")}</p>
        </form>
      )}
      <AssistantConnectionTestFeedback result={test.result} attempt={test.attempt} />
    </div>
  )
}
