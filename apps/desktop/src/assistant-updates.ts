import type { SessionConfigOption, SessionModeState, SessionUpdate } from "@agentclientprotocol/sdk"
import type { AssistantEvent, AssistantSnapshot } from "@vibeshape/automation-api/assistant"

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

export function sessionUpdateEvent(
  snapshot: AssistantSnapshot,
  update: SessionUpdate,
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
    case "tool_call_update": {
      const text = update.content
        ?.flatMap((item) =>
          item.type === "content" && item.content.type === "text" ? [item.content.text] : [],
        )
        .join("\n")
      return {
        ...scope,
        type: "tool",
        toolCallId: update.toolCallId,
        ...(update.title ? { title: update.title.slice(0, 512) } : {}),
        ...(update.status ? { status: update.status } : {}),
        ...(text ? { text: text.slice(0, 32_768) } : {}),
      }
    }
    default:
      return undefined
  }
}
