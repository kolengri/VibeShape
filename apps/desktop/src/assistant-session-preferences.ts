import { rename, rm } from "node:fs/promises"
import { dirname, isAbsolute } from "node:path"
import {
  type AssistantRequest,
  type AssistantSnapshot,
  assistantSnapshotSchema,
} from "@vibeshape/automation-api/assistant"
import { z } from "zod"
import { preparePrivateDirectory, readPrivateFile, writePrivateFile } from "./private-files"

const settingId = assistantSnapshotSchema.shape.configOptions.unwrap().element.shape.id
const sessionChoiceSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("mode"), value: settingId }),
  z.strictObject({
    kind: z.literal("config"),
    id: settingId,
    category: settingId.optional(),
    value: settingId,
  }),
])
const preferencesSchema = z.strictObject({
  schemaVersion: z.literal(1),
  scopes: z
    .array(
      z.strictObject({
        key: z.string().regex(/^[a-f0-9]{64}$/),
        choices: z.array(sessionChoiceSchema).max(33),
      }),
    )
    .max(128),
})
export type AssistantSessionChoice = z.infer<typeof sessionChoiceSchema>
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
export function createAssistantSessionPreferences(path?: string) {
  if (path && !isAbsolute(path)) throw new Error("Assistant preferences require an absolute path.")
  const scopes = new Map<string, readonly AssistantSessionChoice[]>()
  let loaded: Promise<void> | undefined
  let writing = Promise.resolve()
  function load() {
    loaded ??= (async () => {
      if (!path) return
      try {
        const bytes = await readPrivateFile(path, 65536)
        const saved = preferencesSchema.parse(JSON.parse(bytes.toString("utf8")))
        for (const { key, choices } of saved.scopes) scopes.set(key, choices)
      } catch {
        // Missing, unreadable or invalid preferences grant nothing and restore no choices.
      }
    })()
    return loaded
  }
  function serialized() {
    return JSON.stringify(
      preferencesSchema.parse({
        schemaVersion: 1,
        scopes: [...scopes].map(([key, choices]) => ({ key, choices })),
      }),
    )
  }
  function save() {
    if (!path) return Promise.resolve()
    let content = serialized()
    while (Buffer.byteLength(content, "utf8") > 65536) {
      const oldest = scopes.keys().next().value
      if (oldest === undefined) break
      scopes.delete(oldest)
      content = serialized()
    }
    const destination = path
    const pending = writing
      .then(async () => {
        preparePrivateDirectory(dirname(destination))
        const temporary = `${destination}.${crypto.randomUUID()}.tmp`
        try {
          await writePrivateFile(temporary, content)
          await rename(temporary, destination)
        } finally {
          await rm(temporary, { force: true })
        }
      })
      // Disk persistence cannot invalidate an accepted provider setting or its in-memory choice.
      .catch(() => undefined)
    writing = pending
    return pending
  }
  return {
    async read(key: string) {
      await load()
      return [...(scopes.get(key) ?? [])].sort(
        (left, right) => recoveryOrder(left) - recoveryOrder(right),
      )
    },
    async remember(key: string, choice: AssistantSessionChoice, snapshot: AssistantSnapshot) {
      await load()
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
      await save()
    },
    async discardUnavailable(key: string, snapshot: AssistantSnapshot) {
      await load()
      const retained = (scopes.get(key) ?? []).filter((choice) =>
        assistantSessionChoiceSupported(snapshot, choice),
      )
      scopes.set(key, retained)
      await save()
    },
    async close() {
      await writing.catch(() => undefined)
      scopes.clear()
    },
  }
}
