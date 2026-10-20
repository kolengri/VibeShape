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
  type AssistantCheckpointHost,
  type AssistantCheckpointState,
  createAssistantCheckpoints,
} from "./assistant-checkpoints"
import {
  type AgentChatSession,
  type ChatMessage,
  clearChatHistory,
  readChatHistory,
  retainChatMessages,
  writeChatHistory,
} from "./chat-history"

type Permission = Extract<AssistantEvent, { type: "permission" }>
type ToolMessageState = NonNullable<ChatMessage["tool"]> & { id: string; text?: string }

function mergeToolMessage(
  previous: ToolMessageState,
  event: Extract<AssistantEvent, { type: "tool" }>,
) {
  const merged = {
    ...previous,
    ...(event.title !== undefined ? { title: event.title } : {}),
    ...(event.status !== undefined ? { status: event.status } : {}),
    ...(event.text?.trim() ? { text: event.text } : {}),
    ...(event.hasFailureDetails !== undefined
      ? { hasFailureDetails: previous.hasFailureDetails || event.hasFailureDetails }
      : {}),
    ...(event.targets !== undefined ? { targets: event.targets } : {}),
  }
  if (merged.status === "failed" || merged.status === "cancelled") delete merged.targets
  return merged
}
type QueuedPrompt = {
  id: string
  text: string
  attachments: readonly AssistantAttachment[]
  started: boolean
}
type PromptTurn = {
  queuedPrompt: QueuedPrompt | undefined
  transcript: readonly ChatMessage[] | null
  continued: boolean
}
type QueuedSteer = {
  item: QueuedPrompt
  token: symbol
  generation: number
  historyTailId: string | null
  checkpoint: symbol | null
  prompt: PromptTurn | null
  settled: Promise<void>
  settle: () => void
}
type ChatState = Readonly<
  {
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
    supportsActiveSteer: boolean
    steeringQueuedId: string | null
    steerStartedNewTurn: boolean
    error: AssistantErrorCode | null
    busy: boolean
    connecting: boolean
    storageFailed: boolean
  } & AssistantCheckpointState
>

export function createNativeChatController({
  projectId,
  bridge,
  storage,
  checkpointHost,
}: {
  projectId: string
  bridge: AssistantBridge
  storage: Pick<Storage, "getItem" | "setItem" | "removeItem">
  checkpointHost?: AssistantCheckpointHost
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
    supportsActiveSteer: false,
    steeringQueuedId: null,
    steerStartedNewTurn: false,
    error: null,
    busy: false,
    connecting: false,
    storageFailed: false,
    canUndoAgentChanges: false,
    undoingAgentChanges: false,
    viewingBefore: false,
    preparingBefore: false,
    settlingCheckpoint: false,
    checkpointError: null,
  }
  let disposed = false
  let generation = 0
  let snapshotEpoch = 0
  let agent: AssistantAgent | null = null
  let connecting: number | null = null
  let unsubscribe: (() => void) | undefined
  let saveTimer: ReturnType<typeof setTimeout> | undefined
  let promptInFlight = false
  let activeControl: symbol | null = null
  let activePrompt: PromptTurn | null = null
  let terminalToolStatus: "cancelled" | "failed" | undefined
  const queued: QueuedPrompt[] = []
  let steering: QueuedSteer | null = null
  const questions = new Map<string, AssistantQuestion>()
  const ignoredTokens = new Set<string>()
  const toolMessages = new Map<string, ToolMessageState>()
  const permissions = new Map<string, Permission>()
  const listeners = new Set<() => void>()
  const publish = (patch: Partial<ChatState>) => {
    if (disposed) return
    state = { ...state, ...patch }
    for (const listener of listeners) listener()
  }
  const checkpoints = checkpointHost ? createAssistantCheckpoints(checkpointHost, publish) : null
  function settleCheckpoints() {
    if (!promptInFlight && !steering && !state.busy) void checkpoints?.finish().then(drainQueue)
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
    if (
      (role === "assistant" || role === "thought") &&
      last?.role === role &&
      last.id !== steering?.historyTailId
    )
      messages[messages.length - 1] = { ...last, text: (last.text + text).slice(0, 32_000) }
    else messages.push({ id: crypto.randomUUID(), role, text: text.slice(0, 32_000) })
    publish({ messages: retainChatMessages(messages) })
    queueSave()
  }
  const scope = () =>
    state.snapshot ? { projectId, sessionToken: state.snapshot.sessionToken } : null
  function snapshotToolStatus(
    status: AssistantSnapshot["status"],
  ): "cancelled" | "failed" | undefined {
    switch (status) {
      case "cancelling":
      case "disconnected":
        return "cancelled"
      case "error":
      case "authentication-required":
        return "failed"
      default:
        return terminalToolStatus
    }
  }
  function snapshotCurrent(snapshot: AssistantSnapshot, at: number, epoch: number) {
    return isCurrent(at) && snapshotEpoch === epoch && state.snapshot === snapshot
  }
  function acceptSnapshot(snapshot: AssistantSnapshot) {
    const at = generation
    const epoch = snapshotEpoch
    const cleanup =
      snapshot.status === "prompting" ? {} : clearTurnState(snapshotToolStatus(snapshot.status))
    publish({
      ...cleanup,
      snapshot,
      busy: hostTurnActive(snapshot),
      supportsActiveSteer: snapshot.canSteer === true && typeof bridge.steer === "function",
    })
    if (!snapshotCurrent(snapshot, at, epoch)) return
    if (agent && snapshot.canResume && snapshot.sessionId) {
      agentSession = { agent, sessionId: snapshot.sessionId }
      save()
    }
    if (snapshot.status === "ready" && snapshotCurrent(snapshot, at, epoch)) {
      settleCheckpoints()
      drainQueue()
    }
  }
  function updateTool(event: Extract<AssistantEvent, { type: "tool" }>) {
    const previous = toolMessages.get(event.toolCallId) ?? { id: crypto.randomUUID() }
    const merged = mergeToolMessage(previous, event)
    const { id, text: detail, ...tool } = merged
    toolMessages.set(event.toolCallId, merged)
    const text = (detail ?? "").slice(0, 32_000)
    const messages = [...state.messages]
    const index = messages.findIndex((message) => message.id === id)
    const message: ChatMessage = {
      id,
      role: "tool",
      text,
      tool,
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
  function finishToolState(status?: "cancelled" | "failed"): Partial<ChatState> {
    let messages = state.messages
    if (status) {
      const owned = new Set([...toolMessages.values()].map(({ id }) => id))
      messages = state.messages.map((message) =>
        owned.has(message.id) &&
        (message.tool?.status === "in_progress" || message.tool?.status === "pending")
          ? {
              ...message,
              tool: {
                ...message.tool,
                status,
                ...(status === "failed" ? { hasFailureDetails: false } : {}),
                targets: undefined,
              },
            }
          : message,
      )
    }
    toolMessages.clear()
    return messages.some((message, index) => message !== state.messages[index]) ? { messages } : {}
  }
  function finishToolMessages(status?: "cancelled" | "failed") {
    const patch = finishToolState(status)
    if (patch.messages) publish(patch)
  }
  function hostTurnActive(snapshot = state.snapshot) {
    return snapshot?.status === "prompting" || snapshot?.status === "cancelling"
  }
  function clearTurnState(status = terminalToolStatus): Partial<ChatState> {
    permissions.clear()
    questions.clear()
    const patch = finishToolState(status)
    terminalToolStatus = undefined
    return { ...patch, permission: null, question: null }
  }
  function completeTurn(stopReason: string) {
    terminalToolStatus =
      stopReason === "cancelled" ? "cancelled" : stopReason === "error" ? "failed" : undefined
    // A predecessor RPC can complete while the same session still owns a continuation.
    const active = hostTurnActive()
    publish({
      ...(!active ? { ...clearTurnState(), busy: false } : {}),
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
  function receiveError(code: AssistantErrorCode) {
    if (!activePrompt?.continued) terminalToolStatus = "failed"
    publish({
      ...(!hostTurnActive() ? { ...clearTurnState(), busy: false } : {}),
      error: code,
      queuePaused: true,
    })
    save()
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
        receiveError(event.code)
        break
    }
  }
  function event(event: AssistantEvent) {
    if (!acceptsEvent(event)) return
    if (event.type === "snapshot") snapshotEpoch += 1
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
    const snapshotAt = snapshotEpoch
    try {
      const result = await action()
      if (isCurrent(at) && (!result.ok || snapshotEpoch === snapshotAt)) acceptResult(result)
      return result
    } catch {
      if (generation === at) publish({ error: "request-failed" })
      return { ok: false, code: "request-failed" } as const
    }
  }
  function beginDisconnect() {
    checkpoints?.clearPreview()
    const current = scope()
    const at = ++generation
    activeControl = null
    connecting = null
    if (!activePrompt?.continued) restoreQueued(activePrompt?.queuedPrompt)
    steering?.settle()
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
      supportsActiveSteer: false,
      steerStartedNewTurn: false,
    })
    save()
    const done = (
      current ? bridge.disconnect(current).catch(() => undefined) : Promise.resolve()
    ).finally(() => {
      if (isCurrent(at) && !steering) return checkpoints?.finish()
    })
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
  function controlLocked() {
    return activeControl !== null || steering !== null
  }
  function promptReady() {
    return !promptInFlight && !controlLocked() && state.snapshot?.status === "ready"
  }
  function removeQueuedPrompt(item: QueuedPrompt) {
    const index = queued.indexOf(item)
    if (index >= 0) queued.splice(index, 1)
    publishQueue()
  }
  function drainQueue() {
    const next = queued[0]
    if (!next || !promptReady()) return
    if (state.busy || state.settlingCheckpoint || state.queuePaused) return
    launchPrompt(next.text, next.attachments, next)
  }
  function restoreQueued(item: QueuedPrompt | undefined, transcript = activePrompt?.transcript) {
    if (!item || queued.includes(item)) return
    if (transcript) publish({ messages: transcript })
    queued.unshift(item)
    publishQueue()
  }
  function recordPrompt(
    text: string,
    attachments: readonly AssistantAttachment[],
    queuedPrompt?: QueuedPrompt,
    historyTailId?: string | null,
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
    const messages = [...state.messages]
    const position =
      historyTailId === null ? 0 : messages.findIndex(({ id }) => id === historyTailId) + 1
    if (historyTailId !== undefined && (historyTailId === null || position > 0))
      messages.splice(position, 0, message)
    else messages.push(message)
    publish({ messages: retainChatMessages(messages) })
    save()
    if (queuedPrompt) queuedPrompt.started = true
    return message
  }
  async function awaitSteerReceipt(turn: PromptTurn) {
    const claim = steering
    if (claim?.prompt === turn) await claim.settled
  }
  function recoverFailedPrompt(turn: PromptTurn) {
    if (turn.continued) return
    restoreQueued(turn.queuedPrompt, turn.transcript)
    if (!hostTurnActive()) finishToolMessages("failed")
  }
  async function finishPrompt(turn: PromptTurn, at: number, result: AssistantResult) {
    if (!result.ok) await awaitSteerReceipt(turn)
    if (!isCurrent(at)) return
    if (!result.ok) recoverFailedPrompt(turn)
    publish({
      busy: hostTurnActive(),
      ...(!result.ok ? { queuePaused: true } : {}),
    })
    save()
  }
  function launchPrompt(
    text: string,
    attachments: readonly AssistantAttachment[],
    queuedPrompt?: QueuedPrompt,
  ) {
    const current = scope()
    if (!current || !promptReady()) return false
    if (checkpoints && !checkpoints.begin(queuedPrompt?.id ?? crypto.randomUUID())) {
      publish({ queuePaused: true })
      return false
    }
    const at = generation
    const turn: PromptTurn = { queuedPrompt, transcript: null, continued: false }
    activePrompt = turn
    terminalToolStatus = undefined
    promptInFlight = true
    if (queuedPrompt) removeQueuedPrompt(queuedPrompt)
    publish({ busy: true, error: null })
    toolMessages.clear()
    recordPrompt(text, attachments, queuedPrompt)
    turn.transcript = state.messages
    const complete = async () => {
      const result = await run(() =>
        bridge.prompt({ ...current, text, attachments: [...attachments] }),
      )
      await finishPrompt(turn, at, result)
    }
    void complete()
      .catch(() => {
        if (isCurrent(at)) {
          if (!hostTurnActive()) finishToolMessages("failed")
          publish({ error: "request-failed", busy: hostTurnActive(), queuePaused: true })
          save()
        }
      })
      .finally(() => {
        if (activePrompt !== turn) return
        promptInFlight = false
        activePrompt = null
        settleCheckpoints()
        drainQueue()
      })
    return true
  }
  function prepareQueuedSteer(id: string) {
    if (controlLocked() || !state.busy || state.snapshot?.status !== "prompting") return null
    const request = bridge.steer
    if (!state.supportsActiveSteer || !request) {
      publish({ error: "unsupported" })
      return null
    }
    const item = queued.find((candidate) => candidate.id === id)
    if (!item) return null
    const parsed = validPrompt(item.text, item.attachments)
    return parsed ? { item, parsed, request } : null
  }
  function failQueuedSteer(at: number, error: AssistantErrorCode) {
    if (isCurrent(at)) publish({ error, queuePaused: true })
    return false
  }
  function settleSteerCheckpoint(claim: QueuedSteer, accepted: boolean) {
    if (!checkpoints || !claim.checkpoint) return
    if (accepted) checkpoints.acceptSteer(claim.checkpoint)
    else checkpoints.discardSteer(claim.checkpoint)
  }
  function confirmContinuation(claim: QueuedSteer) {
    const prompt = claim.prompt
    if (!prompt) return
    prompt.continued = true
    // Disconnect may have provisionally restored this exact original before the receipt arrived.
    if (prompt.queuedPrompt) removeQueuedPrompt(prompt.queuedPrompt)
  }
  function recordSteerDelivery(claim: QueuedSteer, outcome: "injected" | "startedNewTurn") {
    if (outcome === "startedNewTurn") confirmContinuation(claim)
    settleSteerCheckpoint(claim, true)
    const { item } = claim
    const message = recordPrompt(item.text, item.attachments, item, claim.historyTailId)
    if (message && claim.prompt?.transcript)
      claim.prompt.transcript = retainChatMessages([...claim.prompt.transcript, message])
    removeQueuedPrompt(item)
    if (isCurrent(claim.generation)) publish({ steerStartedNewTurn: outcome === "startedNewTurn" })
    save()
  }
  function receiveQueuedSteer(claim: QueuedSteer, result: AssistantResult) {
    if (disposed || steering !== claim) return false
    if (!result.ok || !result.steerOutcome) {
      settleSteerCheckpoint(claim, false)
      return failQueuedSteer(claim.generation, result.ok ? "protocol-error" : result.code)
    }
    recordSteerDelivery(claim, result.steerOutcome)
    return true
  }
  function releaseQueuedSteer(claim: QueuedSteer) {
    claim.settle()
    if (steering !== claim) return
    steering = null
    if (activeControl === claim.token) activeControl = null
    publish({ steeringQueuedId: null })
    settleCheckpoints()
    drainQueue()
  }
  async function steerQueued(id: string) {
    const prepared = prepareQueuedSteer(id)
    if (!prepared) return false
    const { item, parsed, request } = prepared
    const checkpoint = checkpoints?.begin(item.id, "steer") ?? null
    if (checkpoints && !checkpoint) return false
    let settle = () => {}
    const settled = new Promise<void>((resolve) => {
      settle = resolve
    })
    const claim = {
      item,
      token: Symbol("queued-steering"),
      generation,
      historyTailId: state.messages.at(-1)?.id ?? null,
      checkpoint,
      prompt: activePrompt,
      settled,
      settle,
    }
    steering = claim
    activeControl = claim.token
    publish({ steeringQueuedId: id, steerStartedNewTurn: false, error: null })
    try {
      const result = await request({ ...parsed, requestId: item.id })
      return receiveQueuedSteer(claim, result)
    } catch {
      if (checkpoint) checkpoints?.discardSteer(checkpoint)
      return failQueuedSteer(claim.generation, "request-failed")
    } finally {
      releaseQueuedSteer(claim)
    }
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
      if (
        state.busy ||
        state.settlingCheckpoint ||
        promptInFlight ||
        activeControl ||
        queued.length
      )
        return enqueue(text, attachments)
      const parsed = validPrompt(text, attachments)
      return parsed ? launchPrompt(parsed.text, parsed.attachments) : false
    },
    async enqueue(text: string, attachments: readonly AssistantAttachment[] = []) {
      return enqueue(text, attachments)
    },
    steerQueued,
    async undoAgentChanges() {
      if (state.busy || promptInFlight || steering || activeControl) return false
      return checkpoints?.undo() ?? false
    },
    async viewBefore() {
      if (state.busy || promptInFlight || steering || activeControl) return false
      return checkpoints?.viewBefore() ?? false
    },
    removeQueued(id: string) {
      if (steering?.item.id === id) return
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
      checkpoints?.clearPreview()
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
      checkpoints?.clear()
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
      const snapshotAt = snapshotEpoch
      try {
        const result = await bridge.respondQuestion({
          ...current,
          requestId: question.requestId,
          answers,
        })
        if (!isCurrent(at) || !result.ok) return false
        if (snapshotEpoch === snapshotAt) acceptSnapshot(result.value)
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
      steering?.settle()
      finishToolMessages("cancelled")
      save()
      checkpoints?.clear()
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
        supportsActiveSteer: false,
      }
      if (current) void bridge.disconnect(current).catch(() => undefined)
    },
  }
}
