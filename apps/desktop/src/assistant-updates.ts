import type { SessionConfigOption, SessionModeState, SessionUpdate } from "@agentclientprotocol/sdk"
import {
  type AssistantEvent,
  type AssistantSnapshot,
  type AssistantToolTargets,
  assistantToolTargetsSchema,
} from "@vibeshape/automation-api/assistant"
import {
  assistantToolResultFailed,
  assistantToolResultText,
  assistantToolTargets,
} from "@vibeshape/automation-api/assistant-tool-targets"

type ToolUpdate = Extract<SessionUpdate, { sessionUpdate: "tool_call" | "tool_call_update" }>
type ToolTargetState = {
  name: string | undefined
  targets: AssistantToolTargets | undefined
  failed: boolean
}

function updateToolTargets(
  projectId: string,
  update: ToolUpdate,
  previous: ToolTargetState = { name: undefined, targets: undefined, failed: false },
) {
  const current = { ...previous }
  const parsed = assistantToolTargetsSchema.safeParse({ projectId, featureIds: [], sketchIds: [] })
  const empty = parsed.success ? parsed.data : undefined
  if (update.name != null) {
    if (update.name !== current.name) current.targets = empty
    current.name = update.name.slice(0, 257)
  }
  if (update.rawInput !== undefined)
    current.targets = assistantToolTargets(projectId, current.name, update.rawInput) ?? empty
  if (update.status === "failed" || assistantToolResultFailed(update.rawOutput))
    current.failed = true
  // Explicit empty hints also clear a consumer's retained metadata after tracker eviction.
  if (current.failed) current.targets = empty
  return current
}

export function createAssistantToolTargetTracker() {
  const calls = new Map<string, ToolTargetState>()
  let scope: string | undefined
  return {
    clear() {
      calls.clear()
      scope = undefined
    },
    update(snapshot: AssistantSnapshot, update: ToolUpdate) {
      const nextScope = JSON.stringify([snapshot.projectId, snapshot.sessionToken])
      if (scope !== nextScope) calls.clear()
      scope = nextScope
      const current = updateToolTargets(snapshot.projectId, update, calls.get(update.toolCallId))
      if (!calls.has(update.toolCallId) && calls.size >= 150) {
        const oldest = calls.keys().next().value
        if (oldest !== undefined) calls.delete(oldest)
      }
      calls.set(update.toolCallId, current)
      return current
    },
  }
}

export function applySessionOptions(
  snapshot: AssistantSnapshot,
  modes: SessionModeState | null | undefined,
  configs: SessionConfigOption[] | null | undefined,
) {
  if (modes) {
    snapshot.modes = modes.availableModes
      .slice(0, 100)
      .map(({ id, name }) => ({ id, name: name.slice(0, 512) }))
    snapshot.currentModeId = modes.currentModeId
  }
  if (configs) {
    snapshot.configOptions = configs
      .filter((option) => option.type === "select")
      .slice(0, 32)
      .map((option) => ({
        id: option.id,
        name: option.name.slice(0, 512),
        ...(option.category ? { category: option.category } : {}),
        ...(option.description ? { description: option.description.slice(0, 512) } : {}),
        currentValue: option.currentValue,
        options: option.options
          .flatMap((entry) => ("options" in entry ? entry.options : [entry]))
          .slice(0, 100)
          .map(({ value, name }) => ({ id: value, name: name.slice(0, 512) })),
      }))
    const model = snapshot.configOptions.find((option) => option.category === "model")
    snapshot.models = model?.options ?? []
    snapshot.currentModelId = model?.currentValue ?? null
  }
}

function toolUpdateEvent(
  snapshot: AssistantSnapshot,
  update: ToolUpdate,
  targets: ReturnType<typeof createAssistantToolTargetTracker>,
): Extract<AssistantEvent, { type: "tool" }> {
  const toolState = targets.update(snapshot, update)
  const text =
    assistantToolResultText({
      content: update.content?.flatMap((item) =>
        item.type === "content" && item.content.type === "text" ? [item.content] : [],
      ),
    }) ?? assistantToolResultText(update.rawOutput)
  const status = toolState.failed ? "failed" : update.status
  return {
    projectId: snapshot.projectId,
    sessionToken: snapshot.sessionToken,
    type: "tool",
    toolCallId: update.toolCallId,
    ...(update.title ? { title: update.title.slice(0, 512) } : {}),
    ...(status ? { status } : {}),
    ...(text ? { text } : {}),
    ...(status === "failed" ? { hasFailureDetails: Boolean(text) } : {}),
    ...(toolState.targets ? { targets: toolState.targets } : {}),
  }
}

export function sessionUpdateEvent(
  snapshot: AssistantSnapshot,
  update: SessionUpdate,
  targets: ReturnType<typeof createAssistantToolTargetTracker>,
): AssistantEvent | undefined {
  const scope = { projectId: snapshot.projectId, sessionToken: snapshot.sessionToken }
  switch (update.sessionUpdate) {
    case "agent_message_chunk":
    case "agent_thought_chunk":
      if (update.content.type === "text")
        return {
          ...scope,
          type: update.sessionUpdate === "agent_message_chunk" ? "text" : "thought",
          text: update.content.text,
        }
      return undefined
    case "tool_call":
    case "tool_call_update":
      return toolUpdateEvent(snapshot, update, targets)
    default:
      return undefined
  }
}
