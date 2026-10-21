import type { AssistantAgent, AssistantBridge } from "@vibeshape/automation-api/assistant"
import type { AssistantJevCredentials } from "@vibeshape/automation-api/assistant-jev"
import { getNativeProjectAutomationConnection } from "../automation/native-project-automation"
import { getProjectRuntime } from "../document/document-controller"
import { registerProjectRuntimeResource } from "../document/project-runtime-resources"
import type { AssistantCheckpointHost } from "./assistant-checkpoints"
import { assistantStorage, readAssistantPreferences } from "./assistant-preferences"
import { createNativeChatController } from "./native-chat-controller"

type Chat = ReturnType<typeof createNativeChatController>
type StoragePort = Parameters<typeof createNativeChatController>[0]["storage"]

export function createNativeProjectChatRegistry(
  bridge: AssistantBridge,
  storage: StoragePort,
  checkpointHost?: (projectId: string) => AssistantCheckpointHost,
  automation?: (
    projectId: string,
  ) => NonNullable<Parameters<typeof createNativeChatController>[0]["automation"]>,
) {
  const projects = new Map<string, Chat>()
  const releases = new Map<string, () => void>()
  const listeners = new Set<() => void>()
  const publish = () => {
    for (const listener of listeners) listener()
  }
  let closed = false
  function get(projectId: string): Chat {
    const existing = projects.get(projectId)
    if (existing) return existing
    const controller = createNativeChatController({
      projectId,
      bridge,
      storage,
      ...(checkpointHost ? { checkpointHost: checkpointHost(projectId) } : {}),
      ...(automation ? { automation: automation(projectId) } : {}),
    })
    let attempted = false
    let explicitlyDisconnected = false
    const chat: Chat = {
      ...controller,
      start() {
        if (closed) return
        controller.start()
        if (attempted || explicitlyDisconnected) return
        const configured = readAssistantPreferences(storage)?.agent
        if (configured) {
          attempted = true
          void controller.connect(configured)
        }
      },
      async connect(agent: AssistantAgent, credentials?: AssistantJevCredentials) {
        if (closed) return false
        attempted = true
        explicitlyDisconnected = false
        return controller.connect(agent, credentials)
      },
      async disconnect() {
        explicitlyDisconnected = true
        await controller.disconnect()
      },
    }
    projects.set(projectId, chat)
    const unsubscribe = controller.subscribe(publish)
    const unregister = registerProjectRuntimeResource(projectId, {
      isBusy: () => {
        const state = controller.getSnapshot()
        return (
          state.busy ||
          state.connecting ||
          state.undoingAgentChanges ||
          state.preparingBefore ||
          state.settlingCheckpoint ||
          state.queuedMessages.length > 0
        )
      },
      async dispose() {
        await controller.disconnect()
        controller.dispose()
        releases.get(projectId)?.()
        projects.delete(projectId)
        publish()
      },
    })
    releases.set(projectId, () => {
      unsubscribe()
      unregister()
      releases.delete(projectId)
    })
    return chat
  }
  return {
    get,
    isBusy: () =>
      [...projects.values()].some((chat) => {
        const state = chat.getSnapshot()
        return (
          state.busy ||
          state.connecting ||
          state.undoingAgentChanges ||
          state.preparingBefore ||
          state.settlingCheckpoint
        )
      }),
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    dispose() {
      if (closed) return
      closed = true
      for (const [projectId, chat] of projects) {
        chat.dispose()
        releases.get(projectId)?.()
      }
      projects.clear()
      publish()
    },
  }
}

const registries = new WeakMap<
  AssistantBridge,
  ReturnType<typeof createNativeProjectChatRegistry>
>()

export function getNativeProjectChatRegistry(bridge: AssistantBridge) {
  let registry = registries.get(bridge)
  if (!registry) {
    registry = createNativeProjectChatRegistry(
      bridge,
      assistantStorage(),
      (projectId) => ({
        open: () => getProjectRuntime(projectId)?.createAssistantCheckpointPort() ?? null,
        currentActor: () => getNativeProjectAutomationConnection(projectId).currentActor(),
        subscribeActor: (listener) =>
          getNativeProjectAutomationConnection(projectId).subscribe(listener),
      }),
      getNativeProjectAutomationConnection,
    )
    registries.set(bridge, registry)
  }
  return registry
}

export function getNativeProjectChatController(bridge: AssistantBridge, projectId: string) {
  return getNativeProjectChatRegistry(bridge).get(projectId)
}
