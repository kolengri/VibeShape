import { useTranslations } from "@vibeshape/i18n"
import { useReportActivity } from "@vibeshape/ui/components/activity"
import { useEffect, useState, useSyncExternalStore } from "react"
import { type DocumentControllerState, getProjectRuntime } from "../document/document-controller"
import { registerProjectRuntimeResource } from "../document/project-runtime-resources"
import { createApiChatRegistry } from "./api-chat-controller"
import { ApiConfigurationForm } from "./api-configuration-form"
import { assistantCheckpointBusy } from "./assistant-checkpoints"
import type { AssistantComposerProps } from "./assistant-composer"
import { type AssistantDraftDisplay, useAssistantDraftDisplay } from "./assistant-draft-display"
import { AssistantPanel } from "./assistant-panel"
import { assistantStorage } from "./assistant-preferences"
import { useAssistantToolHighlight } from "./assistant-tool-highlight"
import { createBrowserToolSession } from "./browser-tool-session"

const chats = createApiChatRegistry({
  storage: assistantStorage(),
  createTools: createBrowserToolSession,
  checkpointHost: (projectId, currentActor) => ({
    open: () => getProjectRuntime(projectId)?.createAssistantCheckpointPort() ?? null,
    currentActor,
  }),
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
  onCaptureView,
}: {
  controller: DocumentControllerState
  open: boolean
  onClose: () => void
} & Pick<AssistantComposerProps, "onCaptureView">) {
  const busy = useSyncExternalStore(chats.subscribe, chats.isBusy, chats.isBusy)
  useReportActivity(busy)
  const project = controller.report?.snapshot
  const draftDisplay = useAssistantDraftDisplay(controller)
  if (!project) return null
  return (
    <BrowserProjectChat
      key={project.id}
      projectId={project.id}
      projectName={project.name}
      draftDisplay={draftDisplay}
      open={open}
      onClose={onClose}
      onCaptureView={onCaptureView}
    />
  )
}

function BrowserProjectChat({
  projectId,
  projectName,
  draftDisplay,
  open,
  onClose,
  onCaptureView,
}: {
  projectId: string
  projectName: string
  draftDisplay?: AssistantDraftDisplay | undefined
  open: boolean
  onClose: () => void
} & Pick<AssistantComposerProps, "onCaptureView">) {
  const [chat] = useState(() => chats.get(projectId))
  const onToolHighlight = useAssistantToolHighlight(projectId)
  const state = useSyncExternalStore(chat.subscribe, chat.getSnapshot, chat.getSnapshot)
  const error = useApiChatError(state)
  useEffect(() => {
    void chats.activate(projectId)
  }, [projectId, state.busy])
  return (
    <AssistantPanel
      open={open}
      projectName={projectName}
      messages={state.messages}
      draftDisplay={draftDisplay}
      onToolHighlight={onToolHighlight}
      onApplyDraft={chat.applyDraft}
      busy={state.busy}
      canSend={state.connected && !assistantCheckpointBusy(state)}
      configurationRequired={!state.connected}
      canUndoAgentChanges={state.canUndoAgentChanges}
      undoingAgentChanges={state.undoingAgentChanges}
      viewingBefore={state.viewingBefore}
      preparingBefore={state.preparingBefore}
      onUndoAgentChanges={chat.undoAgentChanges}
      onViewBefore={chat.viewBefore}
      onClose={onClose}
      onCaptureView={onCaptureView}
      onSend={chat.send}
      onQueue={chat.enqueue}
      attachmentCapabilities={{ text: true, images: false }}
      question={state.question}
      onAnswer={chat.respondQuestion}
      queuedMessages={state.queuedMessages}
      queuePaused={state.queuePaused}
      onRemoveQueued={chat.removeQueued}
      supportsActiveSteer={state.supportsActiveSteer}
      onResumeQueue={chat.resumeQueue}
      onCancel={chat.cancel}
      onReset={chat.reset}
      storageFailed={state.storageFailed}
      onRetryHistory={chat.retryHistory}
      contextOmittedMessages={state.contextOmittedMessages}
      error={error}
      sessionControls={
        state.model ? (
          <span className="block min-w-0 truncate text-xs text-muted-foreground">
            {state.model}
          </span>
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

function useApiChatError(state: ReturnType<ReturnType<typeof chats.get>["getSnapshot"]>) {
  const t = useTranslations("app.assistant.api")
  if (state.checkpointError) return t(state.checkpointError)
  return state.error ? t(`errors.${state.error}`) : null
}
