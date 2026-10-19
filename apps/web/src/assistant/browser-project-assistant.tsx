import { useTranslations } from "@vibeshape/i18n"
import { useReportActivity } from "@vibeshape/ui/components/activity"
import { useEffect, useState, useSyncExternalStore } from "react"
import { type DocumentControllerState, getProjectRuntime } from "../document/document-controller"
import { registerProjectRuntimeResource } from "../document/project-runtime-resources"
import { createApiChatRegistry } from "./api-chat-controller"
import { ApiConfigurationForm } from "./api-configuration-form"
import { AssistantPanel } from "./assistant-panel"
import { assistantStorage } from "./assistant-preferences"
import { createBrowserToolSession } from "./browser-tool-session"

const chats = createApiChatRegistry({
  storage: assistantStorage(),
  createTools: createBrowserToolSession,
  registerResource: registerProjectRuntimeResource,
  registerGuard: (projectId, blocked) =>
    getProjectRuntime(projectId)?.registerProjectActionGuard(() =>
      blocked() ? "automation-busy" : null,
    ),
})

export function BrowserProjectAssistant({
  controller,
  open,
  onClose,
}: {
  controller: DocumentControllerState
  open: boolean
  onClose: () => void
}) {
  const busy = useSyncExternalStore(chats.subscribe, chats.isBusy, chats.isBusy)
  useReportActivity(busy)
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
  const [chat] = useState(() => chats.get(projectId))
  const state = useSyncExternalStore(chat.subscribe, chat.getSnapshot, chat.getSnapshot)
  useEffect(() => {
    void chats.activate(projectId)
  }, [projectId, state.busy])
  return (
    <AssistantPanel
      open={open}
      projectName={projectName}
      messages={state.messages}
      busy={state.busy}
      canSend={state.connected}
      onClose={onClose}
      onSend={chat.send}
      onQueue={chat.enqueue}
      attachmentCapabilities={{ text: true, images: false }}
      question={state.question}
      onAnswer={chat.respondQuestion}
      queuedMessages={state.queuedMessages}
      queuePaused={state.queuePaused}
      onRemoveQueued={chat.removeQueued}
      onResumeQueue={chat.resumeQueue}
      onCancel={chat.cancel}
      onReset={chat.reset}
      storageFailed={state.storageFailed}
      error={state.error ? t(`errors.${state.error}`) : null}
      sessionControls={
        state.model ? (
          <span className="min-w-0 truncate text-xs text-muted-foreground">{state.model}</span>
        ) : undefined
      }
      configuration={
        <ApiConfigurationForm
          chat={{
            connect: (input) => chats.connect(projectId, input),
            disconnect: () => chats.disconnect(projectId),
          }}
          busy={state.busy}
          connected={state.connected}
        />
      }
    />
  )
}
