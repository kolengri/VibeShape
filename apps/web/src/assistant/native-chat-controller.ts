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
import {
  assistantPromptSchema,
  assistantQuestionAnswersMatch,
  assistantQuestionResponseSchema,
} from "@vibeshape/automation-api/assistant"
import {
  type AssistantCheckpointHost,
  type AssistantCheckpointState,
  createAssistantCheckpoints,
} from "./assistant-checkpoints"
import { type AgentChatSession, type ChatMessage, retainChatMessages } from "./chat-history"

import { createChatHistoryCoordinator } from "./chat-history-coordinator"
import type { ChatHistoryStore } from "./chat-history-storage"

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
    configured: boolean
    recovery: {
      attempt: number
      status: "retrying" | "failed"
      automation?: { attempt: number; failed: boolean }
    } | null
  } & AssistantCheckpointState
>

export function createNativeChatController({
  projectId,
  bridge,
  storage,
  historyStore,
  checkpointHost,
  automation,
}: {
  projectId: string
  bridge: AssistantBridge
  storage: Pick<Storage, "getItem" | "setItem" | "removeItem">
  historyStore?: ChatHistoryStore | undefined
  checkpointHost?: AssistantCheckpointHost
  automation?: {
    getSnapshot: () => {
      connected: boolean
      recovering: boolean
      error: boolean
      recoveryFailed?: boolean
      recoveryBlocked?: boolean
      recoveryAttempt?: number
    }
    subscribe: (listener: () => void) => () => void
    retryRecovery: () => Promise<boolean>
  }
}) {
  let agentSession: AgentChatSession | undefined
  let state: ChatState = {
    messages: [],
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
    configured: false,
    recovery: null,
    canUndoAgentChanges: false,
    undoingAgentChanges: false,
    viewingBefore: false,
    preparingBefore: false,
    settlingCheckpoint: false,
    checkpointError: null,
  }
  let resettingHistory = false
  let disposed = false
  let generation = 0
  let snapshotEpoch = 0
  let agent: AssistantAgent | null = null
  let connecting: number | null = null
  let unsubscribe: (() => void) | undefined
  let promptInFlight = false
  let activeControl: symbol | null = null
  let activePrompt: PromptTurn | null = null
  let terminalToolStatus: "cancelled" | "failed" | undefined
  let recoveryAttempt = 0
  let recoveryTimer: ReturnType<typeof setTimeout> | undefined
  let healthyIdleTimer: ReturnType<typeof setTimeout> | undefined
  let recovery: {
    at: number
    agent: AssistantAgent
    interrupted: boolean
    queuePaused: boolean
    resumeSessionId: string | undefined
    shutdown: Promise<unknown>
    failure: AssistantErrorCode | undefined
  } | null = null
  let automaticRecoveryAllowed = false
  let unsubscribeAutomation: (() => void) | undefined
  let releaseRecoveryWait: (() => void) | undefined
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
  const history = createChatHistoryCoordinator({
    projectId,
    storage,
    store: historyStore,
    current: () => ({ messages: state.messages, agentSession }),
    restored: (saved) => {
      agentSession = saved.agentSession
      publish({ messages: saved.messages })
    },
    failed: (storageFailed) => {
      if (state.storageFailed !== storageFailed) publish({ storageFailed })
    },
  })
  const save = () => history.save()
  const queueSave = () => {
    void save()
  }
  const append = (role: ChatMessage["role"], text: string) => {
    const messages = [...state.messages]
    const last = messages.at(-1)
    if (
      (role === "assistant" || role === "thought") &&
      last?.role === role &&
      last.id !== steering?.historyTailId
    )
      messages[messages.length - 1] = { ...last, text: last.text + text }
    else messages.push({ id: crypto.randomUUID(), role, text })
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
    if (acceptRecoverySnapshot(snapshot)) return
    const at = generation
    const epoch = snapshotEpoch
    const cleanup =
      snapshot.status === "prompting" || hasPendingQuestion(snapshot)
        ? {}
        : clearTurnState(snapshotToolStatus(snapshot.status))
    publish({
      ...cleanup,
      snapshot,
      busy: hostTurnActive(snapshot),
      supportsActiveSteer: snapshot.canSteer === true && typeof bridge.steer === "function",
      ...(snapshot.questionStatus === "paused" ? { queuePaused: true } : {}),
    })
    if (!snapshotCurrent(snapshot, at, epoch)) return
    rememberSession(snapshot)
    if (snapshot.status === "ready" && snapshotCurrent(snapshot, at, epoch)) {
      settleCheckpoints()
      drainQueue()
    }
  }
  function acceptRecoverySnapshot(snapshot: AssistantSnapshot) {
    if (recovery) {
      if (state.recovery?.status !== "failed") publish({ snapshot, busy: recovery.interrupted })
      if (["error", "disconnected"].includes(snapshot.status)) recordRecoveryFailure("agent-exited")
      return true
    }
    if (automaticRecoveryAllowed && ["disconnected", "error"].includes(snapshot.status)) {
      beginRecovery(state.error ?? "agent-exited")
      return true
    }
    return false
  }
  function rememberSession(snapshot: AssistantSnapshot) {
    if (agent && snapshot.canResume && snapshot.sessionId) {
      agentSession = { agent, sessionId: snapshot.sessionId }
      save()
    }
  }
  function updateTool(event: Extract<AssistantEvent, { type: "tool" }>) {
    const previous = toolMessages.get(event.toolCallId) ?? { id: crypto.randomUUID() }
    const merged = mergeToolMessage(previous, event)
    const { id, text: detail, ...tool } = merged
    toolMessages.set(event.toolCallId, merged)
    const text = detail ?? ""
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
    return (
      snapshot?.status === "prompting" ||
      snapshot?.status === "cancelling" ||
      hasPendingQuestion(snapshot)
    )
  }
  function hasPendingQuestion(snapshot = state.snapshot) {
    const canWait = snapshot?.status === "ready" || snapshot?.status === "prompting"
    return canWait && (questions.size > 0 || snapshot.questionStatus === "pending")
  }
  function hasUnansweredQuestion() {
    return hasPendingQuestion() || state.snapshot?.questionStatus === "paused"
  }
  function questionAnswerValid(
    question: AssistantQuestion,
    answers: Record<string, string> | null,
  ) {
    return (
      assistantQuestionResponseSchema.shape.answers.safeParse(answers).success &&
      (answers === null || assistantQuestionAnswersMatch(question, answers))
    )
  }
  function interruptedWorkCanContinue() {
    return !hasUnansweredQuestion() && (state.busy || hostTurnActive() || promptInFlight)
  }
  function clearTurnState(status = terminalToolStatus): Partial<ChatState> {
    permissions.clear()
    questions.clear()
    const patch = finishToolState(status)
    terminalToolStatus = undefined
    return { ...patch, permission: null, question: null }
  }
  function completeTurn(stopReason: string) {
    resetRecoveryBudget()
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
    publish({
      question: questions.values().next().value ?? null,
      ...(event.type === "question-resolved" && event.reason && event.reason !== "answered"
        ? { queuePaused: true }
        : {}),
    })
  }
  function receiveError(code: AssistantErrorCode) {
    if (recovery) {
      recordRecoveryFailure(code)
      return
    }
    if (automaticRecoveryAllowed && ["agent-exited", "timeout", "stale-session"].includes(code)) {
      beginRecovery(code)
      return
    }
    if (!activePrompt?.continued) terminalToolStatus = "failed"
    publish({
      ...(!hostTurnActive() ? { ...clearTurnState(), busy: false } : {}),
      error: code,
      queuePaused: true,
    })
    save()
  }
  function recordRecoveryFailure(code: AssistantErrorCode) {
    if (!recovery || state.recovery?.status !== "retrying") return
    recovery.failure ??= code
    releaseRecoveryWait?.()
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
    cancelRecovery()
    automaticRecoveryAllowed = false
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
      recovery: null,
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
  function connectionBlocked() {
    return disposed || resettingHistory || connecting !== null || state.busy
  }
  async function connect(configuration: AssistantAgent) {
    if (connectionBlocked()) return
    const { at, done } = beginDisconnect()
    if (!isCurrent(at)) return
    connecting = at
    publish({ connecting: true, error: null })
    try {
      await Promise.all([done, history.ready])
      if (!isCurrent(at)) return
      agent = configuration
      automaticRecoveryAllowed = true
      recoveryAttempt = 0
      publish({ configured: true })
      const resume = matchingResume(configuration)
      const result = await bridge.connect({
        projectId,
        agent: configuration,
        ...(resume ? { resumeSessionId: resume } : {}),
      })
      await receiveConnection(at, result)
      recoverConnectFailure(at, result)
    } catch {
      if (isCurrent(at)) beginRecovery("request-failed")
    } finally {
      finishConnecting(at)
    }
  }
  function recoverConnectFailure(at: number, result: AssistantResult) {
    if (isCurrent(at) && !result.ok) beginRecovery(result.code)
  }
  function cancelRecovery() {
    clearHealthyIdleTimer()
    if (recoveryTimer) clearTimeout(recoveryTimer)
    recoveryTimer = undefined
    releaseRecoveryWait?.()
    releaseRecoveryWait = undefined
    recovery = null
  }
  function recoveryRetryable(code: AssistantErrorCode) {
    return [
      "agent-exited",
      "timeout",
      "stale-session",
      "request-failed",
      "launch-failed",
      "initialization-failed",
    ].includes(code)
  }
  function failRecovery(code: AssistantErrorCode) {
    if (!recovery) return
    if (recoveryTimer) clearTimeout(recoveryTimer)
    recoveryTimer = undefined
    releaseRecoveryWait?.()
    publish({
      ...clearTurnState("failed"),
      snapshot: state.snapshot && {
        ...state.snapshot,
        status:
          state.snapshot.status === "authentication-required" ? "authentication-required" : "error",
      },
      recovery: recoveryFeedback("failed", recoveryAttempt),
      connecting: false,
      busy: false,
      error: code,
      queuePaused: true,
    })
    save()
    settleCheckpoints()
  }
  function scheduleRecovery(code: AssistantErrorCode) {
    if (!recovery || disposed || !automaticRecoveryAllowed) return
    if (!recoveryRetryable(code) || recoveryAttempt >= 5) {
      failRecovery(code)
      return
    }
    const owner = recovery
    publish({
      recovery: recoveryFeedback("retrying", recoveryAttempt + 1),
      connecting: true,
      error: null,
    })
    if (recovery !== owner || !automaticRecoveryAllowed) return
    recoveryTimer = setTimeout(
      () => {
        recoveryTimer = undefined
        void attemptRecovery(owner).catch(() => {
          if (recovery === owner && canRecover(owner.at)) failRecovery("request-failed")
        })
      },
      Math.min(1000 * 2 ** recoveryAttempt, 8000),
    )
  }
  function recoveryFeedback(
    status: "retrying" | "failed",
    attempt: number,
  ): NonNullable<ChatState["recovery"]> {
    const model = automation?.getSnapshot()
    const base = { status, attempt }
    return model && (model.recovering || model.recoveryFailed)
      ? {
          ...base,
          automation: {
            attempt: model.recoveryAttempt ?? 0,
            failed: model.recoveryFailed === true,
          },
        }
      : base
  }
  function refreshRecoveryFeedback() {
    if (state.recovery)
      publish({ recovery: recoveryFeedback(state.recovery.status, state.recovery.attempt) })
  }
  function beginRecovery(code: AssistantErrorCode) {
    if (recovery || !agent || !automaticRecoveryAllowed || disposed) return
    clearHealthyIdleTimer()
    const previous = state.snapshot
    const owner = captureRecoveryOwner(agent)
    clearInterruptedTurn()
    if (!isCurrent(owner.at)) return
    recovery = owner
    publish({
      ...clearTurnState("failed"),
      busy: owner.interrupted,
      supportsActiveSteer: false,
      steeringQueuedId: null,
    })
    if (!recoveryRetryable(code)) failRecovery(code)
    else if (requiresUnsupportedResume(owner, previous)) failRecovery("unsupported")
    else scheduleRecovery(code)
  }
  function captureRecoveryOwner(configuration: AssistantAgent) {
    const previous = state.snapshot
    const current = scope()
    const unanswered = hasUnansweredQuestion()
    const interrupted = interruptedWorkCanContinue()
    const resumeSessionId = matchingResume(configuration) ?? previous?.sessionId ?? undefined
    const at = ++generation
    if (current) ignoredTokens.add(current.sessionToken)
    return {
      at,
      agent: { command: configuration.command, args: [...configuration.args] },
      interrupted,
      queuePaused: state.queuePaused || unanswered,
      resumeSessionId,
      failure: undefined,
      shutdown: current ? bridge.disconnect(current).catch(() => undefined) : Promise.resolve(),
    }
  }
  function requiresUnsupportedResume(
    owner: NonNullable<typeof recovery>,
    previous: AssistantSnapshot | null,
  ) {
    return (
      (owner.interrupted || previous?.sessionId) && (!owner.resumeSessionId || !previous?.canResume)
    )
  }
  function clearInterruptedTurn() {
    // A sent prompt or steer has an unknown outcome. Never put it back in the send queue.
    if (steering) {
      removeQueuedPrompt(steering.item)
      settleSteerCheckpoint(steering, false)
      steering.settle()
      steering = null
    }
    activeControl = null
    activePrompt = null
    promptInFlight = false
    connecting = null
  }
  function waitForAutomation(at: number) {
    if (!automation?.getSnapshot().recovering)
      return Promise.resolve(automation?.getSnapshot().recoveryFailed !== true)
    return new Promise<boolean>((resolve) => {
      const finish = (ok: boolean) => {
        unsubscribeWait()
        if (releaseRecoveryWait === cancel) releaseRecoveryWait = undefined
        resolve(ok && isCurrent(at))
      }
      const check = () => {
        const value = automation.getSnapshot()
        if (value.connected) finish(true)
        else if (!value.recovering || value.recoveryFailed) finish(false)
      }
      const cancel = () => finish(false)
      const unsubscribeWait = automation.subscribe(check)
      releaseRecoveryWait = cancel
      check()
    })
  }
  async function attemptRecovery(owner: NonNullable<typeof recovery>) {
    if (recovery !== owner || !canRecover(owner.at)) return
    recoveryAttempt += 1
    owner.failure = undefined
    connecting = owner.at
    let result: AssistantResult
    try {
      await owner.shutdown
      if (!isCurrent(owner.at)) return
      result = await bridge.connect({
        projectId,
        agent: owner.agent,
        ...(owner.resumeSessionId ? { resumeSessionId: owner.resumeSessionId } : {}),
      })
    } catch {
      result = { ok: false, code: "request-failed" }
    }
    if (!canRecover(owner.at) || recovery !== owner) {
      await discardConnection(result)
      return
    }
    connecting = null
    if (!result.ok) {
      scheduleRecovery(result.code)
      return
    }
    await restoreConnection(owner, result.value)
  }
  async function restoreConnection(
    owner: NonNullable<typeof recovery>,
    snapshot: AssistantSnapshot,
  ) {
    acceptSnapshot(snapshot)
    const error = recoveryConnectionError(owner, snapshot)
    if (error) {
      failRecovery(error)
      return
    }
    const reconciled = !owner.interrupted || (await reconcileRecovery(owner.at))
    if (!canRecover(owner.at) || recovery !== owner) return
    if (owner.failure) {
      retryBrokenRecovery(owner, owner.failure)
      return
    }
    if (!reconciled) {
      failRecovery("request-failed")
      return
    }
    resumeRecoveredTurn(owner, snapshot)
  }
  function retryBrokenRecovery(owner: NonNullable<typeof recovery>, code: AssistantErrorCode) {
    if (recoveryRetryable(code)) {
      const current = scope()
      if (current) {
        ignoredTokens.add(current.sessionToken)
        owner.shutdown = bridge.disconnect(current).catch(() => undefined)
      }
    }
    scheduleRecovery(code)
  }
  function resumeRecoveredTurn(owner: NonNullable<typeof recovery>, snapshot: AssistantSnapshot) {
    rememberSession(snapshot)
    recovery = null
    publish({
      recovery: null,
      connecting: false,
      busy: owner.interrupted,
      error: null,
      queuePaused: owner.queuePaused,
      supportsActiveSteer: snapshot.canSteer === true && typeof bridge.steer === "function",
    })
    if (owner.interrupted) {
      if (!continueInterruptedTurn()) {
        recovery = owner
        failRecovery("request-failed")
      }
    } else {
      resetAfterHealthyIdle(owner.at)
      settleCheckpoints()
      drainQueue()
    }
  }
  function clearHealthyIdleTimer() {
    if (healthyIdleTimer) clearTimeout(healthyIdleTimer)
    healthyIdleTimer = undefined
  }
  function resetRecoveryBudget() {
    clearHealthyIdleTimer()
    recoveryAttempt = 0
  }
  function resetAfterHealthyIdle(at: number) {
    clearHealthyIdleTimer()
    healthyIdleTimer = setTimeout(() => {
      healthyIdleTimer = undefined
      if (isCurrent(at) && !recovery && state.snapshot?.status === "ready") recoveryAttempt = 0
    }, 30_000)
  }
  function recoveryConnectionError(
    owner: NonNullable<typeof recovery>,
    snapshot: AssistantSnapshot,
  ): AssistantErrorCode | null {
    if (snapshot.status !== "ready")
      return snapshot.status === "authentication-required"
        ? "authentication-required"
        : "protocol-error"
    if (owner.resumeSessionId && snapshot.sessionId !== owner.resumeSessionId)
      return "stale-session"
    return null
  }
  async function retryAutomationRecovery() {
    return automation?.getSnapshot().recoveryFailed ? automation.retryRecovery() : true
  }
  function manualRecoveryCurrent(owner: NonNullable<typeof recovery>) {
    return recovery === owner && isCurrent(owner.at) && state.recovery?.status === "failed"
  }
  function canRecover(at: number) {
    return isCurrent(at) && automaticRecoveryAllowed && state.recovery?.status === "retrying"
  }
  async function reconcileRecovery(at: number) {
    if (!(await waitForAutomation(at)) || !isCurrent(at)) return false
    if (!checkpointHost) return true
    const port = checkpointHost.open()
    if (!port) return false
    const revision = await port.settleAccepted()
    if (revision === null || !port.isSettled() || !isCurrent(at)) return false
    // A continuation is a new ACP turn with a baseline bound to the recovered actor.
    await checkpoints?.finish()
    return isCurrent(at)
  }
  function continueInterruptedTurn() {
    // This is a new normal ACP turn in the loaded session, never a replay of the interrupted RPC.
    return launchPrompt(
      "The connection interrupted the previous turn. Continue its remaining work in this resumed session. First read model_info and list_recoverable_drafts, then inspect the authoritative saved revision and any listed semantic intent. An earlier CAD request may have completed without a response: reconcile its outcome before doing anything else. Recoverable intent is unapplied work, not a saved change. Only when its committed base still matches, explicitly call restore_draft to adopt the needed intent as a new draft attributed to your current actor; preview and commit through the ordinary validated path. Never repeat an uncertain mutation or reapply an already completed change. If its outcome cannot be determined, stop and explain the uncertainty. Save small usable validated milestones before lengthy work. Respect the user's latest instructions and finish only the remaining work.",
      [],
      undefined,
      true,
    )
  }
  function validPrompt(text: string, attachments: readonly AssistantAttachment[]) {
    if (resettingHistory) return null
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
    return (
      !recovery &&
      !promptInFlight &&
      !controlLocked() &&
      !hasPendingQuestion() &&
      state.snapshot?.status === "ready"
    )
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
    if (
      !result.ok &&
      automaticRecoveryAllowed &&
      ["agent-exited", "timeout", "stale-session"].includes(result.code)
    ) {
      beginRecovery(result.code)
      return
    }
    if (result.ok) resetRecoveryBudget()
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
    recoveryContinuation = false,
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
    automaticRecoveryAllowed = true
    terminalToolStatus = undefined
    promptInFlight = true
    if (queuedPrompt) removeQueuedPrompt(queuedPrompt)
    publish({ busy: true, error: null })
    toolMessages.clear()
    recordTurnPrompt(text, attachments, queuedPrompt, recoveryContinuation)
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
  function recordTurnPrompt(
    text: string,
    attachments: readonly AssistantAttachment[],
    item: QueuedPrompt | undefined,
    internal: boolean,
  ) {
    if (!internal) recordPrompt(text, attachments, item)
  }
  function queuedSteeringReady() {
    return (
      !hasUnansweredQuestion() &&
      !controlLocked() &&
      state.busy &&
      state.snapshot?.status === "prompting"
    )
  }
  function prepareQueuedSteer(id: string) {
    if (!queuedSteeringReady()) return null
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
  async function resetTranscript(at: number) {
    if (!isCurrent(at) || resettingHistory) return false
    resettingHistory = true
    const cleared = await history.reset(() => isCurrent(at))
    resettingHistory = false
    return cleared && isCurrent(at)
  }
  return {
    getSnapshot: () => state,
    start() {
      if (unsubscribe) return
      disposed = false
      unsubscribe = bridge.onEvent(event)
      unsubscribeAutomation = automation?.subscribe(() => {
        const value = automation.getSnapshot()
        if (value.recoveryBlocked && automaticRecoveryAllowed) void disconnect()
        else if (value.recoveryFailed && recovery) failRecovery("request-failed")
        else if (value.recovering && !recovery && hostTurnActive() && automaticRecoveryAllowed)
          beginRecovery("request-failed")
        refreshRecoveryFeedback()
      })
    },
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    connect,
    disconnect,
    async retryRecovery() {
      if (!recovery || state.recovery?.status !== "failed" || disposed) return false
      const owner = recovery
      if (!(await retryAutomationRecovery()) || !manualRecoveryCurrent(owner)) return false
      recoveryAttempt = 0
      automaticRecoveryAllowed = true
      publish({ busy: recovery.interrupted })
      scheduleRecovery("request-failed")
      return true
    },
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
    async applyDraft(operation: () => Promise<boolean>) {
      if (
        disposed ||
        state.busy ||
        promptInFlight ||
        steering ||
        activeControl ||
        queued.length ||
        !checkpoints
      )
        return false
      const applied = await checkpoints.applyDraft(operation)
      drainQueue()
      return applied
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
      if (
        state.snapshot?.status !== "ready" ||
        promptInFlight ||
        activeControl ||
        hasPendingQuestion()
      )
        return false
      publish({ queuePaused: false })
      drainQueue()
      return true
    },
    async cancel() {
      automaticRecoveryAllowed = false
      if (recovery) {
        await beginDisconnect().done
        return
      }
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
      if (queued.length || state.busy || promptInFlight || state.settlingCheckpoint) return
      const { at, done } = beginDisconnect()
      await done
      if (!(await resetTranscript(at))) return
      agentSession = undefined
      checkpoints?.clear()
      publish({ messages: [], error: null, storageFailed: false })
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
      if (!questionAnswerValid(question, answers)) return false
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
        receiveQuestion({
          ...current,
          type: "question-resolved",
          requestId: question.requestId,
          reason: answers === null ? "cancelled" : "answered",
        })
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
      if (!current || activeControl) return
      const owner = recovery
      const token = Symbol("assistant-authentication")
      const at = generation
      activeControl = token
      try {
        const result = await run(() => bridge.authenticate({ ...current, methodId }))
        if (
          owner &&
          recovery === owner &&
          isCurrent(at) &&
          result.ok &&
          result.value.status === "ready"
        ) {
          publish({ recovery: { attempt: recoveryAttempt, status: "retrying" }, connecting: true })
          activeControl = null
          await restoreConnection(owner, result.value)
        }
      } finally {
        if (activeControl === token) activeControl = null
      }
    },
    async retryHistory() {
      if (state.busy || promptInFlight || steering || activeControl) return
      await history.retry()
    },
    flushHistory: () => history.flush(),
    dispose() {
      if (disposed) return
      const current = scope()
      cancelRecovery()
      automaticRecoveryAllowed = false
      unsubscribeAutomation?.()
      unsubscribeAutomation = undefined
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
        recovery: null,
        permission: null,
        question: null,
        queuePaused: queued.length > 0,
        supportsActiveSteer: false,
      }
      if (current) void bridge.disconnect(current).catch(() => undefined)
    },
  }
}
