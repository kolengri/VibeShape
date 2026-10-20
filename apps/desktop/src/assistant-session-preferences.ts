import type { AssistantRequest, AssistantSnapshot } from "@vibeshape/automation-api/assistant"

export type AssistantSessionChoice =
  | { kind: "mode"; value: string }
  | { kind: "config"; id: string; category: string | undefined; value: string }
type SettingRequest = Extract<
  AssistantRequest,
  { operation: "setMode" | "setModel" | "setConfigOption" }
>

function selectedConfig(snapshot: AssistantSnapshot, request: SettingRequest) {
  switch (request.operation) {
    case "setConfigOption":
      return snapshot.configOptions.find(({ id }) => id === request.input.configId)
    case "setModel":
      return snapshot.configOptions.find(({ category }) => category === "model")
    case "setMode":
      return snapshot.configOptions.find(({ category }) => category === "mode")
  }
}

function requestedChoice(
  snapshot: AssistantSnapshot,
  request: SettingRequest,
): AssistantSessionChoice | undefined {
  const option = selectedConfig(snapshot, request)
  if (!option && request.operation !== "setMode") return undefined
  const value =
    request.operation === "setConfigOption"
      ? request.input.value
      : request.operation === "setModel"
        ? request.input.modelId
        : request.input.modeId
  return option
    ? { kind: "config", id: option.id, category: option.category, value }
    : { kind: "mode", value }
}

export function assistantSessionRequestedChoice(
  snapshot: AssistantSnapshot,
  request: AssistantRequest,
) {
  switch (request.operation) {
    case "setMode":
    case "setModel":
    case "setConfigOption":
      return requestedChoice(snapshot, request)
    default:
      return undefined
  }
}

export function assistantSessionChoiceSupported(
  snapshot: AssistantSnapshot,
  choice: AssistantSessionChoice,
) {
  if (choice.kind === "mode") return snapshot.modes.some(({ id }) => id === choice.value)
  const option = snapshot.configOptions.find(({ id }) => id === choice.id)
  return (
    option?.category === choice.category &&
    Boolean(option?.options.some(({ id }) => id === choice.value))
  )
}

export function assistantSessionChoiceSelected(
  snapshot: AssistantSnapshot,
  choice: AssistantSessionChoice,
) {
  if (!assistantSessionChoiceSupported(snapshot, choice)) return false
  if (choice.kind === "mode") return snapshot.currentModeId === choice.value
  return snapshot.configOptions.find(({ id }) => id === choice.id)?.currentValue === choice.value
}

function choiceKey(choice: AssistantSessionChoice) {
  return choice.kind === "mode" ? "mode" : `config:${choice.id}`
}

function recoveryOrder(choice: AssistantSessionChoice) {
  if (choice.kind === "mode") return 1
  return choice.category === "model" ? 0 : choice.category === "mode" ? 1 : 2
}

/** Accepted, currently selected user choices only; provider defaults are never captured. */
export function createAssistantSessionPreferences() {
  const scopes = new Map<string, readonly AssistantSessionChoice[]>()
  return {
    read(key: string) {
      return [...(scopes.get(key) ?? [])].sort(
        (left, right) => recoveryOrder(left) - recoveryOrder(right),
      )
    },
    remember(key: string, choice: AssistantSessionChoice, snapshot: AssistantSnapshot) {
      const retained = (scopes.get(key) ?? []).filter((choice) =>
        assistantSessionChoiceSelected(snapshot, choice),
      )
      if (assistantSessionChoiceSelected(snapshot, choice)) {
        const index = retained.findIndex((entry) => choiceKey(entry) === choiceKey(choice))
        if (index < 0) retained.push(choice)
        else retained[index] = choice
      }
      scopes.delete(key)
      scopes.set(key, retained)
      if (scopes.size > 128) {
        const oldest = scopes.keys().next().value
        if (oldest !== undefined) scopes.delete(oldest)
      }
    },
    discardUnavailable(key: string, snapshot: AssistantSnapshot) {
      const retained = (scopes.get(key) ?? []).filter((choice) =>
        assistantSessionChoiceSupported(snapshot, choice),
      )
      scopes.set(key, retained)
    },
    clear() {
      scopes.clear()
    },
  }
}
