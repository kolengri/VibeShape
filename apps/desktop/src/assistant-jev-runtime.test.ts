import { describe, expect, it } from "bun:test"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { assistantJevAgentSchema } from "@vibeshape/automation-api/assistant-jev"
import { createAssistantLaunchResolver } from "./assistant-jev-runtime"

const runtimeDirectory = join(tmpdir(), "application runtime with spaces")
const executable = join(runtimeDirectory, "Electron")
const firstEndpoint = "https://first.example.test/v1/chat/completions"
const secondEndpoint = "https://second.example.test/v1/chat/completions"
const agent = (settings: Record<string, unknown> = {}) =>
  assistantJevAgentSchema.parse({ kind: "jev", settings })
const helper = (endpoint = firstEndpoint) =>
  agent({ argumentsEndpoint: endpoint, argumentsModel: "helper" })

function launch(result: ReturnType<ReturnType<typeof createAssistantLaunchResolver>>) {
  if (!result.ok) throw new Error("Expected a configured built-in launch.")
  return result.launch
}

describe("built-in Jev runtime authority", () => {
  it("reuses app-session credentials for probes without caching supplied probe keys", () => {
    const resolve = createAssistantLaunchResolver({ executable, runtimeDirectory, env: {} })
    launch(
      resolve("project-a", helper(), { apiKey: "connect-key", argumentsApiKey: "connect-helper" }),
    )
    const probe = launch(
      resolve(
        "project-b",
        helper(),
        { apiKey: "probe-key", argumentsApiKey: "probe-helper" },
        { testConnection: true },
      ),
    )
    expect(probe.agent.args).toEqual([join(runtimeDirectory, "jev.cjs"), "--test-connection"])
    expect(probe.env).toMatchObject({
      TYPESAFE_API_KEY: "probe-key",
      JEV_ARGUMENTS_API_KEY: "probe-helper",
    })
    const recovered = launch(resolve("project-a", helper(), {}, { testConnection: true }))
    expect(recovered.env).toMatchObject({
      TYPESAFE_API_KEY: "connect-key",
      JEV_ARGUMENTS_API_KEY: "connect-helper",
    })
    expect(
      launch(resolve("project-a", helper(secondEndpoint), {}, { testConnection: true })).env
        ?.JEV_ARGUMENTS_API_KEY,
    ).toBeUndefined()
    launch(
      resolve(
        "project-b",
        helper(secondEndpoint),
        { apiKey: "only-probed", argumentsApiKey: "only-probed-helper" },
        { testConnection: true },
      ),
    )
    const connected = launch(resolve("project-b", helper(secondEndpoint)))
    expect(connected.env).toMatchObject({ TYPESAFE_API_KEY: "connect-key" })
    expect(connected.env).not.toHaveProperty("JEV_ARGUMENTS_API_KEY")
    const recoveredAfterConnect = launch(resolve("project-a", helper()))
    expect(recoveredAfterConnect.env).toMatchObject({
      TYPESAFE_API_KEY: "connect-key",
      JEV_ARGUMENTS_API_KEY: "connect-helper",
    })
  })

  it("does not seed the app-session cache from a connection probe", () => {
    const resolve = createAssistantLaunchResolver({ executable, runtimeDirectory, env: {} })
    launch(
      resolve(
        "project-a",
        helper(),
        { apiKey: "only-probed", argumentsApiKey: "only-probed-helper" },
        { testConnection: true },
      ),
    )
    expect(resolve("project-a", helper())).toEqual({
      ok: false,
      code: "jev-configuration-required",
    })
    expect(resolve("project-c", helper(), {}, { testConnection: true })).toEqual({
      ok: false,
      code: "jev-configuration-required",
    })
    expect(
      launch(resolve("project-b", helper(), { apiKey: "connect-key" })).env?.JEV_ARGUMENTS_API_KEY,
    ).toBeUndefined()
  })
  it("resolves only the application runtime with explicit settings and a private environment", () => {
    const inherited = {
      PATH: "/usr/bin:/bin",
      SystemRoot: "C:\\Windows",
      TYPESAFE_API_KEY: "host-key",
      TYPESAFE_MODEL: "stale-model",
      TYPESAFE_BASE_URL: "https://untrusted.example.test",
      JEV_ARGUMENTS_ENDPOINT: firstEndpoint,
      JEV_ARGUMENTS_MODEL: "inherited-helper",
      JEV_ARGUMENTS_API_KEY: "inherited-helper-key",
      JEV_ENABLE_IMAGES: "0",
      NODE_OPTIONS: "--require arbitrary-code.cjs",
      ELECTRON_RUN_AS_NODE: "ambient-value",
      OTHER_PROVIDER_API_KEY: "unrelated-key",
    }
    const before = { ...inherited }
    const resolve = createAssistantLaunchResolver({ executable, runtimeDirectory, env: inherited })
    const descriptor = agent({
      model: "jev-configured",
      images: true,
      maxSteps: 7,
      minConfidence: 0.75,
      timeoutMs: 12_000,
    })
    const result = launch(resolve("project-a", descriptor, { apiKey: "connection-key" }))
    expect(result.agent).toEqual({ command: executable, args: [join(runtimeDirectory, "jev.cjs")] })
    expect(result.runAsNode).toBe(true)
    expect(result.env).toEqual({
      PATH: "/usr/bin:/bin",
      SystemRoot: "C:\\Windows",
      TYPESAFE_API_KEY: "connection-key",
      TYPESAFE_MODEL: "jev-configured",
      JEV_ENABLE_IMAGES: "1",
      JEV_MAX_STEPS: "7",
      JEV_MIN_CONFIDENCE: "0.75",
      JEV_TIMEOUT_MS: "12000",
    })
    expect(inherited).toEqual(before)
    expect(JSON.stringify(descriptor)).not.toContain("connection-key")
    expect(JSON.stringify(result.agent)).not.toContain("connection-key")
    if (result.env) result.env.PATH = "child-mutation"
    expect(launch(resolve("project-a", agent())).env?.PATH).toBe("/usr/bin:/bin")
  })

  it("forwards a local argument descriptor without API credentials and preserves sign-in locations", () => {
    const resolve = createAssistantLaunchResolver({
      executable,
      runtimeDirectory,
      env: {
        TYPESAFE_API_KEY: "host-key",
        JEV_ARGUMENTS_API_KEY: "must-not-leak",
        CODEX_HOME: "/private/codex-config",
      },
    })
    const argumentsAgent = { command: "codex-acp", args: [] }
    const result = launch(resolve("project", agent({ argumentsAgent })))
    expect(JSON.parse(result.env?.JEV_ARGUMENTS_AGENT ?? "null")).toEqual(argumentsAgent)
    expect(result.env?.JEV_ARGUMENTS_API_KEY).toBeUndefined()
    expect(result.env?.CODEX_HOME).toBe("/private/codex-config")
  })

  it("preserves legacy executable configuration without attaching built-in credentials or flags", () => {
    const resolve = createAssistantLaunchResolver({
      executable,
      runtimeDirectory,
      env: { TYPESAFE_API_KEY: "host-key", JEV_ARGUMENTS_API_KEY: "host-helper-key" },
    })
    launch(
      resolve("project-a", helper(), { apiKey: "cached-key", argumentsApiKey: "cached-helper" }),
    )
    const external = { command: "custom-acp", args: ["literal argument; $(exit 9)"] }
    expect(
      resolve("project-b", external, {
        apiKey: "external-key",
        argumentsApiKey: "external-helper",
      }),
    ).toEqual({ ok: true, launch: { agent: external } })
    const recovered = launch(resolve("project-b", helper()))
    expect(recovered.env?.TYPESAFE_API_KEY).toBe("cached-key")
    expect(recovered.env?.JEV_ARGUMENTS_API_KEY).toBe("cached-helper")
  })

  it("returns a sanitized configuration error without a key or for invalid host credentials", () => {
    for (const env of [{}, { TYPESAFE_API_KEY: "invalid\nprivate-value" }]) {
      const resolve = createAssistantLaunchResolver({ executable, runtimeDirectory, env })
      expect(resolve("project-a", agent())).toEqual({
        ok: false,
        code: "jev-configuration-required",
      })
    }
  })

  it("keeps connection keys for descriptor-only recovery and overrides the host key", () => {
    const resolve = createAssistantLaunchResolver({
      executable,
      runtimeDirectory,
      env: { TYPESAFE_API_KEY: "host-key" },
    })
    expect(launch(resolve("project-a", agent())).env?.TYPESAFE_API_KEY).toBe("host-key")
    launch(resolve("project-a", agent(), { apiKey: "new-private-key" }))
    expect(
      launch(resolve("project-a", agent({ model: "another-model" }))).env?.TYPESAFE_API_KEY,
    ).toBe("new-private-key")
    expect(launch(resolve("project-a", agent(), { apiKey: "" })).env?.TYPESAFE_API_KEY).toBe(
      "new-private-key",
    )
  })

  it("binds cached helper keys to the exact endpoint and supports keyless helpers", () => {
    const resolve = createAssistantLaunchResolver({
      executable,
      runtimeDirectory,
      env: { TYPESAFE_API_KEY: "type-key" },
    })
    expect(
      launch(resolve("project-a", helper(), { argumentsApiKey: "first-key" })).env
        ?.JEV_ARGUMENTS_API_KEY,
    ).toBe("first-key")
    expect(
      launch(resolve("project-a", helper(secondEndpoint))).env?.JEV_ARGUMENTS_API_KEY,
    ).toBeUndefined()
    expect(
      launch(resolve("project-a", helper(`${firstEndpoint}/`))).env?.JEV_ARGUMENTS_API_KEY,
    ).toBeUndefined()
    expect(launch(resolve("project-a", helper())).env?.JEV_ARGUMENTS_API_KEY).toBe("first-key")
    expect(launch(resolve("project-a", agent())).env?.JEV_ARGUMENTS_API_KEY).toBeUndefined()
    expect(resolve("project-a", agent(), { argumentsApiKey: "no-endpoint-key" })).toEqual({
      ok: false,
      code: "jev-configuration-required",
    })
  })

  it("uses an inherited helper key only for its matching explicit endpoint", () => {
    const resolve = createAssistantLaunchResolver({
      executable,
      runtimeDirectory,
      env: {
        TYPESAFE_API_KEY: "type-key",
        JEV_ARGUMENTS_ENDPOINT: firstEndpoint,
        JEV_ARGUMENTS_MODEL: "host-model",
        JEV_ARGUMENTS_API_KEY: "host-helper-key",
      },
    })
    expect(
      launch(resolve("project-a", helper(secondEndpoint))).env?.JEV_ARGUMENTS_API_KEY,
    ).toBeUndefined()
    expect(launch(resolve("project-a", helper())).env?.JEV_ARGUMENTS_API_KEY).toBe(
      "host-helper-key",
    )
    expect(launch(resolve("project-a", helper())).env?.JEV_ARGUMENTS_MODEL).toBe("helper")
    expect(launch(resolve("project-a", agent())).env?.JEV_ARGUMENTS_ENDPOINT).toBeUndefined()
  })

  it("reuses connection keys across project switches and descriptor-only recovery", () => {
    const resolve = createAssistantLaunchResolver({ executable, runtimeDirectory, env: {} })
    launch(resolve("project-a", helper(), { apiKey: "key-a", argumentsApiKey: "helper-a" }))
    for (const projectId of ["project-b", "project-a", "project-c"]) {
      const recovered = launch(resolve(projectId, helper()))
      expect(recovered.env?.TYPESAFE_API_KEY).toBe("key-a")
      expect(recovered.env?.JEV_ARGUMENTS_API_KEY).toBe("helper-a")
    }
    expect(
      launch(resolve("project-b", helper(secondEndpoint))).env?.JEV_ARGUMENTS_API_KEY,
    ).toBeUndefined()
    launch(resolve("project-b", helper(secondEndpoint), { argumentsApiKey: "helper-second" }))
    expect(launch(resolve("project-a", helper())).env?.JEV_ARGUMENTS_API_KEY).toBe("helper-a")
    expect(launch(resolve("project-a", helper(secondEndpoint))).env?.JEV_ARGUMENTS_API_KEY).toBe(
      "helper-second",
    )
    expect(
      launch(resolve("project-b", helper(`${secondEndpoint}/`))).env?.JEV_ARGUMENTS_API_KEY,
    ).toBeUndefined()
  })

  it("replaces shared connection keys across projects and overrides host defaults", () => {
    const resolve = createAssistantLaunchResolver({
      executable,
      runtimeDirectory,
      env: {
        TYPESAFE_API_KEY: "host-key",
        JEV_ARGUMENTS_ENDPOINT: firstEndpoint,
        JEV_ARGUMENTS_API_KEY: "host-helper-key",
      },
    })
    const defaulted = launch(resolve("project-a", helper()))
    expect(defaulted.env?.TYPESAFE_API_KEY).toBe("host-key")
    expect(defaulted.env?.JEV_ARGUMENTS_API_KEY).toBe("host-helper-key")
    launch(resolve("project-a", helper(), { apiKey: "key-a", argumentsApiKey: "helper-a" }))
    launch(resolve("project-b", helper(), { apiKey: "key-b", argumentsApiKey: "helper-b" }))
    const recovered = launch(resolve("project-a", helper()))
    expect(recovered.env?.TYPESAFE_API_KEY).toBe("key-b")
    expect(recovered.env?.JEV_ARGUMENTS_API_KEY).toBe("helper-b")
    const otherEndpoint = launch(resolve("project-c", helper(secondEndpoint)))
    expect(otherEndpoint.env?.TYPESAFE_API_KEY).toBe("key-b")
    expect(otherEndpoint.env?.JEV_ARGUMENTS_API_KEY).toBeUndefined()
  })

  it("does not retain connection keys in a new runtime resolver", () => {
    const resolve = createAssistantLaunchResolver({ executable, runtimeDirectory, env: {} })
    launch(
      resolve("project-a", helper(), { apiKey: "session-key", argumentsApiKey: "session-helper" }),
    )
    const fresh = createAssistantLaunchResolver({ executable, runtimeDirectory, env: {} })
    expect(fresh("project-a", helper())).toEqual({
      ok: false,
      code: "jev-configuration-required",
    })
    expect(
      launch(fresh("project-b", helper(), { apiKey: "fresh-key" })).env?.JEV_ARGUMENTS_API_KEY,
    ).toBeUndefined()
  })
})
