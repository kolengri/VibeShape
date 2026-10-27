import { basename } from "node:path"
import type { McpServerStdio } from "@agentclientprotocol/sdk"
import { z } from "zod"
import type { AssistantProcessLaunch } from "./assistant-transport"

const configuration = z.record(z.string(), z.unknown())
const servers = z.record(z.string(), configuration)
const timeout = z.number().finite().positive()
const adapter = z.object({
  agentInfo: z.object({
    name: z.literal("@agentclientprotocol/codex-acp"),
    version: z.literal("2.2.2"),
  }),
})

export function supportsCodexMcpRuntimeConfig(initialization: unknown) {
  return adapter.safeParse(initialization).success
}

function configuredTimeout(value: unknown) {
  const parsed = timeout.safeParse(value)
  return parsed.success ? parsed.data : 0
}

function takeProjectTimeout(config: z.infer<typeof configuration>, name: string) {
  const prefix = `mcp_servers.${name}`
  const entry = configuration.safeParse(config[prefix])
  const seconds = Math.max(
    configuredTimeout(config[`${prefix}.tool_timeout_sec`]),
    configuredTimeout(entry.success ? entry.data.tool_timeout_sec : undefined),
  )
  for (const key of Object.keys(config))
    if (key === prefix || key.startsWith(`${prefix}.`)) delete config[key]
  return seconds
}

export function prepareCodexMcpLaunch(
  launch: AssistantProcessLaunch,
  projectServers: readonly McpServerStdio[],
  inherited: NodeJS.ProcessEnv,
) {
  if (!/^codex-acp(?:\.(?:exe|cmd|bat))?$/i.test(basename(launch.agent.command)))
    return { launch, configured: false }
  const env = launch.env ?? inherited
  let config: z.infer<typeof configuration>
  let existing: z.infer<typeof servers>
  try {
    config = configuration.parse(env.CODEX_CONFIG ? JSON.parse(env.CODEX_CONFIG) : {})
    existing = servers.parse(config.mcp_servers ?? {})
  } catch {
    throw new Error("The Codex runtime configuration is invalid.")
  }
  const mcpServers = { ...existing }
  // Keep transport and deadline together; native Codex does not order overlapping dotted overrides.
  for (const server of projectServers) {
    const seconds = Math.max(
      600,
      configuredTimeout(existing[server.name]?.tool_timeout_sec),
      takeProjectTimeout(config, server.name),
    )
    mcpServers[server.name] = {
      command: server.command,
      args: [...server.args],
      env: Object.fromEntries(server.env.map(({ name, value }) => [name, value])),
      tool_timeout_sec: seconds,
    }
  }
  return {
    launch: {
      ...launch,
      env: { ...env, CODEX_CONFIG: JSON.stringify({ ...config, mcp_servers: mcpServers }) },
    },
    configured: true,
  }
}
