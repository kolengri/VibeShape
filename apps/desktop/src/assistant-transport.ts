import {
  type ChildProcess,
  type ChildProcessWithoutNullStreams,
  spawn as nodeSpawn,
} from "node:child_process"
import { homedir } from "node:os"
import { delimiter, join } from "node:path"
import * as acp from "@agentclientprotocol/sdk"
import type { AssistantAgent, AssistantErrorCode } from "@vibeshape/automation-api/assistant"

const closedChildren = new WeakSet<ChildProcess>()

export function killAssistantProcess(child: ChildProcess) {
  if (closedChildren.has(child)) return Promise.resolve()
  const kill = (signal: NodeJS.Signals) => {
    if (closedChildren.has(child)) return
    try {
      if (process.platform !== "win32" && child.pid) process.kill(-child.pid, signal)
      else child.kill(signal)
    } catch {
      child.kill(signal)
    }
  }
  return new Promise<void>((resolve) => {
    const finish = () => {
      clearTimeout(force)
      clearTimeout(deadline)
      child.removeListener("close", finish)
      resolve()
    }
    const force = setTimeout(() => kill("SIGKILL"), 500)
    const deadline = setTimeout(finish, 1500)
    child.once("close", finish)
    kill("SIGTERM")
  })
}

export function spawnAssistantProcess(
  options: {
    agent: AssistantAgent
    cwd: string
    env?: NodeJS.ProcessEnv
    spawn?: typeof nodeSpawn
  },
  onFailure: (code: AssistantErrorCode) => void,
) {
  const env = { ...(options.env ?? process.env) }
  delete env.ELECTRON_RUN_AS_NODE
  // Finder launches do not inherit the shell's local executable directories.
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
  const child = (options.spawn ?? nodeSpawn)(options.agent.command, options.agent.args, {
    cwd: options.cwd,
    env,
    shell: false,
    detached: process.platform !== "win32",
    stdio: ["pipe", "pipe", "pipe"],
  })
  child.stderr.resume()
  child.once("close", () => closedChildren.add(child))
  child.stdin.on("error", () => onFailure("agent-exited"))
  child.once("error", () => onFailure("launch-failed"))
  child.once("exit", () => onFailure("agent-exited"))
  return child
}

export function waitForAssistantSpawn(child: ChildProcessWithoutNullStreams) {
  return new Promise<void>((resolve, reject) => {
    child.once("spawn", resolve)
    child.once("error", reject)
  })
}

export function assistantConnectionFailure(reason: unknown): AssistantErrorCode {
  const malformed =
    reason instanceof acp.MessageTooLargeError ||
    reason instanceof TypeError ||
    reason instanceof SyntaxError ||
    reason instanceof acp.RequestError
  return malformed ? "protocol-error" : "agent-exited"
}
