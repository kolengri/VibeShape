import { spawn } from "node:child_process"
import { mkdtemp, rm } from "node:fs/promises"
import { homedir, tmpdir } from "node:os"
import { delimiter, join } from "node:path"
import { Readable, Writable } from "node:stream"
import * as acp from "@agentclientprotocol/sdk"
import type { AssistantExternalAgent } from "@vibeshape/automation-api/assistant"
import { JevFailure } from "./failure"
import { windowsArgumentLaunch } from "./windows-argument-process"

function localEnvironment() {
  const env: NodeJS.ProcessEnv = {}
  for (const key of [
    "HOME",
    "USERPROFILE",
    "LOGNAME",
    "USER",
    "USERNAME",
    "PATH",
    "SHELL",
    "TERM",
    "TMPDIR",
    "TMP",
    "TEMP",
    "SystemRoot",
    "WINDIR",
    "APPDATA",
    "LOCALAPPDATA",
    "XDG_CONFIG_HOME",
    "XDG_DATA_HOME",
    "XDG_CACHE_HOME",
    "CODEX_HOME",
    "CLAUDE_CONFIG_DIR",
  ])
    if (process.env[key]) env[key] = process.env[key]
  if (process.platform === "win32" && process.env.VIBESHAPE_ARGUMENT_TRACE)
    env.VIBESHAPE_ARGUMENT_TRACE = process.env.VIBESHAPE_ARGUMENT_TRACE
  if (process.platform === "darwin") {
    const home = env.HOME || homedir()
    env.PATH = [
      ...new Set([
        ...(env.PATH ?? "/usr/bin:/bin:/usr/sbin:/sbin").split(delimiter),
        join(home, ".local", "bin"),
        join(home, ".bun", "bin"),
        "/opt/homebrew/bin",
        "/usr/local/bin",
      ]),
    ].join(delimiter)
  }
  return env
}

// No project attachment or client filesystem/terminal capabilities are offered to this helper.
export async function requestLocalArguments(
  agent: AssistantExternalAgent,
  prompt: string,
  signal: AbortSignal,
): Promise<string> {
  signal.throwIfAborted()
  const cwd = await mkdtemp(join(tmpdir(), "vibeshape-arguments-"))
  let child: ReturnType<typeof spawn> | undefined
  let connection: acp.ClientConnection | undefined
  let abort: (() => void) | undefined
  let startupData: ((chunk: Buffer) => void) | undefined
  let rejectFailure: (reason: Error) => void = () => {}
  const kill = (kind: NodeJS.Signals) => {
    if (!child?.pid) return
    try {
      if (process.platform !== "win32") process.kill(-child.pid, kind)
      // On Windows this is the job-owning supervisor, not the ACP leader.
      else child.kill(kind)
    } catch {
      /* The process may already have exited. */
    }
  }
  const onExit = () => kill("SIGKILL")
  const onTerminate = () => {
    onExit()
    process.exit(143)
  }
  const onInterrupt = () => {
    onExit()
    process.exit(130)
  }
  try {
    signal.throwIfAborted()
    const env = localEnvironment()
    const launch =
      process.platform === "win32"
        ? await windowsArgumentLaunch(agent, env, cwd)
        : { ...agent, env }
    signal.throwIfAborted()
    child = spawn(launch.command, launch.args, {
      cwd,
      env: launch.env,
      shell: false,
      detached: process.platform !== "win32",
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    })
    process.once("exit", onExit)
    process.once("SIGTERM", onTerminate)
    process.once("SIGINT", onInterrupt)
    const processHandle = child
    const failed = new Promise<never>((_, reject) => {
      rejectFailure = reject
      processHandle.once("error", () =>
        reject(new JevFailure("Local argument agent could not start.")),
      )
      processHandle.once("exit", () => reject(new JevFailure("Local argument agent exited.")))
      abort = () => reject(new JevFailure("Argument completion was cancelled."))
      signal.addEventListener("abort", abort, { once: true })
      if (signal.aborted) abort()
    })
    const token = "ready" in launch ? launch.ready : undefined
    const startup = token
      ? new Promise<void>((resolve) => {
          let tail = ""
          const receive = (chunk: Buffer) => {
            const text = tail + chunk.toString("utf8")
            if (text.includes(token)) {
              processHandle.stderr?.removeListener("data", receive)
              resolve()
            }
            tail = text.slice(-token.length)
          }
          startupData = receive
          processHandle.stderr?.on("data", receive)
        })
      : Promise.resolve()
    await Promise.race([
      new Promise<void>((resolve) => processHandle.once("spawn", resolve)),
      failed,
    ])
    child.stderr?.resume()
    if (!child.stdin || !child.stdout || (token && !child.stderr))
      throw new JevFailure("Local argument agent has no stdio.")
    // The Windows wrapper must finish setup before it can hand raw stdin to the ACP agent.
    await Promise.race([startup, failed])
    signal.throwIfAborted()
    child.stdin.on("error", () => connection?.close())
    let sessionId: string | undefined
    let text = ""
    let bytes = 0
    connection = acp
      .client({ name: "vibeshape-arguments" })
      .onRequest(acp.methods.client.session.requestPermission, () => ({
        outcome: { outcome: "cancelled" },
      }))
      .onNotification(acp.methods.client.session.update, ({ params }) => {
        if (params.sessionId !== sessionId || params.update.sessionUpdate !== "agent_message_chunk")
          return
        const content = params.update.content
        if (content.type !== "text") {
          rejectFailure(new JevFailure("Local argument agent returned non-text content."))
          return
        }
        bytes += Buffer.byteLength(content.text)
        if (bytes > 256 * 1024) {
          rejectFailure(new JevFailure("Argument provider response exceeds the 256 KiB limit."))
          return
        }
        text += content.text
      })
      .connect(
        acp.ndJsonStream(Writable.toWeb(child.stdin), Readable.toWeb(child.stdout), {
          maxMessageBytes: 512 * 1024,
        }),
      )
    const client = connection
    const run = async () => {
      const init = await client.agent.request(acp.methods.agent.initialize, {
        protocolVersion: acp.PROTOCOL_VERSION,
        clientCapabilities: {},
        clientInfo: { name: "vibeshape-arguments", version: "0.0.0" },
      })
      if (init.protocolVersion !== acp.PROTOCOL_VERSION)
        throw new JevFailure("Local argument agent uses an incompatible ACP version.")
      const session = await client.agent.request(acp.methods.agent.session.new, {
        cwd,
        mcpServers: [],
      })
      sessionId = session.sessionId
      const result = await client.agent.request(acp.methods.agent.session.prompt, {
        sessionId,
        prompt: [{ type: "text", text: prompt }],
      })
      signal.throwIfAborted()
      if (result.stopReason !== "end_turn" || !text.trim())
        throw new JevFailure("Local argument agent did not complete its response.")
      return text
    }
    return await Promise.race([
      run(),
      failed,
      client.closed.then(() => {
        throw new JevFailure("Local argument agent connection closed.")
      }),
    ])
  } catch (error) {
    if (error instanceof JevFailure) throw error
    throw new JevFailure(
      signal.aborted
        ? "Argument completion was cancelled."
        : "Local argument agent failed. Check its installation and existing sign-in.",
    )
  } finally {
    if (startupData) child?.stderr?.removeListener("data", startupData)
    if (abort) signal.removeEventListener("abort", abort)
    connection?.close()
    if (child?.pid) {
      await new Promise<void>((resolve) => {
        let finished = false
        const finish = () => {
          if (finished) return
          finished = true
          // Leader closure does not prove its backend descendants have exited.
          kill("SIGKILL")
          clearTimeout(force)
          clearTimeout(deadline)
          child?.removeListener("close", finish)
          resolve()
        }
        const force = setTimeout(() => kill("SIGKILL"), 300)
        const deadline = setTimeout(finish, 1000)
        child?.once("close", finish)
        kill("SIGTERM")
      })
    }
    process.removeListener("exit", onExit)
    process.removeListener("SIGTERM", onTerminate)
    process.removeListener("SIGINT", onInterrupt)
    await rm(cwd, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
}
