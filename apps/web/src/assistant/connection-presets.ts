import type { AssistantAgent } from "@vibeshape/automation-api/assistant"
import { assistantAgentPresets } from "@vibeshape/automation-api/assistant-agents"

export const agentPresets = assistantAgentPresets

export function agentPresetId(agent: AssistantAgent) {
  if ("kind" in agent) return "jev"
  return (
    agentPresets.find(
      (preset) =>
        preset.command === agent.command &&
        JSON.stringify(preset.args) === JSON.stringify(agent.args),
    )?.id ?? (agent.command ? "custom" : "choose")
  )
}

export const apiPresets = [
  { id: "ollama", endpoint: "http://localhost:11434/v1/chat/completions" },
  { id: "lmstudio", endpoint: "http://localhost:1234/v1/chat/completions" },
  { id: "openai", endpoint: "https://api.openai.com/v1/chat/completions" },
] as const

export function apiPresetId(endpoint: string) {
  return (
    apiPresets.find((preset) => preset.endpoint === endpoint)?.id ??
    (endpoint ? "custom" : "choose")
  )
}
