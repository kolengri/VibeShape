import type { ChildProcessWithoutNullStreams, spawn as nodeSpawn } from "node:child_process"
import { randomUUID } from "node:crypto"
import { isAbsolute } from "node:path"
import { Readable, Writable } from "node:stream"
import * as acp from "@agentclientprotocol/sdk"
import {
  type AssistantErrorCode,
  type AssistantEvent,
  type AssistantRequest,
  type AssistantResult,
  type AssistantSnapshot,
  assistantEventSchema,
  assistantRequestSchema,
  assistantSnapshotSchema,
} from "@vibeshape/automation-api/assistant"
import { type DesktopMcpSetup, desktopMcpSetupSchema } from "@vibeshape/automation-api/desktop-host"
import { createAssistantPermissions } from "./assistant-permissions"
import {
  assistantConnectionFailure,
  killAssistantProcess,
  spawnAssistantProcess,
  waitForAssistantSpawn,
} from "./assistant-transport"
import { applySessionOptions, sessionUpdateEvent } from "./assistant-updates"

type Owner = {
  snapshot: AssistantSnapshot
  process: ChildProcessWithoutNullStreams | null
  connection: acp.ClientConnection | null
  permissions: ReturnType<typeof createAssistantPermissions>
  modelConfigId: string | undefined
  mcp: acp.McpServerStdio[]
  resumeSessionId: string | undefined
  busy: boolean
  acceptingUpdates: boolean
  eventBytes: number
  eventCount: number
  cancelTimer: ReturnType<typeof setTimeout> | undefined
  failureCode: AssistantErrorCode | undefined
  stopping: Promise<void> | undefined
}

export type AssistantServiceOptions = {
  cwd: string
  getMcpSetup: (projectId: string) => Promise<DesktopMcpSetup>
  onEvent: (event: AssistantEvent) => void
  isMcpClientAttached?: () => boolean | Promise<boolean>
  whenMcpClientReleased?: () => Promise<void>
  spawn?: typeof nodeSpawn
  env?: NodeJS.ProcessEnv
  requestTimeoutMs?: number
  promptTimeoutMs?: number
  permissionTimeoutMs?: number
  cancelTimeoutMs?: number
  shutdownTimeoutMs?: number
}

class AssistantFailure extends Error {
  constructor(readonly code: AssistantErrorCode) {
    super(code)
  }
}

function failure(code: AssistantErrorCode): AssistantResult {
  return { ok: false, code }
}
function errorCode(error: unknown, fallback: AssistantErrorCode): AssistantErrorCode {
  if (error instanceof AssistantFailure) return error.code
  if (error instanceof acp.RequestError) {
    if (error.code === acp.RequestError.authRequired().code) return "authentication-required"
    if (error.code === -32601) return "unsupported"
    if (error.code === -32600 || error.code === -32602 || error.code === -32700)
      return "protocol-error"
  }
  return fallback
}

function applyInitialization(owner: Owner, init: acp.InitializeResponse) {
  if (init.protocolVersion !== acp.PROTOCOL_VERSION) throw new AssistantFailure("protocol-error")
  owner.snapshot.canResume = init.agentCapabilities?.loadSession === true
  owner.snapshot.authMethods = (init.authMethods ?? [])
    .filter((method) => !("type" in method) || method.type !== "terminal")
    .slice(0, 32)
    .map(({ id, name }) => ({ id, name: name.slice(0, 512) }))
  if (owner.resumeSessionId && !owner.snapshot.canResume) throw new AssistantFailure("unsupported")
}

async function settleShutdown(pending: Promise<unknown>, timeoutMs: number) {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([
      pending.catch(() => undefined),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, timeoutMs)
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}

export function createAssistantService(options: AssistantServiceOptions) {
  if (!isAbsolute(options.cwd)) throw new Error("The assistant working directory must be absolute.")
  let current: Owner | null = null
  let disposed = false
  let stopping = Promise.resolve()
  const requestTimeout = options.requestTimeoutMs ?? 30_000

  function emit(owner: Owner, event: AssistantEvent) {
    if (current !== owner) return
    const validated = assistantEventSchema.safeParse(event)
    if (!validated.success) {
      stop(owner, "protocol-error")
      return
    }
    options.onEvent(validated.data)
  }
  function snapshot(owner: Owner) {
    const parsed = assistantSnapshotSchema.safeParse(owner.snapshot)
    if (!parsed.success) {
      Object.assign(owner.snapshot, {
        sessionId: null,
        modes: [],
        currentModeId: null,
        models: [],
        currentModelId: null,
        authMethods: [],
      })
      stop(owner, "protocol-error")
      return assistantSnapshotSchema.parse(owner.snapshot)
    }
    const value = parsed.data
    emit(owner, {
      projectId: value.projectId,
      sessionToken: value.sessionToken,
      type: "snapshot",
      snapshot: value,
    })
    return value
  }
  function stop(owner: Owner, code?: AssistantErrorCode) {
    if (owner.stopping) return owner.stopping
    owner.stopping = stopping
    owner.failureCode = code
    owner.acceptingUpdates = false
    owner.permissions.cancel()
    clearTimeout(owner.cancelTimer)
    const child = owner.process
    owner.process = null
    if (child) {
      const released = options.whenMcpClientReleased?.() ?? Promise.resolve()
      const pending = Promise.all([
        killAssistantProcess(child),
        settleShutdown(released, options.shutdownTimeoutMs ?? 2000),
      ])
      stopping = Promise.all([stopping, pending]).then(() => undefined)
      owner.stopping = stopping
    }
    owner.connection?.close()
    owner.snapshot.status = code ? "error" : "disconnected"
    if (code)
      emit(owner, {
        projectId: owner.snapshot.projectId,
        sessionToken: owner.snapshot.sessionToken,
        type: "error",
        code,
      })
    snapshot(owner)
    return owner.stopping
  }
  async function bounded<T>(
    owner: Owner,
    promise: Promise<T>,
    timeoutMs = requestTimeout,
  ): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      return await Promise.race([
        promise,
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => {
            reject(new AssistantFailure("timeout"))
            stop(owner, "timeout")
          }, timeoutMs)
        }),
      ])
    } finally {
      clearTimeout(timer)
    }
  }
  function emitUpdate(owner: Owner, value: acp.SessionUpdate) {
    const event = sessionUpdateEvent(owner.snapshot, value)
    if (!event) return
    if (event.type !== "text" && event.type !== "thought") {
      emit(owner, event)
      return
    }
    for (let offset = 0; offset < event.text.length; offset += 32_768)
      emit(owner, { ...event, text: event.text.slice(offset, offset + 32_768) })
  }
  function acceptsUpdate(owner: Owner, sessionId: string) {
    return current === owner && owner.acceptingUpdates && sessionId === owner.snapshot.sessionId
  }
  function requestPermission(
    owner: Owner,
    params: acp.RequestPermissionRequest,
  ): Promise<acp.RequestPermissionResponse> | acp.RequestPermissionResponse {
    if (!acceptsUpdate(owner, params.sessionId) || owner.snapshot.status !== "prompting")
      return { outcome: { outcome: "cancelled" } }
    return owner.permissions.request(params)
  }
  function update(owner: Owner, params: acp.SessionNotification) {
    if (!acceptsUpdate(owner, params.sessionId)) return
    owner.eventBytes += Buffer.byteLength(JSON.stringify(params))
    owner.eventCount += 1
    if (owner.eventBytes > 2 * 1024 * 1024 || owner.eventCount > 10_000) {
      stop(owner, "protocol-error")
      return
    }
    if (params.update.sessionUpdate === "current_mode_update") {
      owner.snapshot.currentModeId = params.update.currentModeId
      snapshot(owner)
    } else if (params.update.sessionUpdate === "config_option_update") {
      owner.modelConfigId = applySessionOptions(
        owner.snapshot,
        undefined,
        params.update.configOptions,
      )
      snapshot(owner)
    } else {
      emitUpdate(owner, params.update)
    }
  }
  async function openSession(owner: Owner) {
    const agent = owner.connection?.agent
    if (!agent) throw new AssistantFailure("agent-exited")
    const input = { cwd: options.cwd, mcpServers: owner.mcp }
    let session: acp.LoadSessionResponse
    let sessionId = owner.resumeSessionId
    if (owner.resumeSessionId) {
      session = await bounded(
        owner,
        agent.request<acp.LoadSessionResponse, acp.LoadSessionRequest>(
          acp.methods.agent.session.load,
          { ...input, sessionId: owner.resumeSessionId },
        ),
      )
    } else {
      const created = await bounded(
        owner,
        agent.request<acp.NewSessionResponse, acp.NewSessionRequest>(
          acp.methods.agent.session.new,
          input,
        ),
      )
      session = created
      sessionId = created.sessionId
    }
    if (current !== owner || !owner.process) throw new AssistantFailure("stale-session")
    owner.snapshot.sessionId = sessionId ?? null
    owner.modelConfigId = applySessionOptions(owner.snapshot, session.modes, session.configOptions)
    owner.snapshot.status = "ready"
    owner.acceptingUpdates = true
    return snapshot(owner)
  }
  async function initialize(
    owner: Owner,
    agent: Extract<AssistantRequest, { operation: "connect" }>["input"]["agent"],
  ) {
    const child = spawnAssistantProcess({ ...options, agent: agent }, (code) => {
      if (owner.process) stop(owner, code)
    })
    owner.process = child
    await bounded(owner, waitForAssistantSpawn(child))
    if (current !== owner || !owner.process) throw new AssistantFailure("stale-session")
    const connection = acp
      .client({ name: "vibeshape" })
      .onRequest(acp.methods.client.session.requestPermission, ({ params }) =>
        requestPermission(owner, params),
      )
      .onNotification(acp.methods.client.session.update, ({ params }) => update(owner, params))
      .connect(
        acp.ndJsonStream(Writable.toWeb(child.stdin), Readable.toWeb(child.stdout), {
          maxMessageBytes: 1024 * 1024,
        }),
      )
    owner.connection = connection
    void connection.closed.then(() => {
      if (!owner.process) return
      stop(owner, assistantConnectionFailure(connection.signal.reason))
    })
    const init = await bounded(
      owner,
      connection.agent.request(acp.methods.agent.initialize, {
        protocolVersion: acp.PROTOCOL_VERSION,
        clientInfo: { name: "vibeshape", version: "0.1.0" },
        clientCapabilities: {},
      }),
    )
    applyInitialization(owner, init)
  }
  async function prepareConnection(owner: Owner, projectId: string) {
    await stopping
    if (current !== owner || disposed) throw new AssistantFailure("stale-session")
    if (await options.isMcpClientAttached?.()) throw new AssistantFailure("mcp-client-conflict")
    const setup = desktopMcpSetupSchema.parse(await options.getMcpSetup(projectId))
    if (current !== owner || disposed) throw new AssistantFailure("stale-session")
    const server = setup.mcpServers.vibeshape
    owner.mcp = [
      {
        name: "vibeshape",
        command: server.command,
        args: server.args,
        env: [{ name: "ELECTRON_RUN_AS_NODE", value: "1" }],
      },
    ]
  }
  async function connect(
    input: Extract<AssistantRequest, { operation: "connect" }>["input"],
  ): Promise<AssistantResult> {
    if (current) stop(current)
    const state: AssistantSnapshot = {
      projectId: input.projectId,
      sessionToken: randomUUID(),
      status: "connecting",
      sessionId: null,
      canResume: false,
      modes: [],
      currentModeId: null,
      models: [],
      currentModelId: null,
      authMethods: [],
    }
    const owner: Owner = {
      snapshot: state,
      process: null,
      connection: null,
      permissions: createAssistantPermissions(
        state,
        (event) => emit(owner, event),
        options.permissionTimeoutMs ?? 60_000,
      ),
      modelConfigId: undefined,
      mcp: [],
      resumeSessionId: input.resumeSessionId,
      busy: true,
      acceptingUpdates: false,
      eventBytes: 0,
      eventCount: 0,
      cancelTimer: undefined,
      failureCode: undefined,
      stopping: undefined,
    }
    current = owner
    snapshot(owner)
    try {
      await prepareConnection(owner, input.projectId)
      await initialize(owner, input.agent)
      return { ok: true, value: await openSession(owner) }
    } catch (error) {
      return connectFailure(owner, error)
    } finally {
      owner.busy = false
    }
  }
  function connectFailure(owner: Owner, error: unknown): AssistantResult {
    if (current !== owner || disposed) return failure("stale-session")
    const code =
      owner.failureCode ??
      errorCode(error, owner.process ? "initialization-failed" : "launch-failed")
    if (code === "authentication-required" && owner.process) {
      owner.snapshot.status = "authentication-required"
      emit(owner, {
        projectId: owner.snapshot.projectId,
        sessionToken: owner.snapshot.sessionToken,
        type: "error",
        code,
      })
      return { ok: true, value: snapshot(owner) }
    }
    if (owner.snapshot.status !== "error" && owner.snapshot.status !== "disconnected")
      stop(owner, code)
    return failure(code)
  }
  function promptFailure(owner: Owner, error: unknown): AssistantResult {
    const code =
      current !== owner || (!owner.process && !owner.failureCode)
        ? "stale-session"
        : (owner.failureCode ?? errorCode(error, "request-failed"))
    if (current === owner && owner.process) {
      owner.snapshot.status =
        code === "authentication-required" ? "authentication-required" : "ready"
      emit(owner, {
        projectId: owner.snapshot.projectId,
        sessionToken: owner.snapshot.sessionToken,
        type: "error",
        code,
      })
      snapshot(owner)
    }
    return failure(code)
  }
  async function prompt(owner: Owner, text: string): Promise<AssistantResult> {
    if (owner.busy || owner.snapshot.status !== "ready") return failure("agent-busy")
    const connection = owner.connection
    const sessionId = owner.snapshot.sessionId
    if (!connection || !sessionId) return failure("agent-exited")
    owner.busy = true
    owner.eventBytes = 0
    owner.eventCount = 0
    owner.acceptingUpdates = true
    owner.snapshot.status = "prompting"
    snapshot(owner)
    try {
      const result = await bounded(
        owner,
        connection.agent.request(acp.methods.agent.session.prompt, {
          sessionId,
          prompt: [{ type: "text", text }],
        }),
        options.promptTimeoutMs ?? 10 * 60_000,
      )
      if (current !== owner || !owner.process) return failure("stale-session")
      emit(owner, {
        projectId: owner.snapshot.projectId,
        sessionToken: owner.snapshot.sessionToken,
        type: "completed",
        stopReason: result.stopReason,
      })
      owner.snapshot.status = "ready"
      return { ok: true, value: snapshot(owner) }
    } catch (error) {
      return promptFailure(owner, error)
    } finally {
      owner.busy = false
      owner.acceptingUpdates = false
      owner.permissions.cancel()
      clearTimeout(owner.cancelTimer)
    }
  }
  function agent(owner: Owner) {
    if (!owner.connection) throw new AssistantFailure("agent-exited")
    return owner.connection.agent
  }
  function sessionId(owner: Owner) {
    if (!owner.snapshot.sessionId) throw new AssistantFailure("authentication-required")
    return owner.snapshot.sessionId
  }
  async function authenticate(owner: Owner, methodId: string) {
    if (!owner.snapshot.authMethods.some((method) => method.id === methodId))
      throw new AssistantFailure("unsupported")
    await bounded(owner, agent(owner).request(acp.methods.agent.authenticate, { methodId }))
    if (!owner.snapshot.sessionId) await openSession(owner)
    owner.snapshot.status = "ready"
  }
  async function setMode(owner: Owner, modeId: string) {
    if (!owner.snapshot.modes.some((mode) => mode.id === modeId))
      throw new AssistantFailure("unsupported")
    await bounded(
      owner,
      agent(owner).request(acp.methods.agent.session.setMode, {
        sessionId: sessionId(owner),
        modeId,
      }),
    )
    owner.snapshot.currentModeId = modeId
  }
  async function setModel(owner: Owner, modelId: string) {
    if (!owner.modelConfigId || !owner.snapshot.models.some((model) => model.id === modelId))
      throw new AssistantFailure("unsupported")
    const result = await bounded(
      owner,
      agent(owner).request(acp.methods.agent.session.setConfigOption, {
        sessionId: sessionId(owner),
        configId: owner.modelConfigId,
        value: modelId,
      }),
    )
    owner.modelConfigId = applySessionOptions(owner.snapshot, undefined, result.configOptions)
  }
  async function control(owner: Owner, request: AssistantRequest): Promise<AssistantResult> {
    if (owner.busy) return failure("agent-busy")
    owner.busy = true
    try {
      switch (request.operation) {
        case "authenticate":
          await authenticate(owner, request.input.methodId)
          break
        case "setMode":
          await setMode(owner, request.input.modeId)
          break
        case "setModel":
          await setModel(owner, request.input.modelId)
          break
        default:
          return failure("invalid-request")
      }
      if (current !== owner || !owner.process) return failure("stale-session")
      return { ok: true, value: snapshot(owner) }
    } catch (error) {
      return failure(errorCode(error, "request-failed"))
    } finally {
      owner.busy = false
    }
  }
  function cancel(owner: Owner): AssistantResult {
    if (owner.snapshot.status !== "prompting") return { ok: true, value: snapshot(owner) }
    owner.acceptingUpdates = false
    owner.permissions.cancel()
    owner.snapshot.status = "cancelling"
    owner.cancelTimer = setTimeout(() => stop(owner, "timeout"), options.cancelTimeoutMs ?? 2_000)
    void agent(owner)
      .notify(acp.methods.agent.session.cancel, { sessionId: sessionId(owner) })
      .catch(() => stop(owner, "agent-exited"))
    return { ok: true, value: snapshot(owner) }
  }
  function owned(input: { projectId: string; sessionToken: string }) {
    if (
      !current ||
      current.snapshot.projectId !== input.projectId ||
      current.snapshot.sessionToken !== input.sessionToken
    )
      return null
    return current
  }
  async function handleOwned(
    request: Exclude<AssistantRequest, { operation: "connect" }>,
  ): Promise<AssistantResult> {
    const owner = owned(request.input)
    if (!owner) return failure("stale-session")
    if (request.operation === "disconnect") {
      const stopped = stop(owner)
      current = null
      await stopped
      return { ok: true, value: { ...owner.snapshot } }
    }
    if (!owner.process || !owner.connection) return failure("agent-exited")
    switch (request.operation) {
      case "respondPermission":
        return owner.permissions.respond(request.input.requestId, request.input.allow)
          ? { ok: true, value: snapshot(owner) }
          : failure("permission-expired")
      case "cancel":
        return cancel(owner)
      case "prompt":
        return prompt(owner, request.input.text)
      default:
        return control(owner, request)
    }
  }
  return {
    async handle(payload: unknown): Promise<AssistantResult> {
      const parsed = assistantRequestSchema.safeParse(payload)
      if (!parsed.success) return failure("invalid-request")
      if (disposed) return failure("stale-session")
      const request = parsed.data
      if (request.operation === "connect") return connect(request.input)
      return handleOwned(request)
    },
    close() {
      disposed = true
      if (current) stop(current)
      current = null
      return stopping
    },
  }
}
