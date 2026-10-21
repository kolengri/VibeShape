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

type ProjectCredentials = {
  apiKey: string | undefined
  helperKeys: Map<string, string>
}

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
  const projects = new Map<string, ProjectCredentials>()

  function helperKey(
    endpoint: string | undefined,
    supplied: string | undefined,
    cached: ProjectCredentials,
  ) {
    const explicit = nonBlank(supplied)
    if (explicit) return explicit
    if (!endpoint) return undefined
    return (
      cached.helperKeys.get(endpoint) ??
      (hostArgumentsEndpoint === endpoint ? hostArgumentsApiKey : undefined)
    )
  }

  function selectCredentials(
    projectId: string,
    endpoint: string | undefined,
    supplied: AssistantJevCredentials,
  ) {
    const cached = projects.get(projectId) ?? {
      apiKey: undefined,
      helperKeys: new Map<string, string>(),
    }
    const selected = launchCredentialsSchema.safeParse({
      apiKey: nonBlank(supplied.apiKey) ?? cached.apiKey ?? hostApiKey,
      argumentsApiKey: helperKey(endpoint, supplied.argumentsApiKey, cached),
    })
    if (!selected.success) return null
    if (selected.data.argumentsApiKey && !endpoint) return null
    return selected.data
  }

  function rememberCredentials(
    projectId: string,
    endpoint: string | undefined,
    credentials: AssistantJevCredentials & { apiKey: string },
  ) {
    const cached = projects.get(projectId) ?? {
      apiKey: undefined,
      helperKeys: new Map<string, string>(),
    }
    cached.apiKey = credentials.apiKey
    if (endpoint && credentials.argumentsApiKey)
      cached.helperKeys.set(endpoint, credentials.argumentsApiKey)
    projects.set(projectId, cached)
  }

  return (
    projectId: string,
    agent: AssistantAgent,
    supplied: AssistantJevCredentials = {},
    mode: { testConnection?: boolean } = {},
  ): LaunchResolution => {
    if (!("kind" in agent)) return { ok: true, launch: { agent } }
    const descriptor = assistantJevAgentSchema.safeParse(agent)
    if (!descriptor.success) return { ok: false, code: "jev-configuration-required" }
    const settings = descriptor.data.settings
    const credentials = selectCredentials(projectId, settings.argumentsEndpoint, supplied)
    if (!credentials) return { ok: false, code: "jev-configuration-required" }
    if (!mode.testConnection)
      rememberCredentials(projectId, settings.argumentsEndpoint, credentials)
    return {
      ok: true,
      launch: {
        agent: {
          command: options.executable,
          args: [
            join(options.runtimeDirectory, "jev.cjs"),
            ...(mode.testConnection ? ["--test-connection"] : []),
          ],
        },
        env: jevEnvironment(baseEnvironment, settings, credentials),
        runAsNode: true,
      },
    }
  }
}
