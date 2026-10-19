import type { AssistantBridge } from "@vibeshape/automation-api/assistant"

declare global {
  interface Window {
    vibeshapeAssistant?: AssistantBridge
  }
}
export function getNativeAssistant() {
  return window.vibeshapeAssistant?.protocolVersion === 1 ? window.vibeshapeAssistant : null
}
