import type { ChildProcessWithoutNullStreams, spawn as nodeSpawn } from "node:child_process"
import { createHash, randomUUID } from "node:crypto"
import { isAbsolute } from "node:path"
import { Readable, Writable } from "node:stream"
import * as acp from "@agentclientprotocol/sdk"
import {
  type AssistantAgent,
  type AssistantAttachment,
  type AssistantErrorCode,
  type AssistantEvent,
  type AssistantRequest,
  type AssistantResult,
  type AssistantSnapshot,
  assistantAttachmentsSupported,
  assistantEventSchema,
  assistantRequestSchema,
  assistantSnapshotSchema,
} from "@vibeshape/automation-api/assistant"
import { JEV_IMAGE_CONSTRAINTS } from "@vibeshape/automation-api/assistant-jev"
import { type DesktopMcpSetup, desktopMcpSetupSchema } from "@vibeshape/automation-api/desktop-host"
import type { AssistantQuestionHost } from "@vibeshape/mcp-server/local-host"
import { z } from "zod"
import { createAssistantConnectionTests } from "./assistant-connection-test"
import type { createAssistantLaunchResolver } from "./assistant-jev-runtime"
import { createAssistantPermissions } from "./assistant-permissions"
import { assistantPromptContent } from "./assistant-prompt-content"
import { createAssistantQuestions } from "./assistant-questions"
import {
  type AssistantSessionChoice,
  assistantSessionChoiceSelected,
  assistantSessionChoiceSupported,
  assistantSessionRequestedChoice,
  createAssistantSessionPreferences,
} from "./assistant-session-preferences"
import {
  assistantSteeringThreadStatus,
  assistantSteerOutcomeSchema,
  supportsAssistantSteering,
} from "./assistant-steering"
import {
  type AssistantProcessLaunch,
  assistantConnectionFailure,
  killAssistantProcess,
  spawnAssistantProcess,
  waitForAssistantSpawn,
} from "./assistant-transport"
import {
  applySessionOptions,
  createAssistantToolTargetTracker,
  sessionUpdateEvent,
} from "./assistant-updates"

type ThreadStatus = NonNullable<ReturnType<typeof assistantSteeringThreadStatus>>
type TerminalThreadStatus = Exclude<ThreadStatus, "active">
type Owner = {
  snapshot: AssistantSnapshot
  preferencesKey: string
  toolTargets: ReturnType<typeof createAssistantToolTargetTracker>
  process: ChildProcessWithoutNullStreams | null
  connection: acp.ClientConnection | null
  permissions: ReturnType<typeof createAssistantPermissions>
  questions: ReturnType<typeof createAssistantQuestions>
  mcpQuestions: AssistantQuestionHost | undefined
  configRevision: number
  modeRevision: number
  mcp: acp.McpServerStdio[]
  resumeSessionId: string | undefined
  busy: boolean
  acceptingUpdates: boolean
  eventBytes: number
  eventCount: number
  cancelTimer: ReturnType<typeof setTimeout> | undefined
  failureCode: AssistantErrorCode | undefined
  stopping: Promise<void> | undefined
  steering: {
    sawIdle: boolean
    sawActive: boolean
    completed: TerminalThreadStatus | null
    cancelEpoch: number
  } | null
  steerReceipts: Map<string, { fingerprint: string; result: Promise<AssistantResult> }>
  externalTurn: { active: boolean } | null
  externalTimer: ReturnType<typeof setTimeout> | undefined
  threadStatus: ReturnType<typeof assistantSteeringThreadStatus>
  cancelEpoch: number
}

export type AssistantServiceOptions = {
  cwd: string
  applicationVersion: string
  getMcpSetup: (projectId: string, questions: AssistantQuestionHost) => Promise<DesktopMcpSetup>
  releaseMcpSetup?: (projectId: string, questions: AssistantQuestionHost) => void
  onEvent: (event: AssistantEvent) => void
  isMcpClientAttached?: (projectId: string) => boolean | Promise<boolean>
  whenMcpClientReleased?: (projectId: string) => Promise<void>
  spawn?: typeof nodeSpawn
  env?: NodeJS.ProcessEnv
  resolveLaunch?: ReturnType<typeof createAssistantLaunchResolver>
  requestTimeoutMs?: number
  promptTimeoutMs?: number
  permissionTimeoutMs?: number
  questionTimeoutMs?: number
  cancelTimeoutMs?: number
  shutdownTimeoutMs?: number
  connectionTestTimeoutMs?: number
  preferencesPath?: string
}

function consumeEventBudget(owner: Owner, params: acp.SessionNotification) {
  owner.eventBytes += Buffer.byteLength(JSON.stringify(params))
  owner.eventCount += 1
  if (owner.eventBytes > 2 * 1024 * 1024 || owner.eventCount > 10_000) return false
  // Long CAD turns can complete many bounded tool stages with any ACP agent.
  if (params.update.sessionUpdate === "tool_call_update" && params.update.status === "completed") {
    owner.eventBytes = 0
    owner.eventCount = 0
  }
  return true
}

class AssistantFailure extends Error {
  constructor(readonly code: AssistantErrorCode) {
    super(code)
  }
}

function failure(code: AssistantErrorCode): AssistantResult {
  return { ok: false, code }
}

function hasLiveTurnOwner(owner: Owner) {
  return (
    owner.busy ||
    owner.steering !== null ||
    owner.externalTurn !== null ||
    owner.questions.hasPending()
  )
}

function recordPendingSteeringActivity(
  pending: NonNullable<Owner["steering"]>,
  status: ThreadStatus,
) {
  if (status === "active") {
    if (pending.sawIdle) pending.sawActive = true
    return
  }
  if (pending.sawActive) pending.completed = status
  pending.sawIdle = true
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

function agentAttachmentCapabilities(init: acp.InitializeResponse, agent: AssistantAgent) {
  const capabilities = {
    text: init.agentCapabilities?.promptCapabilities?.embeddedContext === true,
    images: init.agentCapabilities?.promptCapabilities?.image === true,
  }
  if (!("kind" in agent) || !capabilities.images) return capabilities
  return {
    ...capabilities,
    imageConstraints: {
      ...JEV_IMAGE_CONSTRAINTS,
      mimeTypes: [...JEV_IMAGE_CONSTRAINTS.mimeTypes],
    },
  }
}

function applyInitialization(owner: Owner, init: acp.InitializeResponse, agent: AssistantAgent) {
  if (init.protocolVersion !== acp.PROTOCOL_VERSION) throw new AssistantFailure("protocol-error")
  owner.snapshot.canResume = init.agentCapabilities?.loadSession === true
  if (supportsAssistantSteering(init)) owner.snapshot.canSteer = true
  owner.snapshot.attachmentCapabilities = agentAttachmentCapabilities(init, agent)
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
  const owners = new Map<string, Owner>()
  const connectionTests = createAssistantConnectionTests(options)
  const preferences = createAssistantSessionPreferences(options.preferencesPath)
  let disposed = false
  const stopping = new Map<string, Promise<void>>()
  const requestTimeout = options.requestTimeoutMs ?? 30_000

  function isCurrent(owner: Owner) {
    return owners.get(owner.snapshot.projectId) === owner
  }
  function assertCurrent(owner: Owner) {
    if (!isCurrent(owner) || !owner.process || disposed) throw new AssistantFailure("stale-session")
  }
  function emit(owner: Owner, event: AssistantEvent) {
    if (!isCurrent(owner)) return
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
        configOptions: [],
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
  function releaseAssistantResources(owner: Owner) {
    owner.toolTargets.clear()
    owner.externalTurn = null
    clearTimeout(owner.externalTimer)
    owner.permissions.cancel()
    owner.questions.cancel()
    if (owner.mcpQuestions) options.releaseMcpSetup?.(owner.snapshot.projectId, owner.mcpQuestions)
    clearTimeout(owner.cancelTimer)
  }
  function stop(owner: Owner, code?: AssistantErrorCode) {
    if (owner.stopping) return owner.stopping
    owner.stopping = stopping.get(owner.snapshot.projectId) ?? Promise.resolve()
    owner.failureCode = code
    owner.acceptingUpdates = false
    releaseAssistantResources(owner)
    const child = owner.process
    owner.process = null
    if (child) {
      const released =
        options.whenMcpClientReleased?.(owner.snapshot.projectId) ?? Promise.resolve()
      const pending = Promise.all([
        killAssistantProcess(child),
        settleShutdown(released, options.shutdownTimeoutMs ?? 2000),
      ])
      owner.stopping = Promise.all([owner.stopping, pending]).then(() => undefined)
      stopping.set(owner.snapshot.projectId, owner.stopping)
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
    timeoutMs: number | null = requestTimeout,
  ): Promise<T> {
    if (timeoutMs === null) return promise
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
    const event = sessionUpdateEvent(owner.snapshot, value, owner.toolTargets)
    if (!event) return
    if (event.type !== "text" && event.type !== "thought") {
      emit(owner, event)
      return
    }
    for (let offset = 0; offset < event.text.length; offset += 32_768)
      emit(owner, { ...event, text: event.text.slice(offset, offset + 32_768) })
  }
  function acceptsUpdate(owner: Owner, sessionId: string) {
    return isCurrent(owner) && owner.acceptingUpdates && sessionId === owner.snapshot.sessionId
  }
  function hasConnectedSession(owner: Owner, sessionId: string) {
    return isCurrent(owner) && owner.process !== null && sessionId === owner.snapshot.sessionId
  }
  function requestPermission(
    owner: Owner,
    params: acp.RequestPermissionRequest,
  ): Promise<acp.RequestPermissionResponse> | acp.RequestPermissionResponse {
    if (!acceptsUpdate(owner, params.sessionId) || owner.snapshot.status !== "prompting")
      return { outcome: { outcome: "cancelled" } }
    return owner.permissions.request(params)
  }
  function acceptsIdleConfiguration(owner: Owner, params: acp.SessionNotification) {
    return (
      ["config_option_update", "current_mode_update"].includes(params.update.sessionUpdate) &&
      hasConnectedSession(owner, params.sessionId) &&
      (owner.snapshot.status === "ready" || owner.snapshot.status === "connecting")
    )
  }
  function update(owner: Owner, params: acp.SessionNotification) {
    if (hasConnectedSession(owner, params.sessionId)) updateSteeringActivity(owner, params.update)
    if (!acceptsUpdate(owner, params.sessionId) && !acceptsIdleConfiguration(owner, params)) return
    if (!consumeEventBudget(owner, params)) {
      stop(owner, "protocol-error")
      return
    }
    if (params.update.sessionUpdate === "current_mode_update") {
      owner.snapshot.currentModeId = params.update.currentModeId
      owner.modeRevision += 1
      snapshot(owner)
    } else if (params.update.sessionUpdate === "config_option_update") {
      applySessionOptions(owner.snapshot, undefined, params.update.configOptions)
      owner.configRevision += 1
      snapshot(owner)
    } else {
      emitUpdate(owner, params.update)
    }
  }
  async function loadSession(
    owner: Owner,
    agent: acp.ClientConnection["agent"],
    input: acp.LoadSessionRequest,
  ) {
    try {
      return await bounded(
        owner,
        agent.request<acp.LoadSessionResponse, acp.LoadSessionRequest>(
          acp.methods.agent.session.load,
          input,
        ),
      )
    } catch (error) {
      // Codex can advertise resume before an unused thread has a persisted rollout.
      if (
        error instanceof acp.RequestError &&
        error.code === -32603 &&
        z
          .object({
            details: z.literal(`no rollout found for thread id ${input.sessionId}`),
          })
          .safeParse(error.data).success
      )
        throw new AssistantFailure("session-unavailable")
      throw error
    }
  }
  async function openSession(owner: Owner) {
    const agent = owner.connection?.agent
    if (!agent) throw new AssistantFailure("agent-exited")
    const input = { cwd: options.cwd, mcpServers: owner.mcp }
    let session: acp.LoadSessionResponse
    let sessionId = owner.resumeSessionId
    if (owner.resumeSessionId) {
      session = await loadSession(owner, agent, { ...input, sessionId: owner.resumeSessionId })
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
    if (!isCurrent(owner) || !owner.process) throw new AssistantFailure("stale-session")
    owner.snapshot.sessionId = sessionId ?? null
    applySessionOptions(owner.snapshot, session.modes, session.configOptions)
    owner.configRevision += 1
    owner.snapshot.status = "connecting"
    await recoverSettings(owner)
    assertCurrent(owner)
    owner.snapshot.status = "ready"
    owner.acceptingUpdates = true
    return snapshot(owner)
  }
  function resolveLaunch(
    input: Extract<AssistantRequest, { operation: "connect" }>["input"],
  ): AssistantProcessLaunch {
    if (options.resolveLaunch) {
      const resolved = options.resolveLaunch(input.projectId, input.agent, input.jevCredentials)
      if (!resolved.ok) throw new AssistantFailure(resolved.code)
      return resolved.launch
    }
    if ("command" in input.agent) return { agent: input.agent }
    throw new AssistantFailure("jev-configuration-required")
  }
  async function initialize(
    owner: Owner,
    input: Extract<AssistantRequest, { operation: "connect" }>["input"],
  ) {
    if (!isCurrent(owner) || disposed) throw new AssistantFailure("stale-session")
    const child = spawnAssistantProcess({ ...options, ...resolveLaunch(input) }, (code) => {
      if (owner.process) stop(owner, code)
    })
    owner.process = child
    await bounded(owner, waitForAssistantSpawn(child))
    if (!isCurrent(owner) || !owner.process) throw new AssistantFailure("stale-session")
    const connection = acp
      .client({ name: "vibeshape" })
      .onRequest(acp.methods.client.session.requestPermission, ({ params }) =>
        requestPermission(owner, params),
      )
      .onNotification(acp.methods.client.session.update, ({ params }) => update(owner, params))
      .onRequest(acp.methods.client.elicitation.create, ({ params, signal }) =>
        "sessionId" in params &&
        typeof params.sessionId === "string" &&
        acceptsUpdate(owner, params.sessionId)
          ? owner.questions.request(params, signal)
          : Promise.resolve({ action: "decline" as const }),
      )
      .connect(
        // Session replay includes attachment-sized prompts; live output has its own budget.
        acp.ndJsonStream(Writable.toWeb(child.stdin), Readable.toWeb(child.stdout)),
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
        clientInfo: { name: "vibeshape", version: options.applicationVersion },
        clientCapabilities: { elicitation: { form: {} } },
      }),
    )
    applyInitialization(owner, init, input.agent)
  }
  async function prepareConnection(owner: Owner, projectId: string) {
    await stopping.get(projectId)
    if (!isCurrent(owner) || disposed) throw new AssistantFailure("stale-session")
    if (await options.isMcpClientAttached?.(projectId))
      throw new AssistantFailure("mcp-client-conflict")
    const questions: AssistantQuestionHost = {
      async request(input, signal) {
        if (
          !isCurrent(owner) ||
          !owner.process ||
          !owner.acceptingUpdates ||
          owner.snapshot.status !== "prompting" ||
          signal.aborted
        )
          return { action: "decline" }
        const epoch = owner.cancelEpoch
        const result = await owner.questions.requestInput(input, signal)
        return isCurrent(owner) && owner.process && owner.cancelEpoch === epoch
          ? result
          : { action: "cancel" }
      },
      canInvoke: () =>
        isCurrent(owner) &&
        owner.process !== null &&
        owner.acceptingUpdates &&
        owner.snapshot.status === "prompting" &&
        owner.snapshot.questionStatus === undefined,
    }
    owner.mcpQuestions = questions
    const setup = desktopMcpSetupSchema.parse(await options.getMcpSetup(projectId, questions))
    if (!isCurrent(owner) || disposed) {
      options.releaseMcpSetup?.(projectId, questions)
      throw new AssistantFailure("stale-session")
    }
    const server = setup.mcpServers.vibeshape
    owner.mcp = [
      {
        // ACP adapters may drop names present in any user configuration layer, even disabled ones.
        // Hash the full identity to preserve resume history without UUIDv7 timestamp collisions.
        name: `vs_${createHash("sha256").update(projectId).digest("hex").slice(0, 16)}`,
        command: server.command,
        args: server.args,
        env: [{ name: "ELECTRON_RUN_AS_NODE", value: "1" }],
      },
    ]
  }
  async function connect(
    input: Extract<AssistantRequest, { operation: "connect" }>["input"],
  ): Promise<AssistantResult> {
    const previous = owners.get(input.projectId)
    if (previous) {
      // Retire ownership before teardown so its terminal event cannot recover over the replacement.
      owners.delete(input.projectId)
      stop(previous)
    }
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
      configOptions: [],
      attachmentCapabilities: { text: false, images: false },
      authMethods: [],
    }
    const owner: Owner = {
      snapshot: state,
      preferencesKey: createHash("sha256").update(JSON.stringify(input.agent)).digest("hex"),
      toolTargets: createAssistantToolTargetTracker(),
      process: null,
      connection: null,
      permissions: createAssistantPermissions(
        state,
        (event) => emit(owner, event),
        options.permissionTimeoutMs ?? 60_000,
      ),
      questions: createAssistantQuestions(
        state,
        (event) => questionEvent(owner, event),
        options.questionTimeoutMs ?? 300_000,
      ),
      mcpQuestions: undefined,
      configRevision: 0,
      modeRevision: 0,
      mcp: [],
      resumeSessionId: input.resumeSessionId,
      busy: true,
      acceptingUpdates: false,
      eventBytes: 0,
      eventCount: 0,
      cancelTimer: undefined,
      failureCode: undefined,
      stopping: undefined,
      steering: null,
      steerReceipts: new Map(),
      externalTurn: null,
      externalTimer: undefined,
      threadStatus: null,
      cancelEpoch: 0,
    }
    owners.set(input.projectId, owner)
    snapshot(owner)
    try {
      await prepareConnection(owner, input.projectId)
      await initialize(owner, input)
      return { ok: true, value: await openSession(owner) }
    } catch (error) {
      return connectFailure(owner, error)
    } finally {
      owner.busy = false
    }
  }
  function connectFailure(owner: Owner, error: unknown): AssistantResult {
    if (!isCurrent(owner) || disposed) return failure("stale-session")
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
      !isCurrent(owner) || (!owner.process && !owner.failureCode)
        ? "stale-session"
        : (owner.failureCode ?? errorCode(error, "request-failed"))
    if (isCurrent(owner) && owner.process) {
      if (code === "authentication-required") {
        owner.snapshot.status = "authentication-required"
        owner.acceptingUpdates = false
        owner.externalTurn = null
        clearTimeout(owner.externalTimer)
        owner.permissions.cancel()
        owner.questions.cancel()
      }
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
  function settleTurnReadiness(owner: Owner) {
    if (!isCurrent(owner) || !owner.process) return
    const pending = hasLiveTurnOwner(owner)
    owner.acceptingUpdates = pending && owner.snapshot.status === "prompting"
    if (pending) return
    owner.toolTargets.clear()
    if (owner.snapshot.status === "prompting" || owner.snapshot.status === "cancelling")
      owner.snapshot.status = "ready"
    clearTimeout(owner.cancelTimer)
  }
  function updateQuestionStatus(owner: Owner, event: AssistantEvent) {
    if (event.type === "question") owner.snapshot.questionStatus = "pending"
    else if (event.type === "question-resolved") {
      if (event.reason !== "answered") owner.snapshot.questionStatus = "paused"
      else if (!owner.questions.hasPending() && owner.snapshot.questionStatus !== "paused")
        delete owner.snapshot.questionStatus
    }
  }
  function questionEvent(owner: Owner, event: AssistantEvent) {
    updateQuestionStatus(owner, event)
    emit(owner, event)
    if (!owner.acceptingUpdates) return
    if (owner.connection?.signal.aborted) return
    if (event.type === "question-resolved" && event.reason !== "answered" && owner.process)
      requestCancellation(owner)
    else settleTurnReadiness(owner)
    snapshot(owner)
  }
  function finishExternalTurn(owner: Owner, status: TerminalThreadStatus) {
    const cancelled = owner.snapshot.status === "cancelling"
    owner.externalTurn = null
    clearTimeout(owner.externalTimer)
    settleTurnReadiness(owner)
    emit(owner, {
      projectId: owner.snapshot.projectId,
      sessionToken: owner.snapshot.sessionToken,
      type: "completed",
      stopReason: cancelled ? "cancelled" : status === "idle" ? "end_turn" : "error",
    })
    if (status === "systemError" || status === "notLoaded")
      emit(owner, {
        projectId: owner.snapshot.projectId,
        sessionToken: owner.snapshot.sessionToken,
        type: "error",
        code: "request-failed",
      })
    snapshot(owner)
  }
  function updateSteeringActivity(owner: Owner, update: acp.SessionUpdate) {
    if (!owner.snapshot.canSteer) return
    const status = assistantSteeringThreadStatus(update)
    if (!status) return
    owner.threadStatus = status
    if (owner.steering) recordPendingSteeringActivity(owner.steering, status)
    if (owner.externalTurn) {
      if (status === "active") owner.externalTurn.active = true
      else if (owner.externalTurn.active) finishExternalTurn(owner, status)
    }
  }
  function supportedAttachments(owner: Owner, attachments: readonly AssistantAttachment[]) {
    return assistantAttachmentsSupported(attachments, owner.snapshot.attachmentCapabilities)
  }
  function settleSteering(owner: Owner) {
    owner.steering = null
    if (!isCurrent(owner) || !owner.process) return
    settleTurnReadiness(owner)
    snapshot(owner)
  }
  function acceptSteerOutcome(owner: Owner, outcome: "injected" | "startedNewTurn") {
    const pending = owner.steering
    if (outcome !== "startedNewTurn" || !pending) return
    if (pending.completed) return finishExternalTurn(owner, pending.completed)
    owner.externalTurn = { active: pending.sawActive }
    // A reserved fallback owns a new logical turn before its active notification arrives.
    if (!pending.sawActive) owner.threadStatus = null
    owner.snapshot.status = "prompting"
    owner.externalTimer =
      options.promptTimeoutMs === undefined
        ? undefined
        : setTimeout(() => stop(owner, "timeout"), options.promptTimeoutMs)
    if (pending.cancelEpoch !== owner.cancelEpoch) requestCancellation(owner)
  }
  async function performSteering(
    owner: Owner,
    input: Extract<AssistantRequest, { operation: "steer" }>["input"],
  ) {
    const pending: NonNullable<Owner["steering"]> = {
      sawIdle: owner.threadStatus !== null && owner.threadStatus !== "active",
      sawActive: false,
      completed: null,
      cancelEpoch: owner.cancelEpoch,
    }
    owner.steering = pending
    owner.acceptingUpdates = true
    try {
      const response = await bounded(
        owner,
        agent(owner).request("_session/steering", {
          sessionId: sessionId(owner),
          prompt: assistantPromptContent(owner.snapshot.projectId, input.text, input.attachments),
        }),
      )
      if (!isCurrent(owner) || !owner.process) throw new AssistantFailure("stale-session")
      const parsed = assistantSteerOutcomeSchema.safeParse(response)
      if (!parsed.success) throw new AssistantFailure("protocol-error")
      if (parsed.data.outcome === "failed") throw new AssistantFailure("request-failed")
      acceptSteerOutcome(owner, parsed.data.outcome)
      return parsed.data.outcome
    } finally {
      settleSteering(owner)
    }
  }
  function steerBlocked(owner: Owner, attachments: readonly AssistantAttachment[]) {
    if (owner.snapshot.questionStatus) return "agent-busy"
    if (!owner.snapshot.canSteer) return "unsupported"
    if (owner.snapshot.status !== "prompting" || owner.steering) return "agent-busy"
    return supportedAttachments(owner, attachments) ? null : "unsupported"
  }
  function rememberSteer(
    owner: Owner,
    requestId: string,
    fingerprint: string,
    result: Promise<AssistantResult>,
  ) {
    owner.steerReceipts.set(requestId, { fingerprint, result })
    if (owner.steerReceipts.size > 128) {
      const oldest = owner.steerReceipts.keys().next().value
      if (oldest) owner.steerReceipts.delete(oldest)
    }
    void result.then((value) => {
      if (!value.ok) owner.steerReceipts.delete(requestId)
    })
  }
  function steer(
    owner: Owner,
    input: Extract<AssistantRequest, { operation: "steer" }>["input"],
  ): Promise<AssistantResult> {
    const fingerprint = createHash("sha256").update(JSON.stringify(input)).digest("hex")
    const previous = owner.steerReceipts.get(input.requestId)
    if (previous)
      return previous.fingerprint === fingerprint
        ? previous.result
        : Promise.resolve(failure("invalid-request"))
    const blocked = steerBlocked(owner, input.attachments)
    if (blocked) return Promise.resolve(failure(blocked))
    const result: Promise<AssistantResult> = performSteering(owner, input).then(
      (steerOutcome) => ({ ok: true, value: snapshot(owner), steerOutcome }),
      (error) => failure(errorCode(error, "request-failed")),
    )
    rememberSteer(owner, input.requestId, fingerprint, result)
    return result
  }
  function preparePrompt(
    owner: Owner,
    attachments: readonly AssistantAttachment[],
  ):
    | { ok: true; connection: acp.ClientConnection; sessionId: string }
    | { ok: false; code: AssistantErrorCode } {
    if (hasLiveTurnOwner(owner) || owner.snapshot.status !== "ready")
      return { ok: false, code: "agent-busy" }
    if (!supportedAttachments(owner, attachments)) return { ok: false, code: "unsupported" }
    const connection = owner.connection
    const sessionId = owner.snapshot.sessionId
    if (!connection || !sessionId) return { ok: false, code: "agent-exited" }
    return { ok: true, connection, sessionId }
  }
  function releasePrompt(owner: Owner) {
    owner.busy = false
    settleTurnReadiness(owner)
    if (!owner.acceptingUpdates) {
      owner.permissions.cancel()
      owner.questions.cancel()
    }
  }
  async function prompt(
    owner: Owner,
    text: string,
    attachments: readonly AssistantAttachment[],
  ): Promise<AssistantResult> {
    const prepared = preparePrompt(owner, attachments)
    if (!prepared.ok) return prepared
    const { connection, sessionId } = prepared
    owner.busy = true
    delete owner.snapshot.questionStatus
    // Terminal metadata from a previous prompt cannot seed this turn's steering lifecycle.
    owner.threadStatus = null
    owner.eventBytes = 0
    owner.eventCount = 0
    owner.acceptingUpdates = true
    owner.snapshot.status = "prompting"
    snapshot(owner)
    try {
      let result: acp.PromptResponse
      try {
        result = await bounded(
          owner,
          connection.agent.request(acp.methods.agent.session.prompt, {
            sessionId,
            prompt: assistantPromptContent(owner.snapshot.projectId, text, attachments),
          }),
          options.promptTimeoutMs ?? null,
        )
      } finally {
        releasePrompt(owner)
      }
      if (!isCurrent(owner) || !owner.process) return failure("stale-session")
      emit(owner, {
        projectId: owner.snapshot.projectId,
        sessionToken: owner.snapshot.sessionToken,
        type: "completed",
        stopReason: result.stopReason,
      })
      return { ok: true, value: snapshot(owner) }
    } catch (error) {
      return promptFailure(owner, error)
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
    const config = owner.snapshot.configOptions.find((option) => option.category === "mode")
    if (config) return setConfigOption(owner, config.id, modeId)
    if (!owner.snapshot.modes.some((mode) => mode.id === modeId))
      throw new AssistantFailure("unsupported")
    const revision = owner.modeRevision
    await bounded(
      owner,
      agent(owner).request(acp.methods.agent.session.setMode, {
        sessionId: sessionId(owner),
        modeId,
      }),
    )
    assertCurrent(owner)
    if (owner.modeRevision === revision) owner.snapshot.currentModeId = modeId
  }
  async function setModel(owner: Owner, modelId: string) {
    const config = owner.snapshot.configOptions.find((option) => option.category === "model")
    if (!config) throw new AssistantFailure("unsupported")
    await setConfigOption(owner, config.id, modelId)
  }
  async function setConfigOption(owner: Owner, configId: string, value: string) {
    const config = owner.snapshot.configOptions.find((option) => option.id === configId)
    if (!config?.options.some((option) => option.id === value))
      throw new AssistantFailure("unsupported")
    const revision = owner.configRevision
    const result = await bounded(
      owner,
      agent(owner).request(acp.methods.agent.session.setConfigOption, {
        sessionId: sessionId(owner),
        configId,
        value,
      }),
    )
    assertCurrent(owner)
    // A newer full notification supersedes an in-flight response's older option set.
    if (owner.configRevision === revision) {
      applySessionOptions(owner.snapshot, undefined, result.configOptions)
      owner.configRevision += 1
    }
  }
  function assertSelectedChoice(owner: Owner, choice: AssistantSessionChoice) {
    if (!assistantSessionChoiceSupported(owner.snapshot, choice))
      throw new AssistantFailure("settings-unavailable")
    if (!assistantSessionChoiceSelected(owner.snapshot, choice))
      throw new AssistantFailure("settings-recovery-failed")
  }
  async function restoreChoice(owner: Owner, choice: AssistantSessionChoice) {
    assertCurrent(owner)
    if (!assistantSessionChoiceSupported(owner.snapshot, choice))
      throw new AssistantFailure("settings-unavailable")
    if (assistantSessionChoiceSelected(owner.snapshot, choice)) return
    if (choice.kind === "mode") await setMode(owner, choice.value)
    else await setConfigOption(owner, choice.id, choice.value)
    assertCurrent(owner)
    assertSelectedChoice(owner, choice)
  }
  async function recoverSettings(owner: Owner) {
    const choices = await preferences.read(owner.preferencesKey)
    try {
      for (const choice of choices) await restoreChoice(owner, choice)
      for (const choice of choices) assertSelectedChoice(owner, choice)
    } catch (error) {
      assertCurrent(owner)
      const code =
        error instanceof AssistantFailure && error.code === "settings-unavailable"
          ? "settings-unavailable"
          : "settings-recovery-failed"
      if (code === "settings-unavailable")
        await preferences.discardUnavailable(owner.preferencesKey, owner.snapshot)
      stop(owner, code)
      throw new AssistantFailure(code)
    }
  }
  function performControl(owner: Owner, request: AssistantRequest) {
    switch (request.operation) {
      case "authenticate":
        return authenticate(owner, request.input.methodId)
      case "setMode":
        return setMode(owner, request.input.modeId)
      case "setModel":
        return setModel(owner, request.input.modelId)
      case "setConfigOption":
        return setConfigOption(owner, request.input.configId, request.input.value)
      default:
        throw new AssistantFailure("invalid-request")
    }
  }
  async function control(owner: Owner, request: AssistantRequest): Promise<AssistantResult> {
    if (hasLiveTurnOwner(owner)) return failure("agent-busy")
    owner.busy = true
    try {
      const choice = assistantSessionRequestedChoice(owner.snapshot, request)
      await performControl(owner, request)
      if (!isCurrent(owner) || !owner.process) return failure("stale-session")
      const value = snapshot(owner)
      assertCurrent(owner)
      if (choice) await preferences.remember(owner.preferencesKey, choice, value)
      assertCurrent(owner)
      return { ok: true, value }
    } catch (error) {
      if (!isCurrent(owner) || disposed) return failure("stale-session")
      return failure(errorCode(error, "request-failed"))
    } finally {
      owner.busy = false
    }
  }
  function requestCancellation(owner: Owner) {
    owner.acceptingUpdates = false
    owner.permissions.cancel()
    owner.questions.cancel()
    owner.snapshot.status = "cancelling"
    clearTimeout(owner.cancelTimer)
    owner.cancelTimer = setTimeout(() => stop(owner, "timeout"), options.cancelTimeoutMs ?? 2_000)
    void agent(owner)
      .notify(acp.methods.agent.session.cancel, { sessionId: sessionId(owner) })
      .catch(() => stop(owner, "agent-exited"))
  }
  function cancel(owner: Owner): AssistantResult {
    if (owner.snapshot.status !== "prompting") return { ok: true, value: snapshot(owner) }
    owner.cancelEpoch += 1
    requestCancellation(owner)
    return { ok: true, value: snapshot(owner) }
  }
  function owned(input: { projectId: string; sessionToken: string }) {
    const owner = owners.get(input.projectId)
    return owner?.snapshot.sessionToken === input.sessionToken ? owner : null
  }
  function respondPermission(owner: Owner, requestId: string, allow: boolean): AssistantResult {
    return owner.permissions.respond(requestId, allow)
      ? { ok: true, value: snapshot(owner) }
      : failure("permission-expired")
  }
  function respondQuestion(
    owner: Owner,
    requestId: string,
    answers: Record<string, string> | null,
  ): AssistantResult {
    return owner.questions.respond(requestId, answers)
      ? { ok: true, value: snapshot(owner) }
      : failure("invalid-request")
  }
  async function handleOwned(
    request: Exclude<AssistantRequest, { operation: "connect" }>,
  ): Promise<AssistantResult> {
    const owner = owned(request.input)
    if (!owner) return failure("stale-session")
    if (request.operation === "disconnect") {
      const stopped = stop(owner)
      owners.delete(request.input.projectId)
      await stopped
      return { ok: true, value: { ...owner.snapshot } }
    }
    if (!owner.process || !owner.connection) return failure("agent-exited")
    return dispatchConnectedRequest(owner, request)
  }
  function dispatchConnectedRequest(
    owner: Owner,
    request: Exclude<AssistantRequest, { operation: "connect" | "disconnect" }>,
  ): Promise<AssistantResult> | AssistantResult {
    switch (request.operation) {
      case "respondPermission":
        return respondPermission(owner, request.input.requestId, request.input.allow)
      case "respondQuestion":
        return respondQuestion(owner, request.input.requestId, request.input.answers)
      case "cancel":
        return cancel(owner)
      case "prompt":
        return prompt(owner, request.input.text, request.input.attachments)
      case "steer":
        return steer(owner, request.input)
      default:
        return control(owner, request)
    }
  }
  return {
    testConnection: connectionTests.testConnection,
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
      for (const owner of owners.values()) stop(owner)
      owners.clear()
      return Promise.all([...stopping.values(), connectionTests.close(), preferences.close()]).then(
        () => undefined,
      )
    },
  }
}
