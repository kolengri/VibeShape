import { expect, it } from "bun:test"
import { prepareCodexMcpLaunch, supportsCodexMcpRuntimeConfig } from "./assistant-codex-mcp"

const project = {
  name: "vs_458ef2a46d9293ef",
  command: "/Applications/VibeShape.app/Contents/MacOS/VibeShape",
  args: ["/runtime/mcp.cjs", "--descriptor", "/private/project.json"],
  env: [{ name: "ELECTRON_RUN_AS_NODE", value: "1" }],
}
const launch = { agent: { command: "codex-acp", args: [] } }
const config = (result: ReturnType<typeof prepareCodexMcpLaunch>) =>
  JSON.parse(result.launch.env?.CODEX_CONFIG ?? "{}")

it("gives the complete project attachment a ten-minute Codex client deadline", () => {
  const inherited = {
    HOME: "/home/test",
    CODEX_CONFIG: JSON.stringify({
      model: "chosen-model",
      mcp_servers: { unrelated: { url: "https://example.test/mcp", tool_timeout_sec: 37 } },
    }),
  }
  const result = prepareCodexMcpLaunch(launch, [project], inherited)
  expect(result.configured).toBe(true)
  expect(config(result)).toEqual({
    model: "chosen-model",
    mcp_servers: {
      unrelated: { url: "https://example.test/mcp", tool_timeout_sec: 37 },
      vs_458ef2a46d9293ef: {
        command: project.command,
        args: project.args,
        env: { ELECTRON_RUN_AS_NODE: "1" },
        tool_timeout_sec: 600,
      },
    },
  })
  expect(inherited.CODEX_CONFIG).not.toContain(project.name)
  expect(launch).toEqual({ agent: { command: "codex-acp", args: [] } })
})

it("preserves a longer project deadline and resolved launch environment", () => {
  const env = {
    CODEX_CONFIG: JSON.stringify({ mcp_servers: { [project.name]: { tool_timeout_sec: 1800 } } }),
    PATH: "/selected/path",
  }
  const selected = { ...launch, env }
  const result = prepareCodexMcpLaunch(selected, [project], {
    CODEX_CONFIG: "invalid inherited value",
  })
  expect(config(result).mcp_servers[project.name].tool_timeout_sec).toBe(1800)
  expect(result.launch.env?.PATH).toBe("/selected/path")
  expect(selected.env).toBe(env)
})

it("keeps process-local project configurations separate", () => {
  const first = config(prepareCodexMcpLaunch(launch, [project], {}))
  const second = config(
    prepareCodexMcpLaunch(launch, [{ ...project, name: "vs_0123456789abcdef" }], {}),
  )
  expect(Object.keys(first.mcp_servers)).toEqual([project.name])
  expect(Object.keys(second.mcp_servers)).toEqual(["vs_0123456789abcdef"])
})

it.each([300, 1800])(
  "normalizes an overlapping dotted timeout of %s seconds into the owned entry",
  (seconds) => {
    const key = `mcp_servers.${project.name}.tool_timeout_sec`
    const sibling = `${key}_unrelated`
    const result = config(
      prepareCodexMcpLaunch(launch, [project], {
        CODEX_CONFIG: JSON.stringify({
          [key]: seconds,
          "mcp_servers.other.tool_timeout_sec": 37,
          [sibling]: "stale project field",
        }),
      }),
    )
    expect(result[key]).toBeUndefined()
    expect(result[sibling]).toBeUndefined()
    expect(result["mcp_servers.other.tool_timeout_sec"]).toBe(37)
    expect(result.mcp_servers[project.name].tool_timeout_sec).toBe(seconds === 300 ? 600 : 1800)
  },
)

it("replaces dotted whole-server and transport overrides with the current attachment", () => {
  const prefix = `mcp_servers.${project.name}`
  const other = `${prefix}_other.command`
  const result = config(
    prepareCodexMcpLaunch(launch, [project], {
      CODEX_CONFIG: JSON.stringify({
        [prefix]: { command: "/stale/whole-server", tool_timeout_sec: 2400 },
        [`${prefix}.command`]: "/stale/command",
        [`${prefix}.args`]: ["/stale/descriptor"],
        [`${prefix}.env.ELECTRON_RUN_AS_NODE`]: "0",
        [other]: "/other/server",
      }),
    }),
  )
  expect(
    Object.keys(result).filter((key) => key === prefix || key.startsWith(`${prefix}.`)),
  ).toEqual([])
  expect(result[other]).toBe("/other/server")
  expect(result.mcp_servers[project.name]).toEqual({
    command: project.command,
    args: project.args,
    env: { ELECTRON_RUN_AS_NODE: "1" },
    tool_timeout_sec: 2400,
  })
})

it.each(["codex-acp", "/local/bin/codex-acp", "codex-acp.exe", "CODEX-ACP.CMD"])(
  "recognizes the selected Codex executable %s",
  (command) => {
    expect(prepareCodexMcpLaunch({ agent: { command, args: [] } }, [project], {}).configured).toBe(
      true,
    )
  },
)

it.each(["claude-agent-acp", "opencode", "codex-acp-unrelated", "node"])(
  "preserves another adapter's launch %s",
  (command) => {
    const selected = { agent: { command, args: ["--existing"] } }
    const result = prepareCodexMcpLaunch(selected, [project], { CODEX_CONFIG: "not-json" })
    expect(result.configured).toBe(false)
    expect(result.launch).toBe(selected)
  },
)

it.each([
  "secret-not-json",
  "null",
  "[]",
  '{"mcp_servers":[]}',
  '{"mcp_servers":{"other":"invalid"}}',
])("rejects invalid runtime configuration without exposing its contents: %s", (CODEX_CONFIG) => {
  expect(() => prepareCodexMcpLaunch(launch, [project], { CODEX_CONFIG })).toThrow(
    "The Codex runtime configuration is invalid.",
  )
})

it("uses the environment attachment only for the verified adapter identity", () => {
  expect(
    supportsCodexMcpRuntimeConfig({
      agentInfo: { name: "@agentclientprotocol/codex-acp", version: "2.2.2" },
    }),
  ).toBe(true)
  for (const agentInfo of [
    undefined,
    { name: "other", version: "2.2.2" },
    { name: "@agentclientprotocol/codex-acp", version: "2.2.3" },
  ])
    expect(supportsCodexMcpRuntimeConfig({ agentInfo })).toBe(false)
})
