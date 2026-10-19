import {
  type AssistantAttachment,
  type AssistantQuestion,
  assistantAttachmentsSchema,
  assistantQuestionResponseSchema,
} from "@vibeshape/automation-api/assistant"
import { z } from "zod"
import { type ApiToolUpdate, apiAgentMessages, runApiAgentTurn } from "./api-agent-turn"
import { type ApiConfiguration, apiConfigurationSchema } from "./api-assistant-preferences"
import type { ApiQuestionInput } from "./api-cad-tools"
import { type ApiFetch, type ApiWireMessage, apiCompletionBody } from "./api-chat-completions"
import { ApiAssistantError, type ApiAssistantErrorCode, apiErrorCode } from "./api-errors"
import type { BrowserToolSession } from "./browser-tool-session"
import {
  type ChatMessage,
  clearChatHistory,
  readChatHistory,
  retainChatMessages,
  writeChatHistory,
} from "./chat-history"

type QueuedPrompt = {
  id: string
  text: string
  attachments: AssistantAttachment[]
  started: boolean
}
type ApiChatState = Readonly<{
  messages: readonly ChatMessage[]
  connected: boolean
  busy: boolean
  error: ApiAssistantErrorCode | null
  storageFailed: boolean
  queuedMessages: readonly {
    id: string
    text: string
    attachments: readonly { id: string; name: string }[]
  }[]
  queuePaused: boolean
  model: string | null
  question: AssistantQuestion | null
}>
type StoragePort = Pick<Storage, "getItem" | "setItem" | "removeItem">
type ApiChatOptions = {
  projectId: string
  storage: StoragePort
  createTools: (projectId: string) => BrowserToolSession
  fetch?: ApiFetch | undefined
}
type ActiveTurn = {
  abort: AbortController
  wire: ApiWireMessage
  queued: QueuedPrompt | undefined
  canceled: boolean
  done?: Promise<void>
}
const promptSchema = z
  .strictObject({
    text: z
      .string()
      .trim()
      .max(16_000)
      .refine((value) => !value.includes("\0")),
    attachments: assistantAttachmentsSchema,
  })
  .refine((value) => value.text.length > 0 || value.attachments.length > 0)

function rememberedContext(messages: readonly ChatMessage[]): ApiWireMessage[] {
  const result: ApiWireMessage[] = messages
    .filter((message) => message.role === "user" || message.role === "assistant")
    .slice(-20)
    .map((message) => ({
      role: message.role === "user" ? "user" : "assistant",
      content: message.text,
    }))
  while (result.length && JSON.stringify(result).length > 64_000) result.shift()
  return result
}
function promptMessage(text: string, attachments: readonly AssistantAttachment[]): ApiWireMessage {
  const files = attachments.flatMap((attachment) =>
    attachment.type === "text"
      ? [{ name: attachment.name, mimeType: attachment.mimeType, text: attachment.text }]
      : [],
  )
  return {
    role: "user",
    content: files.length
      ? [text, JSON.stringify({ attachedFiles: files })].filter(Boolean).join("\n\n")
      : text,
  }
}
function attachmentMetadata(attachments: readonly AssistantAttachment[]) {
  return attachments.map(({ id, name }) => ({ id, name }))
}
function answersMatchQuestion(question: AssistantQuestion, answers: Record<string, string>) {
  if (Object.keys(answers).some((key) => !question.fields.some((field) => field.id === key)))
    return false
  return question.fields.every((field) => {
    const value = Object.hasOwn(answers, field.id) ? (answers[field.id] ?? "") : ""
    if (!value) return !field.required
    if (field.options && !field.options.some((option) => option.id === value)) return false
    return value.length >= (field.minLength ?? 0) && value.length <= (field.maxLength ?? 16_384)
  })
}

export function createApiChatController(options: ApiChatOptions) {
  const saved = readChatHistory(options.projectId, options.storage)
  let state: ApiChatState = {
    messages: saved?.messages ?? [],
    connected: false,
    busy: false,
    error: null,
    storageFailed: false,
    queuedMessages: [],
    queuePaused: false,
    model: null,
    question: null,
  }
  let context = rememberedContext(state.messages)
  let configuration: ApiConfiguration | null = null
  let tools: BrowserToolSession | null = null
  let disposed = false
  let active: ActiveTurn | null = null
  let saveTimer: ReturnType<typeof setTimeout> | undefined
  const queued: QueuedPrompt[] = []
  const listeners = new Set<() => void>()
  let pendingQuestion: {
    question: AssistantQuestion
    settle: (answers: Record<string, string> | null, error?: unknown) => void
  } | null = null
  const publish = (patch: Partial<ApiChatState>) => {
    if (disposed) return
    state = { ...state, ...patch }
    for (const listener of listeners) listener()
  }
  const save = () => {
    clearTimeout(saveTimer)
    saveTimer = undefined
    const storageFailed = !writeChatHistory(
      options.projectId,
      state.messages,
      options.storage,
      saved?.agentSession,
    )
    if (state.storageFailed !== storageFailed) publish({ storageFailed })
  }
  const messages = (next: readonly ChatMessage[]) => {
    publish({ messages: retainChatMessages(next) })
    saveTimer ??= setTimeout(save, 200)
  }
  const append = (
    role: "user" | "assistant",
    text: string,
    attachments: readonly AssistantAttachment[] = [],
  ) => {
    const next = [...state.messages],
      last = next.at(-1)
    if (role === "assistant" && last?.role === role)
      next[next.length - 1] = { ...last, text: (last.text + text).slice(0, 32_000) }
    else
      next.push({
        id: crypto.randomUUID(),
        role,
        text: text.slice(0, 32_000),
        ...(attachments.length ? { attachments: attachmentMetadata(attachments) } : {}),
      })
    messages(next)
  }
  function publishQueue() {
    publish({
      queuedMessages: queued.map(({ id, text, attachments }) => ({
        id,
        text,
        attachments: attachmentMetadata(attachments),
      })),
    })
  }
  function releaseTools() {
    const owned = tools
    tools = null
    try {
      owned?.dispose()
    } catch {
      /* The revoked handle remains unusable. */
    }
  }
  function ensureTools() {
    if (tools?.isActive()) return tools
    releaseTools()
    const created = options.createTools(options.projectId)
    if (!created.isActive()) {
      created.dispose()
      throw new ApiAssistantError("stale-project")
    }
    tools = created
    return created
  }
  function validPrompt(text: string, attachments: readonly AssistantAttachment[], pending = false) {
    if (disposed || !state.connected || !configuration) return null
    const parsed = promptSchema.safeParse({ text, attachments })
    if (!parsed.success) {
      publish({ error: "context-limit" })
      return null
    }
    if (parsed.data.attachments.some((attachment) => attachment.type !== "text")) {
      publish({ error: "unsupported-attachment" })
      return null
    }
    const wire = promptMessage(parsed.data.text, parsed.data.attachments)
    const pendingMessages = pending
      ? [
          ...(active ? [active.wire] : []),
          ...queued.map((item) => promptMessage(item.text, item.attachments)),
        ]
      : []
    try {
      apiCompletionBody(
        configuration,
        apiAgentMessages(options.projectId, [...context, ...pendingMessages, wire]),
      )
      const currentTools = ensureTools()
      return { ...parsed.data, wire, configuration, tools: currentTools }
    } catch (error) {
      publish({ error: apiErrorCode(error) })
      return null
    }
  }
  function turnEvents(turn: ActiveTurn) {
    const toolMessages = new Map<string, string>()
    const current = () => !disposed && active === turn && !turn.abort.signal.aborted
    return {
      onText: (value: string) => {
        if (current()) append("assistant", value)
      },
      onTool: (update: ApiToolUpdate) => {
        if (!current()) return
        const id = toolMessages.get(update.id) ?? crypto.randomUUID()
        toolMessages.set(update.id, id)
        const next = [...state.messages]
        const entry: ChatMessage = {
          id,
          role: "tool",
          text: update.text,
          tool: { title: update.name, status: update.status },
        }
        const index = next.findIndex((message) => message.id === id)
        if (index < 0) next.push(entry)
        else next[index] = entry
        messages(next)
      },
      finishTools: (status: "failed" | "cancelled") => {
        const ids = new Set(toolMessages.values())
        const next = state.messages.map((message) =>
          ids.has(message.id) && message.tool?.status === "in_progress"
            ? { ...message, tool: { ...message.tool, status } }
            : message,
        )
        if (next.some((message, index) => message !== state.messages[index])) messages(next)
      },
    }
  }
  function askQuestion(input: ApiQuestionInput, signal: AbortSignal) {
    const question: AssistantQuestion = {
      ...input,
      fields: input.fields.map((field) => ({ ...field, secret: false })),
      requestId: crypto.randomUUID(),
      expiresAt: Date.now() + 120_000,
    }
    return new Promise<unknown>((resolve, reject) => {
      const aborted = () => settle(null, signal.reason)
      const timer = setTimeout(() => settle(null, new ApiAssistantError("timeout")), 120_000)
      function settle(answers: Record<string, string> | null, error?: unknown) {
        if (pendingQuestion?.question !== question) return
        clearTimeout(timer)
        signal.removeEventListener("abort", aborted)
        pendingQuestion = null
        publish({ question: null })
        if (error) reject(error)
        else resolve({ answers })
      }
      pendingQuestion = { question, settle }
      signal.addEventListener("abort", aborted, { once: true })
      publish({ question })
      if (signal.aborted) aborted()
    })
  }
  function drainQueue() {
    if (disposed || active || state.queuePaused || !state.connected) return
    const next = queued[0]
    if (!next) return
    const parsed = validPrompt(next.text, next.attachments)
    if (!parsed) {
      publish({ queuePaused: true })
      return
    }
    launchPrompt(parsed, next)
  }
  function failTurn(turn: ActiveTurn, finishTools: (status: "failed" | "cancelled") => void) {
    finishTools(turn.canceled ? "cancelled" : "failed")
    releaseTools()
    context = rememberedContext(state.messages)
    if (turn.queued) queued.unshift(turn.queued)
    publishQueue()
  }
  function finishTurn(
    turn: ActiveTurn,
    outcome: { succeeded: boolean; failure: ApiAssistantErrorCode | null },
    finishTools: (status: "failed" | "cancelled") => void,
  ) {
    if (disposed || active !== turn) return
    active = null
    if (!outcome.succeeded) failTurn(turn, finishTools)
    publish({
      busy: false,
      error: outcome.failure,
      queuePaused: outcome.succeeded ? state.queuePaused : true,
    })
    save()
    if (outcome.succeeded) drainQueue()
  }
  async function runTurn(
    turn: ActiveTurn,
    currentConfiguration: ApiConfiguration,
    currentTools: BrowserToolSession,
  ) {
    const timeout = setTimeout(
      () => turn.abort.abort(new ApiAssistantError("timeout")),
      10 * 60_000,
    )
    let failure: ApiAssistantErrorCode | null = null
    let succeeded = false
    const events = turnEvents(turn)
    try {
      const nextContext = await runApiAgentTurn({
        configuration: currentConfiguration,
        projectId: options.projectId,
        messages: [...context, turn.wire],
        tools: currentTools,
        signal: turn.abort.signal,
        onText: events.onText,
        onTool: events.onTool,
        askQuestion,
        fetch: options.fetch,
      })
      if (!disposed && !turn.abort.signal.aborted) {
        context = nextContext
        succeeded = true
      }
    } catch (error) {
      failure = turn.canceled ? null : apiErrorCode(error)
    } finally {
      clearTimeout(timeout)
      finishTurn(turn, { succeeded, failure }, events.finishTools)
    }
  }
  function beginPromptTranscript(
    prompt: NonNullable<ReturnType<typeof validPrompt>>,
    item?: QueuedPrompt,
  ) {
    if (item?.started) return
    append("user", prompt.text, prompt.attachments)
    if (item) item.started = true
  }
  function launchPrompt(prompt: NonNullable<ReturnType<typeof validPrompt>>, item?: QueuedPrompt) {
    if (active) return false
    if (item) {
      queued.shift()
      publishQueue()
    }
    const turn: ActiveTurn = {
      abort: new AbortController(),
      wire: prompt.wire,
      canceled: false,
      queued: item,
    }
    active = turn
    publish({ busy: true, error: null, queuePaused: item ? state.queuePaused : false })
    beginPromptTranscript(prompt, item)
    turn.done = runTurn(turn, prompt.configuration, prompt.tools)
    return true
  }
  function enqueue(text: string, attachments: readonly AssistantAttachment[]) {
    const parsed = validPrompt(text, attachments, true)
    if (!parsed) return false
    if (queued.length >= 8) {
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
    drainQueue()
    return true
  }
  async function cancel() {
    publish({ queuePaused: true })
    const turn = active
    if (!turn) return
    turn.canceled = true
    turn.abort.abort(new DOMException("Stopped", "AbortError"))
    releaseTools()
    await turn.done
  }
  return {
    getSnapshot: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    start() {
      disposed = false
    },
    async connect(input: unknown) {
      if (disposed || active) return false
      const parsed = apiConfigurationSchema.safeParse(input)
      if (!parsed.success) {
        publish({ error: "invalid-configuration" })
        return false
      }
      releaseTools()
      try {
        ensureTools()
        configuration = parsed.data
        publish({ connected: true, model: configuration.model, error: null })
        return true
      } catch (error) {
        configuration = null
        publish({ connected: false, model: null, error: apiErrorCode(error) })
        return false
      }
    },
    async disconnect() {
      await cancel()
      configuration = null
      releaseTools()
      publish({ connected: false, model: null, error: null })
      save()
    },
    async send(text: string, attachments: readonly AssistantAttachment[] = []) {
      if (active || queued.length) return enqueue(text, attachments)
      const parsed = validPrompt(text, attachments)
      return parsed ? launchPrompt(parsed) : false
    },
    async enqueue(text: string, attachments: readonly AssistantAttachment[] = []) {
      return enqueue(text, attachments)
    },
    async respondQuestion(answers: Record<string, string> | null) {
      const pending = pendingQuestion
      if (!pending || Date.now() >= pending.question.expiresAt) return false
      const parsed = assistantQuestionResponseSchema.shape.answers.safeParse(answers)
      if (
        !parsed.success ||
        (parsed.data !== null && !answersMatchQuestion(pending.question, parsed.data))
      )
        return false
      pending.settle(parsed.data)
      return true
    },
    removeQueued(id: string) {
      const index = queued.findIndex((item) => item.id === id)
      if (index >= 0) queued.splice(index, 1)
      publishQueue()
    },
    async resumeQueue() {
      if (disposed || active || !state.connected) return false
      publish({ queuePaused: false })
      drainQueue()
      return !state.queuePaused
    },
    cancel,
    async reset() {
      if (disposed || active || queued.length) return
      releaseTools()
      context = []
      publish({
        messages: [],
        error: null,
        queuePaused: false,
        storageFailed: !clearChatHistory(options.projectId, options.storage),
      })
    },
    dispose() {
      if (disposed) return
      active?.abort.abort(new DOMException("Closed", "AbortError"))
      releaseTools()
      configuration = null
      publish({ connected: false, model: null, busy: false, queuePaused: true })
      save()
      disposed = true
    },
  }
}

export function createApiChatRegistry(
  options: Omit<ApiChatOptions, "projectId"> & {
    registerGuard?: (projectId: string, blocked: () => boolean) => (() => void) | undefined
    registerResource?: (
      projectId: string,
      resource: { isBusy: () => boolean; dispose: () => void },
    ) => (() => void) | undefined
  },
) {
  type Entry = {
    chat: ReturnType<typeof createApiChatController>
    revision: number
    disconnected: boolean
    unsubscribe: () => void
    releaseGuard?: (() => void) | undefined
    releaseResource?: (() => void) | undefined
  }
  const entries = new Map<string, Entry>()
  const listeners = new Set<() => void>()
  let configuration: ApiConfiguration | null = null
  let revision = 0
  function releaseEntry(projectId: string) {
    const retained = entries.get(projectId)
    if (!retained) return
    entries.delete(projectId)
    retained.unsubscribe()
    retained.releaseGuard?.()
    retained.releaseResource?.()
    retained.chat.dispose()
    for (const listener of listeners) listener()
  }
  function entry(projectId: string) {
    const retained = entries.get(projectId)
    if (retained) return retained
    const chat = createApiChatController({ ...options, projectId })
    chat.start()
    const created: Entry = {
      chat,
      revision: -1,
      disconnected: false,
      unsubscribe: chat.subscribe(() => {
        for (const listener of listeners) listener()
      }),
      releaseGuard: options.registerGuard?.(
        projectId,
        () => chat.getSnapshot().busy || chat.getSnapshot().queuedMessages.length > 0,
      ),
    }
    entries.set(projectId, created)
    created.releaseResource = options.registerResource?.(projectId, {
      isBusy: () => chat.getSnapshot().busy || chat.getSnapshot().queuedMessages.length > 0,
      dispose() {
        if (!chat.getSnapshot().busy && !chat.getSnapshot().queuedMessages.length)
          releaseEntry(projectId)
      },
    })
    return created
  }
  return {
    get(projectId: string) {
      return entry(projectId).chat
    },
    isBusy: () => [...entries.values()].some(({ chat }) => chat.getSnapshot().busy),
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    async activate(projectId: string) {
      const retained = entry(projectId)
      if (
        !configuration ||
        retained.disconnected ||
        retained.revision === revision ||
        retained.chat.getSnapshot().busy
      )
        return
      if (await retained.chat.connect(configuration)) retained.revision = revision
    },
    async connect(projectId: string, input: unknown) {
      const retained = entry(projectId)
      const parsed = apiConfigurationSchema.safeParse(input)
      if (!parsed.success) return retained.chat.connect(input)
      if (!(await retained.chat.connect(parsed.data))) return false
      configuration = parsed.data
      revision += 1
      retained.revision = revision
      retained.disconnected = false
      return true
    },
    async disconnect(projectId: string) {
      const retained = entry(projectId)
      retained.disconnected = true
      await retained.chat.disconnect()
    },
    dispose() {
      for (const projectId of entries.keys()) releaseEntry(projectId)
      configuration = null
      listeners.clear()
    },
  }
}
