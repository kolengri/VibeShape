import {
  type AssistantBridge,
  type AssistantSnapshot,
  assistantAgentSchema,
} from "@vibeshape/automation-api/assistant"
import { useTranslations } from "@vibeshape/i18n"
import { Button } from "@vibeshape/ui/components/button"
import { Input } from "@vibeshape/ui/components/input"
import { SelectField, SelectOption } from "@vibeshape/ui/components/select-field"
import { type FormEvent, useEffect, useId, useState, useSyncExternalStore } from "react"
import type { DocumentControllerState } from "../document/document-controller"
import { registerProjectActionGuard } from "../document/document-controller"
import { useAutomationConnections } from "../shell/automation-status"
import { LocalAutomationStatus } from "../shell/local-automation-status"
import { AssistantPanel } from "./assistant-panel"
import {
  assistantStorage,
  readAssistantPreferences,
  saveAssistantPreferences,
} from "./assistant-preferences"
import { createNativeChatController } from "./native-chat-controller"

type NativeChat = ReturnType<typeof createNativeChatController>
type NativeChatState = ReturnType<NativeChat["getSnapshot"]>

export function NativeProjectAssistant({
  bridge,
  controller,
  open,
  onClose,
}: {
  bridge: AssistantBridge
  controller: DocumentControllerState
  open: boolean
  onClose: () => void
}) {
  const project = controller.report?.snapshot
  if (!project) return null
  return (
    <NativeProjectChat
      key={project.id}
      bridge={bridge}
      projectId={project.id}
      projectName={project.name}
      open={open}
      onClose={onClose}
    />
  )
}

function NativeProjectChat({
  bridge,
  projectId,
  projectName,
  open,
  onClose,
}: {
  bridge: AssistantBridge
  projectId: string
  projectName: string
  open: boolean
  onClose: () => void
}) {
  const t = useTranslations("app.assistant")
  const [chat] = useState(() =>
    createNativeChatController({ projectId, bridge, storage: assistantStorage() }),
  )
  const state = useSyncExternalStore(chat.subscribe, chat.getSnapshot, chat.getSnapshot)
  useEffect(() => {
    chat.start()
    return () => chat.dispose()
  }, [chat])
  useEffect(
    () =>
      registerProjectActionGuard(() =>
        chat.getSnapshot().busy || chat.getSnapshot().connecting ? "automation-busy" : null,
      ),
    [chat],
  )
  const canSend = state.snapshot?.status === "ready" || state.busy
  return (
    <AssistantPanel
      open={open}
      projectName={projectName}
      messages={state.messages}
      busy={state.busy}
      canSend={canSend}
      onClose={onClose}
      onSend={chat.send}
      onCancel={chat.cancel}
      onReset={chat.reset}
      storageFailed={state.storageFailed}
      error={state.error ? t(`errors.${state.error}`) : null}
      configuration={<AgentConnection chat={chat} state={state} />}
      permission={<AgentPermission chat={chat} state={state} />}
    />
  )
}

function AgentConnection({ chat, state }: { chat: NativeChat; state: NativeChatState }) {
  const snapshot = state.snapshot
  return (
    <>
      <AgentConfiguration
        chat={chat}
        connecting={state.connecting}
        connected={snapshot?.status === "ready"}
      />
      <AgentSessionStatus snapshot={snapshot} />
      <AgentSessionControls chat={chat} snapshot={snapshot} busy={state.busy} />
      <AgentAuthentication chat={chat} snapshot={snapshot} />
    </>
  )
}

function AgentSessionStatus({ snapshot }: { snapshot: AssistantSnapshot | null }) {
  const t = useTranslations("app.assistant")
  const status = snapshot?.status ?? "disconnected"
  return (
    <p className="mt-2 text-xs text-muted-foreground" role="status">
      {t(`status.${status}`)}
    </p>
  )
}

function AgentSessionSelector({
  kind,
  options,
  value,
  busy,
  onChange,
}: {
  kind: "mode" | "model"
  options: readonly { id: string; name: string }[]
  value: string | null
  busy: boolean
  onChange: (value: string) => Promise<void>
}) {
  const t = useTranslations("app.assistant")
  if (!options.length) return null
  return (
    <SelectField label={t(kind)} value={value ?? ""} disabled={busy} onValueChange={onChange}>
      {options.map((option) => (
        <SelectOption key={option.id} value={option.id}>
          {option.name}
        </SelectOption>
      ))}
    </SelectField>
  )
}

function AgentSessionControls({
  chat,
  snapshot,
  busy,
}: {
  chat: NativeChat
  snapshot: AssistantSnapshot | null
  busy: boolean
}) {
  if (!snapshot) return null
  return (
    <>
      <AgentSessionSelector
        kind="mode"
        options={snapshot.modes}
        value={snapshot.currentModeId}
        busy={busy}
        onChange={chat.setMode}
      />
      <AgentSessionSelector
        kind="model"
        options={snapshot.models}
        value={snapshot.currentModelId}
        busy={busy}
        onChange={chat.setModel}
      />
    </>
  )
}

function AgentAuthentication({
  chat,
  snapshot,
}: {
  chat: NativeChat
  snapshot: AssistantSnapshot | null
}) {
  const t = useTranslations("app.assistant")
  if (snapshot?.status !== "authentication-required") return null
  return (
    <>
      {snapshot.authMethods.map((method) => (
        <Button key={method.id} variant="outline" onClick={() => chat.authenticate(method.id)}>
          {t("authenticate", { method: method.name })}
        </Button>
      ))}
    </>
  )
}

function AgentPermission({ chat, state }: { chat: NativeChat; state: NativeChatState }) {
  const t = useTranslations("app.assistant")
  const { current, connection } = useAutomationConnections()
  return (
    <>
      {state.snapshot && (
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span>{t("modelAccess")}</span>
          <LocalAutomationStatus current={current} connection={connection} />
        </div>
      )}
      {state.permission && (
        <fieldset className="space-y-2 rounded-md border p-2">
          <legend className="sr-only">{t("permission")}</legend>
          <p className="text-sm">{state.permission.title}</p>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => chat.respondPermission(false)}>
              {t("deny")}
            </Button>
            <Button
              size="sm"
              disabled={!state.permission.canAllow}
              onClick={() => chat.respondPermission(true)}
            >
              {t("allowOnce")}
            </Button>
          </div>
        </fieldset>
      )}
    </>
  )
}

function initialAgentConfiguration() {
  const initial = readAssistantPreferences()?.agent ?? { command: "", args: [] }
  return { command: initial.command, args: JSON.stringify(initial.args) }
}

function parseAgentConfiguration(command: string, args: string) {
  try {
    return assistantAgentSchema.safeParse({ command, args: JSON.parse(args) })
  } catch {
    return null
  }
}

function useAgentConfigurationForm(chat: NativeChat) {
  const [saved] = useState(initialAgentConfiguration)
  const [command, setCommand] = useState(saved.command)
  const [args, setArgs] = useState(saved.args)
  const [invalid, setInvalid] = useState(false)
  const [storageFailed, setStorageFailed] = useState(false)
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const agent = parseAgentConfiguration(command, args)
    if (!agent?.success) {
      setInvalid(true)
      return
    }
    setInvalid(false)
    setStorageFailed(!saveAssistantPreferences({ version: 1, agent: agent.data }))
    void chat.connect(agent.data)
  }
  return { command, args, invalid, storageFailed, setCommand, setArgs, submit }
}

function AgentConfigurationFeedback({
  invalid,
  storageFailed,
}: {
  invalid: boolean
  storageFailed: boolean
}) {
  const t = useTranslations("app.assistant")
  return (
    <>
      {invalid && (
        <p role="alert" className="text-xs text-destructive">
          {t("invalidAgent")}
        </p>
      )}
      {storageFailed && (
        <p role="status" className="text-xs text-muted-foreground">
          {t("settingsNotSaved")}
        </p>
      )}
    </>
  )
}

function AgentConfiguration({
  chat,
  connecting,
  connected,
}: {
  chat: NativeChat
  connecting: boolean
  connected: boolean
}) {
  const t = useTranslations("app.assistant")
  const commandId = useId(),
    argsId = useId()
  const form = useAgentConfigurationForm(chat)
  const locked = connecting || connected
  return (
    <form className="grid gap-2" onSubmit={form.submit}>
      <p className="text-xs text-muted-foreground">{t("agentDescription")}</p>
      <label htmlFor={commandId} className="text-xs font-medium">
        {t("executable")}
      </label>
      <Input
        id={commandId}
        value={form.command}
        disabled={locked}
        onChange={(event) => form.setCommand(event.currentTarget.value)}
        placeholder={t("executablePlaceholder")}
      />
      <label htmlFor={argsId} className="text-xs font-medium">
        {t("arguments")}
      </label>
      <Input
        id={argsId}
        value={form.args}
        disabled={locked}
        onChange={(event) => form.setArgs(event.currentTarget.value)}
      />
      <AgentConfigurationFeedback invalid={form.invalid} storageFailed={form.storageFailed} />
      {connected ? (
        <Button type="button" size="sm" variant="outline" onClick={chat.disconnect}>
          {t("disconnect")}
        </Button>
      ) : (
        <Button type="submit" size="sm" isLoading={connecting} disabled={!form.command.trim()}>
          {t("connect")}
        </Button>
      )}
      <p className="text-xs text-muted-foreground">{t("historyNotice")}</p>
    </form>
  )
}
