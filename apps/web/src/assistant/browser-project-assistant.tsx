import { useTranslations } from "@vibeshape/i18n"
import { useReportActivity } from "@vibeshape/ui/components/activity"
import { useEffect, useState, useSyncExternalStore } from "react"
import {
  type DocumentControllerState,
  registerProjectActionGuard,
} from "../document/document-controller"
import { createApiChatController } from "./api-chat-controller"
import { ApiConfigurationForm } from "./api-configuration-form"
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
  useReportActivity(state.busy)
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
      sessionControls={
        <p role="status" className="text-xs text-muted-foreground">
          {t(state.connected ? "connected" : "disconnected")}
        </p>
      }
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
