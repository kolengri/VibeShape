import type { AssistantBridge, AssistantSnapshot } from "@vibeshape/automation-api/assistant"
import { useTranslations } from "@vibeshape/i18n"
import { useReportActivity } from "@vibeshape/ui/components/activity"
import { Button } from "@vibeshape/ui/components/button"
import { useEffect, useState, useSyncExternalStore } from "react"
import type { DocumentControllerState } from "../document/document-controller"
import { registerProjectActionGuard } from "../document/document-controller"
import { useAutomationConnections } from "../shell/automation-status"
import { LocalAutomationStatus } from "../shell/local-automation-status"
import { AssistantPanel } from "./assistant-panel"
import { assistantStorage } from "./assistant-preferences"
import { NativeAgentConfiguration } from "./native-agent-configuration"
import { createNativeChatController } from "./native-chat-controller"
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
  const { chat, state, canSend } = useNativeChat(projectId, bridge)
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
  const [chat] = useState(() =>
    createNativeChatController({ projectId, bridge, storage: assistantStorage() }),
  )
  const state = useSyncExternalStore(chat.subscribe, chat.getSnapshot, chat.getSnapshot)
  useReportActivity(state.connecting || state.busy)
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
  return { chat, state, canSend: state.snapshot?.status === "ready" || state.busy }
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
