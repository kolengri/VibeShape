import { z } from "zod"
import { type ApiConfiguration, apiConfigurationSchema } from "./api-assistant-preferences"
import { apiProviderTools } from "./api-cad-tools"
import { ApiAssistantError, assertApiActive, boundedApiJson } from "./api-errors"

const toolCallSchema = z.object({
  id: z.string().min(1).max(128),
  type: z.literal("function"),
  function: z.object({ name: z.string().min(1).max(64), arguments: z.string().max(32_768) }),
})
const deltaTool = z.object({
  index: z.number().int().min(0).max(7),
  id: z.string().max(128).optional(),
  type: z.literal("function").optional(),
  function: z
    .object({ name: z.string().max(64).optional(), arguments: z.string().max(32_768).optional() })
    .optional(),
})
const finishReason = z.enum(["stop", "tool_calls", "length", "content_filter"])
const chunkSchema = z.object({
  choices: z
    .array(
      z.object({
        index: z.literal(0),
        delta: z.object({
          content: z.string().max(64_000).nullable().optional(),
          refusal: z.string().max(64_000).nullable().optional(),
          tool_calls: z.array(deltaTool).max(8).optional(),
        }),
        finish_reason: finishReason.nullable().optional(),
      }),
    )
    .max(1),
})
const completionSchema = z.object({
  choices: z
    .array(
      z.object({
        message: z.object({
          content: z.string().max(64_000).nullable().optional(),
          refusal: z.string().max(64_000).nullable().optional(),
          tool_calls: z.array(toolCallSchema).max(8).optional(),
        }),
        finish_reason: finishReason,
      }),
    )
    .length(1),
})
export type ApiFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
export type ApiToolCall = z.infer<typeof toolCallSchema>
export type ApiWireMessage = Readonly<{
  role: "system" | "user" | "assistant" | "tool"
  content: string | null
  tool_calls?: readonly ApiToolCall[]
  tool_call_id?: string
}>
type Completion = { content: string; toolCalls: ApiToolCall[] }

function finish(content: string, tools: ApiToolCall[], reason: string | null): Completion {
  if (reason !== "stop" && reason !== "tool_calls") throw new ApiAssistantError("response-limit")
  if (tools.length && reason !== "tool_calls") throw new ApiAssistantError("invalid-response")
  if (reason === "tool_calls" && !tools.length) throw new ApiAssistantError("invalid-response")
  if (new Set(tools.map((tool) => tool.id)).size !== tools.length)
    throw new ApiAssistantError("invalid-response")
  return { content, toolCalls: tools }
}

function parseApiJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    throw new ApiAssistantError("invalid-response")
  }
}

type StreamTool = { id: string; name: string; arguments: string }
function appendTool(tools: Map<number, StreamTool>, delta: z.infer<typeof deltaTool>) {
  const tool = tools.get(delta.index) ?? { id: "", name: "", arguments: "" }
  const fragment = delta.function ?? {}
  tool.id += delta.id ?? ""
  tool.name += fragment.name ?? ""
  tool.arguments += fragment.arguments ?? ""
  if (tool.id.length > 128 || tool.name.length > 64 || tool.arguments.length > 32_768)
    throw new ApiAssistantError("response-limit")
  tools.set(delta.index, tool)
}

function createStreamCollector(onText: (text: string) => void) {
  let content = "",
    reason: string | null = null,
    done = false
  const tools = new Map<number, StreamTool>()
  function appendText(delta: z.infer<typeof chunkSchema>["choices"][number]["delta"]) {
    const text = delta.content ?? delta.refusal ?? ""
    content += text
    if (content.length > 64_000) throw new ApiAssistantError("response-limit")
    if (text) onText(text)
  }
  function receive(value: unknown) {
    const parsed = chunkSchema.safeParse(value)
    if (!parsed.success) throw new ApiAssistantError("invalid-response")
    const choice = parsed.data.choices[0]
    if (!choice) return
    if (choice.finish_reason) reason = choice.finish_reason
    appendText(choice.delta)
    for (const delta of choice.delta.tool_calls ?? []) appendTool(tools, delta)
  }
  return {
    event(frame: string) {
      const data = frame
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).replace(/^ /, ""))
        .join("\n")
      if (!data) return
      if (done) throw new ApiAssistantError("invalid-response")
      if (data === "[DONE]") {
        done = true
        return
      }
      receive(parseApiJson(data))
    },
    finish() {
      if (!done) throw new ApiAssistantError("invalid-response")
      const parsed = z
        .array(toolCallSchema)
        .max(8)
        .safeParse(
          [...tools.entries()]
            .sort(([a], [b]) => a - b)
            .map(([, tool]) => ({
              id: tool.id,
              type: "function",
              function: { name: tool.name, arguments: tool.arguments },
            })),
        )
      if (!parsed.success) throw new ApiAssistantError("invalid-response")
      return finish(content, parsed.data, reason)
    },
  }
}

async function readApiBody(
  response: Response,
  signal: AbortSignal,
  consume: (text: string) => void,
) {
  if (!response.body) throw new ApiAssistantError("invalid-response")
  const reader = response.body.getReader()
  const decoder = new TextDecoder("utf-8", { fatal: true })
  let bytes = 0
  try {
    while (true) {
      assertApiActive(signal)
      const { value, done } = await reader.read()
      assertApiActive(signal)
      if (done) break
      bytes += value.byteLength
      if (bytes > 1024 * 1024) throw new ApiAssistantError("response-limit")
      consume(decoder.decode(value, { stream: true }))
    }
    consume(decoder.decode())
  } finally {
    await reader.cancel().catch(() => undefined)
    reader.releaseLock()
  }
}

async function readStreamCompletion(
  response: Response,
  signal: AbortSignal,
  onText: (text: string) => void,
) {
  const collector = createStreamCollector(onText)
  let pending = ""
  await readApiBody(response, signal, (text) => {
    pending = (pending + text).replace(/\r\n/g, "\n")
    let boundary = pending.indexOf("\n\n")
    while (boundary >= 0) {
      collector.event(pending.slice(0, boundary))
      pending = pending.slice(boundary + 2)
      boundary = pending.indexOf("\n\n")
    }
    if (pending.length > 256 * 1024) throw new ApiAssistantError("response-limit")
  })
  if (pending.trim()) collector.event(pending)
  return collector.finish()
}

async function readJsonCompletion(
  response: Response,
  signal: AbortSignal,
  onText: (text: string) => void,
) {
  let text = ""
  await readApiBody(response, signal, (chunk) => {
    text += chunk
  })
  const value = parseApiJson(text)
  const parsed = completionSchema.safeParse(value)
  const choice = parsed.success ? parsed.data.choices[0] : undefined
  if (!choice) throw new ApiAssistantError("invalid-response")
  const content = choice.message.content ?? choice.message.refusal ?? ""
  const result = finish(content, choice.message.tool_calls ?? [], choice.finish_reason)
  if (content) onText(content)
  return result
}

async function readCompletion(
  response: Response,
  signal: AbortSignal,
  onText: (text: string) => void,
) {
  const type = response.headers.get("content-type") ?? ""
  if (type.includes("text/event-stream")) return readStreamCompletion(response, signal, onText)
  if (!type.includes("application/json")) throw new ApiAssistantError("invalid-response")
  return readJsonCompletion(response, signal, onText)
}

export async function requestApiCompletion(options: {
  configuration: ApiConfiguration
  messages: readonly ApiWireMessage[]
  signal: AbortSignal
  onText: (text: string) => void
  fetch?: ApiFetch | undefined
  timeoutMs?: number
}): Promise<Completion> {
  if (!apiConfigurationSchema.safeParse(options.configuration).success)
    throw new ApiAssistantError("invalid-configuration")
  const body = boundedApiJson(
    {
      model: options.configuration.model,
      messages: options.messages,
      tools: apiProviderTools,
      parallel_tool_calls: false,
      stream: options.configuration.stream,
      max_completion_tokens: 4096,
    },
    768 * 1024,
    "context-limit",
  )
  const timeout = new AbortController()
  const timer = setTimeout(
    () => timeout.abort(new ApiAssistantError("timeout")),
    options.timeoutMs ?? 120_000,
  )
  const signal = AbortSignal.any([options.signal, timeout.signal])
  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "text/event-stream, application/json",
    }
    if (options.configuration.apiKey)
      headers.Authorization = `Bearer ${options.configuration.apiKey}`
    const response = await (options.fetch ?? fetch)(options.configuration.endpoint, {
      method: "POST",
      headers,
      body,
      signal,
      mode: "cors",
      credentials: "omit",
      redirect: "error",
      referrerPolicy: "no-referrer",
      cache: "no-store",
    })
    assertApiActive(signal)
    if (response.redirected || response.type === "opaqueredirect")
      throw new ApiAssistantError("endpoint")
    if (response.status === 401 || response.status === 403)
      throw new ApiAssistantError("authentication")
    if (response.status === 429) throw new ApiAssistantError("rate-limit")
    if (!response.ok) throw new ApiAssistantError("endpoint")
    return await readCompletion(response, signal, options.onText)
  } catch (error) {
    if (signal.aborted) throw signal.reason
    if (error instanceof ApiAssistantError) throw error
    throw new ApiAssistantError("network")
  } finally {
    clearTimeout(timer)
  }
}
