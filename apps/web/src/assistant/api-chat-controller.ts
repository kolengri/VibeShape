import { z } from "zod"
import { runApiAgentTurn } from "./api-agent-turn"
import { type ApiConfiguration, apiConfigurationSchema } from "./api-assistant-preferences"
import type { ApiFetch, ApiWireMessage } from "./api-chat-completions"
import { ApiAssistantError, type ApiAssistantErrorCode, apiErrorCode } from "./api-errors"
import type { BrowserToolSession } from "./browser-tool-session"
import {
  type ChatMessage,
  clearChatHistory,
  readChatHistory,
  retainChatMessages,
  writeChatHistory,
} from "./chat-history"

type ApiChatState = Readonly<{
  messages: readonly ChatMessage[]
  connected: boolean
  busy: boolean
  error: ApiAssistantErrorCode | null
  storageFailed: boolean
}>
type StoragePort = Pick<Storage, "getItem" | "setItem" | "removeItem">

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

export function createApiChatController(options: {
  projectId: string
  storage: StoragePort
  createTools: (projectId: string) => BrowserToolSession
  toolLabel: (name: string, completed: boolean) => string
  fetch?: ApiFetch | undefined
}) {
  const saved = readChatHistory(options.projectId, options.storage)
  let state: ApiChatState = {
    messages: saved?.messages ?? [],
    connected: false,
    busy: false,
    error: null,
    storageFailed: false,
  }
  let context = rememberedContext(state.messages)
  let configuration: ApiConfiguration | null = null
  let tools: BrowserToolSession | null = null
  let disposed = false,
    generation = 0
  let active: AbortController | null = null
  let saveTimer: ReturnType<typeof setTimeout> | undefined
  const listeners = new Set<() => void>()
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
  const append = (role: ChatMessage["role"], text: string) => {
    const next = [...state.messages],
      last = next.at(-1)
    if (role === "assistant" && last?.role === role)
      next[next.length - 1] = { ...last, text: (last.text + text).slice(0, 32_000) }
    else next.push({ id: crypto.randomUUID(), role, text: text.slice(0, 32_000) })
    messages(next)
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
  function cancel() {
    generation += 1
    active?.abort(new DOMException("Stopped", "AbortError"))
    active = null
    releaseTools()
    context = rememberedContext(state.messages)
    publish({ busy: false })
    save()
  }
  function disconnect() {
    cancel()
    configuration = null
    publish({ connected: false, error: null })
  }
  function createTools() {
    const created = options.createTools(options.projectId)
    if (!created.isActive()) {
      created.dispose()
      throw new ApiAssistantError("stale-project")
    }
    return created
  }
  function connect(input: unknown) {
    if (disposed || state.busy) return
    const parsed = apiConfigurationSchema.safeParse(input)
    if (!parsed.success) {
      publish({ error: "invalid-configuration" })
      return
    }
    disconnect()
    try {
      tools = createTools()
      configuration = parsed.data
      publish({ connected: true, error: null })
    } catch (error) {
      publish({ error: apiErrorCode(error) })
    }
  }
  function isCurrent(at: number) {
    return !disposed && generation === at
  }
  function canSend() {
    return !disposed && !state.busy && state.connected
  }
  function turnEvents(at: number) {
    const toolMessages = new Map<string, string>()
    return {
      onText: (value: string) => {
        if (isCurrent(at)) append("assistant", value)
      },
      onTool: (id: string, name: string, completed: boolean) => {
        if (!isCurrent(at)) return
        const messageId = toolMessages.get(id) ?? crypto.randomUUID()
        toolMessages.set(id, messageId)
        const next = state.messages.filter((message) => message.id !== messageId)
        messages([
          ...next,
          { id: messageId, role: "tool", text: options.toolLabel(name, completed) },
        ])
      },
    }
  }
  async function send(text: string) {
    const currentConfiguration = configuration
    if (!canSend() || !currentConfiguration) return
    const parsed = z.string().trim().min(1).max(16_000).safeParse(text)
    if (!parsed.success) {
      publish({ error: "context-limit" })
      return
    }
    const at = generation,
      abort = new AbortController()
    active = abort
    const timeout = setTimeout(() => abort.abort(new ApiAssistantError("timeout")), 10 * 60_000)
    publish({ busy: true, error: null })
    append("user", parsed.data)
    try {
      tools ??= createTools()
      const nextContext = await runApiAgentTurn({
        configuration: currentConfiguration,
        projectId: options.projectId,
        messages: [...context, { role: "user", content: parsed.data }],
        tools,
        signal: abort.signal,
        ...turnEvents(at),
        fetch: options.fetch,
      })
      if (isCurrent(at)) context = nextContext
    } catch (error) {
      if (isCurrent(at)) {
        releaseTools()
        publish({ error: apiErrorCode(error) })
        context = rememberedContext(state.messages)
      }
    } finally {
      clearTimeout(timeout)
      if (isCurrent(at)) {
        active = null
        publish({ busy: false })
        save()
      }
    }
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
      connect(input)
    },
    async disconnect() {
      disconnect()
    },
    send,
    async cancel() {
      cancel()
    },
    async reset() {
      cancel()
      context = []
      publish({
        messages: [],
        error: null,
        storageFailed: !clearChatHistory(options.projectId, options.storage),
      })
    },
    dispose() {
      disconnect()
      save()
      disposed = true
    },
  }
}
