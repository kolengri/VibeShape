import type {
  AssistantAgent,
  AssistantAttachment,
  AssistantBridge,
  AssistantErrorCode,
  AssistantEvent,
  AssistantQuestion,
  AssistantResult,
  AssistantSnapshot,
} from "@vibeshape/automation-api/assistant"
import { assistantPromptSchema } from "@vibeshape/automation-api/assistant"
import {
  type AgentChatSession,
  type ChatMessage,
  clearChatHistory,
  readChatHistory,
  retainChatMessages,
  writeChatHistory,
} from "./chat-history"

type Permission = Extract<AssistantEvent, { type: "permission" }>
type QueuedPrompt = {
  id: string
  text: string
  attachments: readonly AssistantAttachment[]
  started: boolean
}
type ChatState = Readonly<{
  messages: readonly ChatMessage[]
  snapshot: AssistantSnapshot | null
  permission: Permission | null
  question: AssistantQuestion | null
  queuedMessages: readonly {
    id: string
    text: string
    attachments: readonly { id: string; name: string }[]
  }[]
  queuePaused: boolean
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
    question: null,
    queuedMessages: [],
    queuePaused: false,
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
  let promptInFlight = false
  let activeControl: symbol | null = null
  let activeQueuedPrompt: QueuedPrompt | undefined
  const queued: QueuedPrompt[] = []
  const questions = new Map<string, AssistantQuestion>()
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
    const text = (merged.text ?? "").slice(0, 32_000)
    const messages = [...state.messages]
    const index = messages.findIndex((message) => message.id === id)
    const message: ChatMessage = {
      id,
      role: "tool",
      text,
      tool: {
        ...(merged.title ? { title: merged.title } : {}),
        ...(merged.status ? { status: merged.status } : {}),
      },
    }
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
  function finishToolMessages(status?: "cancelled" | "failed") {
    if (status) {
      const owned = new Set([...toolMessages.values()].map(({ id }) => id))
      const messages = state.messages.map((message) =>
        owned.has(message.id) &&
        (message.tool?.status === "in_progress" || message.tool?.status === "pending")
          ? { ...message, tool: { ...message.tool, status } }
          : message,
      )
      if (messages.some((message, index) => message !== state.messages[index]))
        publish({ messages })
    }
    toolMessages.clear()
  }
  function completeTurn(stopReason: string) {
    permissions.clear()
    questions.clear()
    finishToolMessages(stopReason === "cancelled" ? "cancelled" : undefined)
    publish({
      busy: false,
      permission: null,
      question: null,
      ...(stopReason === "cancelled" ? { queuePaused: true } : {}),
    })
    save()
  }
  function receiveQuestion(
    event: Extract<AssistantEvent, { type: "question" | "question-resolved" }>,
  ) {
    if (event.type === "question") questions.set(event.question.requestId, event.question)
    else questions.delete(event.requestId)
    publish({ question: questions.values().next().value ?? null })
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
        completeTurn(event.stopReason)
        break
      case "error":
        permissions.clear()
        questions.clear()
        finishToolMessages("failed")
        publish({
          error: event.code,
          busy: false,
          permission: null,
          question: null,
          queuePaused: true,
        })
        save()
        break
    }
  }
  function event(event: AssistantEvent) {
    if (!acceptsEvent(event)) return
    if (event.type === "question" || event.type === "question-resolved") receiveQuestion(event)
    else dispatchEvent(event)
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
    activeControl = null
    connecting = null
    restoreQueued(activeQueuedPrompt)
    if (current) ignoredTokens.add(current.sessionToken)
    permissions.clear()
    questions.clear()
    finishToolMessages("cancelled")
    publish({
      snapshot: null,
      busy: false,
      connecting: false,
      permission: null,
      question: null,
      queuePaused: queued.length > 0,
    })
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
  function validPrompt(text: string, attachments: readonly AssistantAttachment[]) {
    const current = scope()
    if (!current || disposed) return null
    const parsed = assistantPromptSchema.safeParse({ ...current, text, attachments })
    if (!parsed.success) {
      publish({ error: "invalid-request" })
      return null
    }
    const capabilities = state.snapshot?.attachmentCapabilities
    if (
      attachments.some((attachment) =>
        attachment.type === "image" ? !capabilities?.images : !capabilities?.text,
      )
    ) {
      publish({ error: "unsupported" })
      return null
    }
    return parsed.data
  }
  function publishQueue() {
    publish({
      queuedMessages: queued.map(({ id, text, attachments }) => ({
        id,
        text,
        attachments: attachments.map(({ id, name }) => ({ id, name })),
      })),
    })
  }
  function enqueue(text: string, attachments: readonly AssistantAttachment[] = []) {
    const parsed = validPrompt(text, attachments)
    if (!parsed) return false
    if (queued.length >= 8) {
      publish({ error: "queue-full" })
      return false
    }
    const bytes = JSON.stringify(queued).length + JSON.stringify(parsed.attachments).length
    if (bytes > 32 * 1024 * 1024) {
      publish({ error: "queue-full" })
      return false
    }
    queued.push({
      id: crypto.randomUUID(),
      text: parsed.text,
      attachments: parsed.attachments,
      started: false,
    })
    publishQueue()
    return true
  }
  function drainQueue() {
    const next = queued[0]
    if (
      next &&
      !promptInFlight &&
      !activeControl &&
      !state.busy &&
      !state.queuePaused &&
      state.snapshot?.status === "ready"
    )
      launchPrompt(next.text, next.attachments, next)
  }
  function restoreQueued(item: QueuedPrompt | undefined) {
    if (!item || queued.includes(item)) return
    queued.unshift(item)
    publishQueue()
  }
  function recordPrompt(
    text: string,
    attachments: readonly AssistantAttachment[],
    queuedPrompt?: QueuedPrompt,
  ) {
    if (queuedPrompt?.started) return
    const message: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      text,
      ...(attachments.length
        ? { attachments: attachments.map(({ id, name }) => ({ id, name })) }
        : {}),
    }
    publish({ messages: retainChatMessages([...state.messages, message]) })
    save()
    if (queuedPrompt) queuedPrompt.started = true
  }
  function launchPrompt(
    text: string,
    attachments: readonly AssistantAttachment[],
    queuedPrompt?: QueuedPrompt,
  ) {
    const current = scope()
    if (!current || state.snapshot?.status !== "ready" || promptInFlight || activeControl)
      return false
    const at = generation
    promptInFlight = true
    activeQueuedPrompt = queuedPrompt
    if (queuedPrompt) {
      const index = queued.indexOf(queuedPrompt)
      if (index >= 0) queued.splice(index, 1)
      publishQueue()
    }
    publish({ busy: true, error: null })
    toolMessages.clear()
    recordPrompt(text, attachments, queuedPrompt)
    const complete = async () => {
      const result = await run(() =>
        bridge.prompt({ ...current, text, attachments: [...attachments] }),
      )
      if (!isCurrent(at)) return
      if (!result.ok) {
        restoreQueued(queuedPrompt)
        finishToolMessages("failed")
      }
      publish({ busy: false, ...(!result.ok ? { queuePaused: true } : {}) })
      save()
    }
    void complete()
      .catch(() => {
        if (isCurrent(at)) {
          finishToolMessages("failed")
          publish({ error: "request-failed", busy: false, queuePaused: true })
          save()
        }
      })
      .finally(() => {
        promptInFlight = false
        activeQueuedPrompt = undefined
        drainQueue()
      })
    return true
  }
  async function configure(action: () => Promise<AssistantResult>) {
    if (activeControl || state.busy || promptInFlight || disposed) return
    const token = Symbol("assistant-configuration")
    const at = generation
    activeControl = token
    try {
      const result = await run(action)
      if (isCurrent(at) && !result.ok) publish({ queuePaused: true })
    } finally {
      if (activeControl === token) {
        activeControl = null
        if (isCurrent(at)) drainQueue()
      }
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
    async send(text: string, attachments: readonly AssistantAttachment[] = []) {
      if (state.busy || promptInFlight || activeControl || queued.length)
        return enqueue(text, attachments)
      const parsed = validPrompt(text, attachments)
      return parsed ? launchPrompt(parsed.text, parsed.attachments) : false
    },
    async enqueue(text: string, attachments: readonly AssistantAttachment[] = []) {
      return enqueue(text, attachments)
    },
    removeQueued(id: string) {
      const index = queued.findIndex((item) => item.id === id)
      if (index >= 0) queued.splice(index, 1)
      publishQueue()
    },
    async resumeQueue() {
      if (state.snapshot?.status !== "ready" || promptInFlight || activeControl) return false
      publish({ queuePaused: false })
      drainQueue()
      return true
    },
    async cancel() {
      const current = scope()
      permissions.clear()
      questions.clear()
      finishToolMessages("cancelled")
      publish({ permission: null, question: null, queuePaused: true })
      save()
      if (current) await run(() => bridge.cancel(current))
    },
    async reset() {
      if (queued.length || state.busy || promptInFlight) return
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
    async respondQuestion(answers: Record<string, string> | null) {
      const current = scope(),
        question = state.question
      if (!current || !question) return false
      const at = generation
      try {
        const result = await bridge.respondQuestion({
          ...current,
          requestId: question.requestId,
          answers,
        })
        if (!isCurrent(at) || !result.ok) return false
        acceptSnapshot(result.value)
        questions.delete(question.requestId)
        publish({ question: questions.values().next().value ?? null })
        return true
      } catch {
        return false
      }
    },
    async setMode(modeId: string) {
      const current = scope()
      if (current) await configure(() => bridge.setMode({ ...current, modeId }))
    },
    async setModel(modelId: string) {
      const current = scope()
      if (current) await configure(() => bridge.setModel({ ...current, modelId }))
    },
    async setConfigOption(configId: string, value: string) {
      const current = scope()
      if (current) await configure(() => bridge.setConfigOption({ ...current, configId, value }))
    },
    async authenticate(methodId: string) {
      const current = scope()
      if (current) await run(() => bridge.authenticate({ ...current, methodId }))
    },
    dispose() {
      if (disposed) return
      const current = scope()
      finishToolMessages("cancelled")
      save()
      disposed = true
      generation += 1
      connecting = null
      unsubscribe?.()
      unsubscribe = undefined
      permissions.clear()
      questions.clear()
      toolMessages.clear()
      state = {
        ...state,
        snapshot: null,
        busy: false,
        connecting: false,
        permission: null,
        question: null,
        queuePaused: queued.length > 0,
      }
      if (current) void bridge.disconnect(current).catch(() => undefined)
    },
  }
}
