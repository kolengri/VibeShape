import { isAbsolute, join } from "node:path"
import type { AssistantAgent } from "@vibeshape/automation-api/assistant"
import {
  type AssistantJevCredentials,
  type AssistantJevSettings,
  assistantJevAgentSchema,
  assistantJevCredentialsSchema,
} from "@vibeshape/automation-api/assistant-jev"
import type { AssistantProcessLaunch } from "./assistant-transport"

type LaunchResolution =
  | { ok: true; launch: AssistantProcessLaunch }
  | { ok: false; code: "jev-configuration-required" }

const launchCredentialsSchema = assistantJevCredentialsSchema.required({ apiKey: true })

const operatingSystemVariables = new Set([
  "HOME",
  "LOGNAME",
  "USER",
  "USERNAME",
  "PATH",
  "SHELL",
  "TERM",
  "TMPDIR",
  "TMP",
  "TEMP",
  "LANG",
  "LC_ALL",
  "APPDATA",
  "LOCALAPPDATA",
  "USERPROFILE",
  "HOMEDRIVE",
  "HOMEPATH",
  "SYSTEMDRIVE",
  "SYSTEMROOT",
  "WINDIR",
  "PROGRAMFILES",
  "PROCESSOR_ARCHITECTURE",
])

function nonBlank(value: string | undefined) {
  return value?.trim() ? value : undefined
}

function jevEnvironment(
  base: NodeJS.ProcessEnv,
  settings: AssistantJevSettings,
  credentials: AssistantJevCredentials & { apiKey: string },
) {
  const env: NodeJS.ProcessEnv = {
    ...base,
    TYPESAFE_API_KEY: credentials.apiKey,
    TYPESAFE_MODEL: settings.model,
    JEV_ENABLE_IMAGES: settings.images ? "1" : "0",
    JEV_MAX_STEPS: String(settings.maxSteps),
    JEV_MIN_CONFIDENCE: String(settings.minConfidence),
    JEV_TIMEOUT_MS: String(settings.timeoutMs),
  }
  if (settings.argumentsEndpoint) {
    env.JEV_ARGUMENTS_ENDPOINT = settings.argumentsEndpoint
    env.JEV_ARGUMENTS_MODEL = settings.argumentsModel
    if (credentials.argumentsApiKey) env.JEV_ARGUMENTS_API_KEY = credentials.argumentsApiKey
  }
  return env
}

export function createAssistantLaunchResolver(options: {
  executable: string
  runtimeDirectory: string
  env?: NodeJS.ProcessEnv
}) {
  if (!isAbsolute(options.executable) || !isAbsolute(options.runtimeDirectory))
    throw new Error("The built-in assistant requires absolute application runtime paths.")
  const inherited = options.env ?? process.env
  const baseEnvironment: NodeJS.ProcessEnv = {}
  for (const [key, value] of Object.entries(inherited))
    if (
      operatingSystemVariables.has(key.toUpperCase()) &&
      value !== undefined &&
      !value.startsWith("()")
    )
      baseEnvironment[key] = value
  const hostApiKey = nonBlank(inherited.TYPESAFE_API_KEY)
  const hostArgumentsEndpoint = inherited.JEV_ARGUMENTS_ENDPOINT
  const hostArgumentsApiKey = nonBlank(inherited.JEV_ARGUMENTS_API_KEY)
  let cachedApiKey: string | undefined
  const helperKeys = new Map<string, string>()

  function helperKey(endpoint: string | undefined, supplied: string | undefined) {
    const explicit = nonBlank(supplied)
    if (explicit) return explicit
    if (!endpoint) return undefined
    return (
      helperKeys.get(endpoint) ??
      (hostArgumentsEndpoint === endpoint ? hostArgumentsApiKey : undefined)
    )
  }

  function selectCredentials(endpoint: string | undefined, supplied: AssistantJevCredentials) {
    const selected = launchCredentialsSchema.safeParse({
      apiKey: nonBlank(supplied.apiKey) ?? cachedApiKey ?? hostApiKey,
      argumentsApiKey: helperKey(endpoint, supplied.argumentsApiKey),
    })
    if (!selected.success) return null
    if (selected.data.argumentsApiKey && !endpoint) return null
    cachedApiKey = selected.data.apiKey
    if (endpoint && selected.data.argumentsApiKey)
      helperKeys.set(endpoint, selected.data.argumentsApiKey)
    return selected.data
  }

  return (agent: AssistantAgent, supplied: AssistantJevCredentials = {}): LaunchResolution => {
    if (!("kind" in agent)) return { ok: true, launch: { agent } }
    const descriptor = assistantJevAgentSchema.safeParse(agent)
    if (!descriptor.success) return { ok: false, code: "jev-configuration-required" }
    const settings = descriptor.data.settings
    const credentials = selectCredentials(settings.argumentsEndpoint, supplied)
    if (!credentials) return { ok: false, code: "jev-configuration-required" }
    return {
      ok: true,
      launch: {
        agent: { command: options.executable, args: [join(options.runtimeDirectory, "jev.cjs")] },
        env: jevEnvironment(baseEnvironment, settings, credentials),
        runAsNode: true,
      },
    }
  }
}
