import type { AssistantBridge, AssistantSnapshot } from "@vibeshape/automation-api/assistant"
import { useTranslations } from "@vibeshape/i18n"
import { useReportActivity } from "@vibeshape/ui/components/activity"
import { Button } from "@vibeshape/ui/components/button"
import { useEffect, useState, useSyncExternalStore } from "react"
import type { DocumentControllerState } from "../document/document-controller"
import { registerProjectActionGuard } from "../document/document-controller"
import { assistantCheckpointBusy } from "./assistant-checkpoints"
import { AssistantPanel } from "./assistant-panel"
import { NativeAgentConfiguration } from "./native-agent-configuration"
import type { createNativeChatController } from "./native-chat-controller"
import {
  getNativeProjectChatController,
  getNativeProjectChatRegistry,
} from "./native-project-chat-registry"
import { NativeSessionControls } from "./native-session-controls"

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
  const registry = getNativeProjectChatRegistry(bridge)
  const busy = useSyncExternalStore(registry.subscribe, registry.isBusy, registry.isBusy)
  useReportActivity(busy)
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
  const { chat, state, canSend, activeSteerTurn } = useNativeChat(projectId, bridge)
  const error = useNativeChatError(state)
  return (
    <AssistantPanel
      open={open}
      projectName={projectName}
      messages={state.messages}
      busy={state.busy}
      canSend={canSend && !assistantCheckpointBusy(state)}
      canUndoAgentChanges={state.canUndoAgentChanges}
      undoingAgentChanges={state.undoingAgentChanges}
      viewingBefore={state.viewingBefore}
      preparingBefore={state.preparingBefore}
      onUndoAgentChanges={chat.undoAgentChanges}
      onViewBefore={chat.viewBefore}
      onClose={onClose}
      onSend={chat.send}
      onQueue={chat.enqueue}
      {...(state.snapshot ? { attachmentCapabilities: state.snapshot.attachmentCapabilities } : {})}
      question={state.question}
      onAnswer={chat.respondQuestion}
      queuedMessages={state.queuedMessages}
      queuePaused={state.queuePaused}
      onRemoveQueued={chat.removeQueued}
      supportsActiveSteer={state.supportsActiveSteer}
      activeSteerTurn={activeSteerTurn}
      steeringQueuedId={state.steeringQueuedId}
      onSteerQueued={chat.steerQueued}
      onResumeQueue={chat.resumeQueue}
      onCancel={chat.cancel}
      onReset={chat.reset}
      storageFailed={state.storageFailed}
      error={error}
      configuration={<AgentConnection chat={chat} state={state} />}
      sessionControls={
        <NativeSessionControls
          chat={chat}
          snapshot={state.snapshot}
          busy={state.busy || state.connecting}
        />
      }
      permission={<AgentPermission chat={chat} state={state} />}
    />
  )
}

function useNativeChat(projectId: string, bridge: AssistantBridge) {
  const [chat] = useState(() => getNativeProjectChatController(bridge, projectId))
  const state = useSyncExternalStore(chat.subscribe, chat.getSnapshot, chat.getSnapshot)
  useEffect(() => {
    chat.start()
  }, [chat])
  useEffect(
    () =>
      registerProjectActionGuard(() =>
        nativeProjectActionBlocked(chat.getSnapshot()) ? "automation-busy" : null,
      ),
    [chat],
  )
  const status = state.snapshot?.status
  return {
    chat,
    state,
    canSend: status === "ready" || state.busy,
    activeSteerTurn: state.busy && status === "prompting",
  }
}

function nativeProjectActionBlocked(state: NativeChatState) {
  return (
    state.busy ||
    state.connecting ||
    assistantCheckpointBusy(state) ||
    state.queuedMessages.length > 0
  )
}

function useNativeChatError(state: NativeChatState) {
  const t = useTranslations("app.assistant")
  if (state.checkpointError) return t(state.checkpointError)
  return state.error ? t(`errors.${state.error}`) : null
}

function AgentConnection({ chat, state }: { chat: NativeChat; state: NativeChatState }) {
  const snapshot = state.snapshot
  return (
    <>
      <NativeAgentConfiguration
        chat={chat}
        connecting={state.connecting}
        connected={
          snapshot !== null &&
          ["ready", "prompting", "cancelling", "authentication-required"].includes(snapshot.status)
        }
      />
      <AgentAuthentication chat={chat} snapshot={snapshot} />
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
  return (
    <>
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
      {state.steerStartedNewTurn && (
        <p role="status" className="text-xs text-muted-foreground">
          {t("steerStartedNewTurn")}
        </p>
      )}
    </>
  )
}
