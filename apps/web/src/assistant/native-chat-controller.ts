import type {
  AssistantAgent,
  AssistantBridge,
  AssistantErrorCode,
  AssistantEvent,
  AssistantResult,
  AssistantSnapshot,
} from "@vibeshape/automation-api/assistant"
import {
  type AgentChatSession,
  type ChatMessage,
  clearChatHistory,
  readChatHistory,
  retainChatMessages,
  writeChatHistory,
} from "./chat-history"

type Permission = Extract<AssistantEvent, { type: "permission" }>
type ChatState = Readonly<{
  messages: readonly ChatMessage[]
  snapshot: AssistantSnapshot | null
  permission: Permission | null
  error: AssistantErrorCode | null
  busy: boolean
  connecting: boolean
  storageFailed: boolean
}>

export function createNativeChatController({
  projectId,
  bridge,
  storage,
}: {
  projectId: string
  bridge: AssistantBridge
  storage: Pick<Storage, "getItem" | "setItem" | "removeItem">
}) {
  const saved = readChatHistory(projectId, storage)
  let agentSession: AgentChatSession | undefined = saved?.agentSession
  let state: ChatState = {
    messages: saved?.messages ?? [],
    snapshot: null,
    permission: null,
    error: null,
    busy: false,
    connecting: false,
    storageFailed: false,
  }
  let disposed = false
  let generation = 0
  let agent: AssistantAgent | null = null
  let connecting: number | null = null
  let unsubscribe: (() => void) | undefined
  let saveTimer: ReturnType<typeof setTimeout> | undefined
  const ignoredTokens = new Set<string>()
  const toolMessages = new Map<
    string,
    {
      id: string
      title?: string
      status?: string
      text?: string
    }
  >()
  const permissions = new Map<string, Permission>()
  const listeners = new Set<() => void>()
  const publish = (patch: Partial<ChatState>) => {
    if (disposed) return
    state = { ...state, ...patch }
    for (const listener of listeners) listener()
  }
  const save = () => {
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = undefined
    const storageFailed = !writeChatHistory(projectId, state.messages, storage, agentSession)
    if (state.storageFailed !== storageFailed) publish({ storageFailed })
  }
  const queueSave = () => {
    saveTimer ??= setTimeout(save, 200)
  }
  const append = (role: ChatMessage["role"], text: string) => {
    const messages = [...state.messages]
    const last = messages.at(-1)
    if ((role === "assistant" || role === "thought") && last?.role === role)
      messages[messages.length - 1] = { ...last, text: (last.text + text).slice(0, 32_000) }
    else messages.push({ id: crypto.randomUUID(), role, text: text.slice(0, 32_000) })
    publish({ messages: retainChatMessages(messages) })
    queueSave()
  }
  const scope = () =>
    state.snapshot ? { projectId, sessionToken: state.snapshot.sessionToken } : null
  function acceptSnapshot(snapshot: AssistantSnapshot) {
    publish({ snapshot, busy: ["prompting", "cancelling"].includes(snapshot.status) })
    if (agent && snapshot.canResume && snapshot.sessionId) {
      agentSession = { agent, sessionId: snapshot.sessionId }
      save()
    }
  }
  function updateTool(event: Extract<AssistantEvent, { type: "tool" }>) {
    const previous = toolMessages.get(event.toolCallId) ?? { id: crypto.randomUUID() }
    const merged = {
      ...previous,
      ...(event.title !== undefined ? { title: event.title } : {}),
      ...(event.status !== undefined ? { status: event.status } : {}),
      ...(event.text !== undefined ? { text: event.text } : {}),
    }
    const { id } = merged
    toolMessages.set(event.toolCallId, merged)
    const text = [merged.title, merged.status, merged.text]
      .filter(Boolean)
      .join("\n")
      .slice(0, 32_000)
    const messages = [...state.messages]
    const index = messages.findIndex((message) => message.id === id)
    const message: ChatMessage = { id, role: "tool", text }
    if (index >= 0) messages[index] = message
    else messages.push(message)
    publish({ messages: retainChatMessages(messages) })
    queueSave()
  }
  function permissionState() {
    return { permission: permissions.values().next().value ?? null }
  }
  function removePermission(requestId: string) {
    if (permissions.delete(requestId)) publish(permissionState())
  }
  function acceptsEvent(event: AssistantEvent) {
    if (disposed || event.projectId !== projectId || ignoredTokens.has(event.sessionToken))
      return false
    if (state.snapshot?.sessionToken === event.sessionToken) return true
    return state.connecting && event.type === "snapshot"
  }
  function dispatchEvent(event: AssistantEvent) {
    switch (event.type) {
      case "snapshot":
        acceptSnapshot(event.snapshot)
        break
      case "text":
        append("assistant", event.text)
        break
      case "thought":
        append("thought", event.text)
        break
      case "tool":
        updateTool(event)
        break
      case "permission":
        permissions.set(event.requestId, event)
        publish(permissionState())
        break
      case "permission-resolved":
        removePermission(event.requestId)
        break
      case "completed":
        permissions.clear()
        toolMessages.clear()
        publish({ busy: false, permission: null })
        save()
        break
      case "error":
        permissions.clear()
        publish({ error: event.code, busy: false, permission: null })
        break
    }
  }
  function event(event: AssistantEvent) {
    if (acceptsEvent(event)) dispatchEvent(event)
  }
  function isCurrent(at: number) {
    return !disposed && generation === at
  }
  function acceptResult(result: AssistantResult) {
    if (result.ok) acceptSnapshot(result.value)
    else publish({ error: result.code })
  }
  async function run(action: () => Promise<AssistantResult>) {
    const at = generation
    try {
      const result = await action()
      if (isCurrent(at)) acceptResult(result)
      return result
    } catch {
      if (generation === at) publish({ error: "request-failed" })
      return { ok: false, code: "request-failed" } as const
    }
  }
  function beginDisconnect() {
    const current = scope()
    const at = ++generation
    connecting = null
    if (current) ignoredTokens.add(current.sessionToken)
    permissions.clear()
    toolMessages.clear()
    publish({ snapshot: null, busy: false, connecting: false, permission: null })
    save()
    const done = current ? bridge.disconnect(current).catch(() => undefined) : Promise.resolve()
    return { at, done }
  }
  async function disconnect() {
    await beginDisconnect().done
  }
  function matchingResume(configuration: AssistantAgent) {
    if (!agentSession) return undefined
    return JSON.stringify(agentSession.agent) === JSON.stringify(configuration)
      ? agentSession.sessionId
      : undefined
  }
  async function discardConnection(result: AssistantResult) {
    if (result.ok) await bridge.disconnect({ projectId, sessionToken: result.value.sessionToken })
  }
  async function receiveConnection(at: number, result: AssistantResult) {
    if (isCurrent(at)) acceptResult(result)
    else await discardConnection(result)
  }
  function finishConnecting(at: number) {
    if (connecting === at) connecting = null
    if (isCurrent(at)) publish({ connecting: false })
  }
  async function connect(configuration: AssistantAgent) {
    if (disposed || connecting !== null || state.busy) return
    const { at, done } = beginDisconnect()
    if (!isCurrent(at)) return
    connecting = at
    publish({ connecting: true, error: null })
    try {
      await done
      if (!isCurrent(at)) return
      agent = configuration
      const resume = matchingResume(configuration)
      const result = await bridge.connect({
        projectId,
        agent: configuration,
        ...(resume ? { resumeSessionId: resume } : {}),
      })
      await receiveConnection(at, result)
    } catch {
      if (isCurrent(at)) publish({ error: "request-failed" })
    } finally {
      finishConnecting(at)
    }
  }
  return {
    getSnapshot: () => state,
    start() {
      if (unsubscribe) return
      disposed = false
      unsubscribe = bridge.onEvent(event)
    },
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    connect,
    disconnect,
    async send(text: string) {
      const current = scope()
      if (!current || state.busy || state.snapshot?.status !== "ready") return
      publish({ busy: true, error: null })
      const at = generation
      toolMessages.clear()
      append("user", text)
      await run(() => bridge.prompt({ ...current, text }))
      if (generation === at) {
        publish({ busy: false })
        save()
      }
    },
    async cancel() {
      const current = scope()
      permissions.clear()
      publish({ permission: null })
      if (current) await run(() => bridge.cancel(current))
    },
    async reset() {
      const { at, done } = beginDisconnect()
      await done
      if (!isCurrent(at)) return
      agentSession = undefined
      publish({ messages: [], error: null, storageFailed: !clearChatHistory(projectId, storage) })
      if (agent) await connect(agent)
    },
    async respondPermission(allow: boolean) {
      const current = scope(),
        permission = state.permission
      if (current && permission) {
        const at = generation
        const result = await run(() =>
          bridge.respondPermission({ ...current, requestId: permission.requestId, allow }),
        )
        if (result.ok && generation === at) removePermission(permission.requestId)
      }
    },
    async setMode(modeId: string) {
      const current = scope()
      if (current) await run(() => bridge.setMode({ ...current, modeId }))
    },
    async setModel(modelId: string) {
      const current = scope()
      if (current) await run(() => bridge.setModel({ ...current, modelId }))
    },
    async authenticate(methodId: string) {
      const current = scope()
      if (current) await run(() => bridge.authenticate({ ...current, methodId }))
    },
    dispose() {
      if (disposed) return
      const current = scope()
      save()
      disposed = true
      generation += 1
      connecting = null
      unsubscribe?.()
      unsubscribe = undefined
      permissions.clear()
      toolMessages.clear()
      state = { ...state, snapshot: null, busy: false, connecting: false, permission: null }
      if (current) void bridge.disconnect(current).catch(() => undefined)
    },
  }
}
