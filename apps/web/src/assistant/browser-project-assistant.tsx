import { useTranslations } from "@vibeshape/i18n"
import { Button } from "@vibeshape/ui/components/button"
import { Input } from "@vibeshape/ui/components/input"
import { type FormEvent, useEffect, useId, useState, useSyncExternalStore } from "react"
import {
  type DocumentControllerState,
  registerProjectActionGuard,
} from "../document/document-controller"
import { apiConfigurationSchema } from "./api-assistant-preferences"
import { useApiAssistantSettings } from "./api-assistant-provider"
import { createApiChatController } from "./api-chat-controller"
import { AssistantPanel } from "./assistant-panel"
import { assistantStorage } from "./assistant-preferences"
import { createBrowserToolSession } from "./browser-tool-session"

export function BrowserProjectAssistant({
  controller,
  open,
  onClose,
}: {
  controller: DocumentControllerState
  open: boolean
  onClose: () => void
}) {
  const project = controller.report?.snapshot
  if (!project) return null
  return (
    <BrowserProjectChat
      key={project.id}
      projectId={project.id}
      projectName={project.name}
      open={open}
      onClose={onClose}
    />
  )
}

function BrowserProjectChat({
  projectId,
  projectName,
  open,
  onClose,
}: {
  projectId: string
  projectName: string
  open: boolean
  onClose: () => void
}) {
  const t = useTranslations("app.assistant.api")
  const [chat] = useState(() =>
    createApiChatController({
      projectId,
      storage: assistantStorage(),
      createTools: createBrowserToolSession,
      toolLabel: (name, completed) => t(completed ? "toolCompleted" : "toolRunning", { name }),
    }),
  )
  const state = useSyncExternalStore(chat.subscribe, chat.getSnapshot, chat.getSnapshot)
  useEffect(() => {
    chat.start()
    return () => chat.dispose()
  }, [chat])
  useEffect(
    () => registerProjectActionGuard(() => (chat.getSnapshot().busy ? "automation-busy" : null)),
    [chat],
  )
  return (
    <AssistantPanel
      open={open}
      projectName={projectName}
      messages={state.messages}
      busy={state.busy}
      canSend={state.connected}
      onClose={onClose}
      onSend={chat.send}
      onCancel={chat.cancel}
      onReset={chat.reset}
      storageFailed={state.storageFailed}
      error={state.error ? t(`errors.${state.error}`) : null}
      configuration={
        <ApiConfigurationForm chat={chat} busy={state.busy} connected={state.connected} />
      }
      permission={
        state.connected ? (
          <p role="status" className="text-xs text-muted-foreground">
            {t("grant")}
          </p>
        ) : undefined
      }
    />
  )
}

function useApiConnectionForm(chat: ReturnType<typeof createApiChatController>) {
  const settings = useApiAssistantSettings()
  const [endpoint, setEndpoint] = useState(settings.configuration.endpoint)
  const [model, setModel] = useState(settings.configuration.model)
  const [apiKey, setApiKey] = useState(settings.configuration.apiKey)
  const [stream, setStream] = useState(settings.configuration.stream)
  const [invalid, setInvalid] = useState(false)
  const [storageFailed, setStorageFailed] = useState(false)
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const parsed = apiConfigurationSchema.safeParse({ endpoint, model, apiKey, stream })
    if (!parsed.success) {
      setInvalid(true)
      return
    }
    setInvalid(false)
    setStorageFailed(!settings.configure(parsed.data))
    void chat.connect(parsed.data)
  }
  const changeEndpoint = (value: string) => {
    setEndpoint(value)
    if (value.trim() !== settings.configuration.endpoint) setApiKey("")
  }
  return {
    endpoint,
    model,
    apiKey,
    stream,
    invalid,
    storageFailed,
    submit,
    changeEndpoint,
    setModel,
    setApiKey,
    setStream,
  }
}

function ApiConfigurationFeedback({
  invalid,
  storageFailed,
}: {
  invalid: boolean
  storageFailed: boolean
}) {
  const t = useTranslations("app.assistant.api")
  return (
    <>
      {invalid && (
        <p role="alert" className="text-sm text-destructive">
          {t("errors.invalid-configuration")}
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

function ApiConfigurationForm({
  chat,
  busy,
  connected,
}: {
  chat: ReturnType<typeof createApiChatController>
  busy: boolean
  connected: boolean
}) {
  const t = useTranslations("app.assistant.api")
  const id = useId()
  const form = useApiConnectionForm(chat)
  return (
    <form className="grid gap-2" onSubmit={form.submit}>
      <h3 className="text-sm font-medium">{t("label")}</h3>
      <p className="text-xs text-muted-foreground">{t("description")}</p>
      <label htmlFor={`${id}-endpoint`} className="text-xs">
        {t("endpoint")}
      </label>
      <Input
        id={`${id}-endpoint`}
        type="url"
        required
        value={form.endpoint}
        maxLength={2048}
        disabled={busy}
        onChange={(event) => form.changeEndpoint(event.currentTarget.value)}
      />
      <label htmlFor={`${id}-model`} className="text-xs">
        {t("model")}
      </label>
      <Input
        id={`${id}-model`}
        required
        value={form.model}
        maxLength={128}
        disabled={busy}
        onChange={(event) => form.setModel(event.currentTarget.value)}
      />
      <label htmlFor={`${id}-key`} className="text-xs">
        {t("apiKey")}
      </label>
      <Input
        id={`${id}-key`}
        type="password"
        autoComplete="off"
        value={form.apiKey}
        maxLength={4096}
        disabled={busy}
        onChange={(event) => form.setApiKey(event.currentTarget.value)}
        aria-describedby={`${id}-key-memory`}
      />
      <p id={`${id}-key-memory`} className="text-xs text-muted-foreground">
        {t("keyMemory")}
      </p>
      <label className="flex items-center gap-2 text-xs">
        <input
          type="checkbox"
          checked={form.stream}
          disabled={busy}
          onChange={(event) => form.setStream(event.currentTarget.checked)}
        />
        {t("stream")}
      </label>
      <ApiConfigurationFeedback invalid={form.invalid} storageFailed={form.storageFailed} />
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={busy}>
          {t("connect")}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={!connected || busy}
          onClick={chat.disconnect}
        >
          {t("disconnect")}
        </Button>
      </div>
      <p role="status" className="text-xs text-muted-foreground">
        {t(connected ? "connected" : "disconnected")}
      </p>
    </form>
  )
}
