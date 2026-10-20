import type { AssistantToolTargets } from "@vibeshape/automation-api/assistant"
import {
  assistantToolResultFailed,
  assistantToolResultText,
  assistantToolTargets,
} from "@vibeshape/automation-api/assistant-tool-targets"
import { z } from "zod"
import type { ApiConfiguration } from "./api-assistant-preferences"
import { type ApiQuestionInput, apiCadInstructions, apiQuestionInputSchema } from "./api-cad-tools"
import {
  type ApiFetch,
  type ApiToolCall,
  type ApiWireMessage,
  requestApiCompletion,
} from "./api-chat-completions"
import { ApiAssistantError, apiErrorCode, assertApiActive, boundedApiJson } from "./api-errors"
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

function cadToolTargets(projectId: string, tool: ApiToolCall, input: unknown) {
  if (tool.function.name !== "call_cad_tool") return undefined
  const cad = z
    .strictObject({ name: z.string().min(1).max(64), arguments: z.record(z.string(), z.unknown()) })
    .safeParse(input)
  return cad.success
    ? assistantToolTargets(projectId, cad.data.name, cad.data.arguments)
    : undefined
}

export type ApiToolUpdate = {
  id: string
  name: string
  status: "in_progress" | "completed" | "failed"
  text: string
  hasFailureDetails?: boolean | undefined
  targets?: AssistantToolTargets | undefined
}

export function apiAgentMessages(projectId: string, messages: readonly ApiWireMessage[]) {
  const context: ApiWireMessage[] = [
    { role: "system", content: `${apiCadInstructions} Current project ID: ${projectId}.` },
    ...messages,
  ]
  boundedApiJson(context, 256 * 1024, "context-limit")
  return context
}

function toolDetails(tool: ApiToolCall, input: unknown, result?: unknown) {
  const detail = {
    command: tool.function.name,
    arguments: input,
    ...(result === undefined ? {} : { result }),
  }
  const text = JSON.stringify(detail, null, 2)
  if (text.length <= 32_000) return text
  return JSON.stringify(
    {
      command: tool.function.name,
      arguments: JSON.stringify(input).slice(0, 7_000),
      ...(result === undefined
        ? {}
        : {
            result: (
              (assistantToolResultFailed(result) ? assistantToolResultText(result) : undefined) ??
              JSON.stringify(result)
            ).slice(0, 7_000),
          }),
      truncated: true,
    },
    null,
    2,
  )
}

type AgentTurnOptions = {
  configuration: ApiConfiguration
  projectId: string
  messages: readonly ApiWireMessage[]
  tools: BrowserToolSession
  signal: AbortSignal
  onText: (text: string) => void
  onTool: (update: ApiToolUpdate) => void
  askQuestion: (question: ApiQuestionInput, signal: AbortSignal) => Promise<unknown>
  fetch?: ApiFetch | undefined
}

async function executeTool(options: AgentTurnOptions, tool: ApiToolCall, input: unknown) {
  if (tool.function.name !== "ask_user_question")
    return options.tools.execute(tool.function.name, input, options.signal)
  const parsed = apiQuestionInputSchema.safeParse(input)
  if (!parsed.success) throw new ApiAssistantError("invalid-tool")
  return options.askQuestion(parsed.data, options.signal)
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
    const targets = cadToolTargets(options.projectId, tool, input)
    options.onTool({
      id: tool.id,
      name,
      status: "in_progress",
      text: toolDetails(tool, input),
      targets,
    })
    try {
      const output = await executeTool(options, tool, input)
      assertApiActive(options.signal)
      messages.push({
        role: "tool",
        tool_call_id: tool.id,
        content: boundedApiJson(output, 128 * 1024, "response-limit"),
      })
      const failed = assistantToolResultFailed(output)
      options.onTool({
        id: tool.id,
        name,
        status: failed ? "failed" : "completed",
        text: toolDetails(tool, input, output),
        ...(failed ? { hasFailureDetails: Boolean(assistantToolResultText(output)) } : {}),
        targets: failed ? undefined : targets,
      })
    } catch (error) {
      options.onTool({
        id: tool.id,
        name,
        status: "failed",
        text: toolDetails(tool, input, { error: apiErrorCode(error) }),
        hasFailureDetails: true,
      })
      throw error
    }
  }
}

export async function runApiAgentTurn(options: AgentTurnOptions) {
  const messages = [...options.messages]
  const ids = new Set<string>()
  for (let round = 0; round < 12; round += 1) {
    assertApiActive(options.signal)
    if (!options.tools.isActive()) throw new ApiAssistantError("stale-project")
    const result = await requestApiCompletion({
      configuration: options.configuration,
      messages: apiAgentMessages(options.projectId, messages),
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
