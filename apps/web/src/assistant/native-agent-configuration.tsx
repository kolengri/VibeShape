import { assistantAgentSchema } from "@vibeshape/automation-api/assistant"
import { useTranslations } from "@vibeshape/i18n"
import { useReportActivity } from "@vibeshape/ui/components/activity"
import { Button } from "@vibeshape/ui/components/button"
import { Input } from "@vibeshape/ui/components/input"
import { SelectField, SelectOption } from "@vibeshape/ui/components/select-field"
import { type FormEvent, useId, useState } from "react"
import { readAssistantPreferences, saveAssistantPreferences } from "./assistant-preferences"
import { agentPresetId, agentPresets } from "./connection-presets"
import type { createNativeChatController } from "./native-chat-controller"

type Connection = Pick<ReturnType<typeof createNativeChatController>, "connect" | "disconnect">

function initialConfiguration() {
  const agent = readAssistantPreferences()?.agent ?? { command: "", args: [] }
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
  const [initial] = useState(initialConfiguration)
  const [draft, setDraft] = useState({ command: initial.command, args: initial.args })
  const [custom, setCustom] = useState(draft)
  const [choice, setChoice] = useState(initial.choice)
  const [advanced, setAdvanced] = useState(initial.choice === "custom")
  const [invalid, setInvalid] = useState(false)
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
  const choose = (value: string) => {
    const preset = agentPresets.find((entry) => entry.id === value)
    if (!preset && value !== "custom") return
    if (choice === "custom") setCustom(draft)
    setChoice(preset?.id ?? "custom")
    setDraft(preset ? { command: preset.command, args: JSON.stringify(preset.args) } : custom)
    setAdvanced(!preset)
    setInvalid(false)
    if (connected) void disconnect()
  }
  const edit = (key: "command" | "args", value: string) => {
    setChoice("custom")
    setDraft((previous) => ({ ...previous, [key]: value }))
  }
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (disconnecting) return
    const parsed = parseConfiguration(draft.command, draft.args)
    if (!parsed?.success) {
      setInvalid(true)
      return
    }
    setInvalid(false)
    setStorageFailed(!saveAssistantPreferences({ version: 1, agent: parsed.data }))
    void chat.connect(parsed.data)
  }
  return {
    draft,
    choice,
    advanced,
    invalid,
    storageFailed,
    disconnecting,
    choose,
    edit,
    submit,
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
  const pending = connecting || form.disconnecting
  const locked = pending || connected
  return (
    <form className="grid gap-3" onSubmit={form.submit} aria-busy={pending || undefined}>
      <SelectField
        label={t("agent")}
        value={form.choice}
        disabled={pending}
        onValueChange={form.choose}
      >
        <SelectOption value="choose" disabled>
          {t("chooseAgent")}
        </SelectOption>
        {agentPresets.map((preset) => (
          <SelectOption key={preset.id} value={preset.id}>
            {t(`agents.${preset.id}`)}
          </SelectOption>
        ))}
        <SelectOption value="custom">{t("agents.custom")}</SelectOption>
      </SelectField>
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
      {form.storageFailed && (
        <p role="status" className="text-xs text-muted-foreground">
          {t("settingsNotSaved")}
        </p>
      )}
      {connected ? (
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={pending}
          onClick={form.disconnect}
        >
          {t("disconnect")}
        </Button>
      ) : (
        <Button
          type="submit"
          size="sm"
          aria-busy={pending || undefined}
          disabled={pending || !form.draft.command.trim()}
        >
          {t("connect")}
        </Button>
      )}
      <p className="text-xs text-muted-foreground">{t("historyNotice")}</p>
    </form>
  )
}
