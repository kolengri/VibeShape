import { z } from "zod"
import type { ApiConfiguration } from "./api-assistant-preferences"
import { apiCadInstructions } from "./api-cad-tools"
import {
  type ApiFetch,
  type ApiToolCall,
  type ApiWireMessage,
  requestApiCompletion,
} from "./api-chat-completions"
import { ApiAssistantError, assertApiActive, boundedApiJson } from "./api-errors"
import type { BrowserToolSession } from "./browser-tool-session"

function argumentsValue(tool: ApiToolCall): unknown {
  try {
    return JSON.parse(tool.function.arguments)
  } catch {
    throw new ApiAssistantError("invalid-tool")
  }
}
function toolLabel(tool: ApiToolCall) {
  if (tool.function.name !== "call_cad_tool") return tool.function.name
  const args = argumentsValue(tool)
  const parsed = z.object({ name: z.string().min(1).max(64) }).safeParse(args)
  if (parsed.success) return parsed.data.name
  return tool.function.name
}

type AgentTurnOptions = {
  configuration: ApiConfiguration
  projectId: string
  messages: readonly ApiWireMessage[]
  tools: BrowserToolSession
  signal: AbortSignal
  onText: (text: string) => void
  onTool: (id: string, name: string, completed: boolean) => void
  fetch?: ApiFetch | undefined
}

async function executeTools(
  options: AgentTurnOptions,
  toolCalls: ApiToolCall[],
  ids: Set<string>,
  messages: ApiWireMessage[],
) {
  for (const tool of toolCalls) {
    if (ids.has(tool.id) || ids.size >= 24) throw new ApiAssistantError("turn-limit")
    ids.add(tool.id)
    const input = argumentsValue(tool)
    const name = toolLabel(tool)
    options.onTool(tool.id, name, false)
    const output = await options.tools.execute(tool.function.name, input, options.signal)
    assertApiActive(options.signal)
    messages.push({
      role: "tool",
      tool_call_id: tool.id,
      content: boundedApiJson(output, 128 * 1024, "response-limit"),
    })
    options.onTool(tool.id, name, true)
  }
}

export async function runApiAgentTurn(options: AgentTurnOptions) {
  const messages = [...options.messages]
  const ids = new Set<string>()
  for (let round = 0; round < 12; round += 1) {
    assertApiActive(options.signal)
    if (!options.tools.isActive()) throw new ApiAssistantError("stale-project")
    boundedApiJson(messages, 256 * 1024, "context-limit")
    const result = await requestApiCompletion({
      configuration: options.configuration,
      messages: [
        {
          role: "system",
          content: `${apiCadInstructions} Current project ID: ${options.projectId}.`,
        },
        ...messages,
      ],
      signal: options.signal,
      onText: options.onText,
      fetch: options.fetch,
    })
    assertApiActive(options.signal)
    messages.push({
      role: "assistant",
      content: result.content || null,
      ...(result.toolCalls.length ? { tool_calls: result.toolCalls } : {}),
    })
    if (!result.toolCalls.length) return messages
    await executeTools(options, result.toolCalls, ids, messages)
  }
  throw new ApiAssistantError("turn-limit")
}
