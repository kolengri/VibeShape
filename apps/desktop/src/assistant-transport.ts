import { type ChildProcessWithoutNullStreams, spawn as nodeSpawn } from "node:child_process"
import * as acp from "@agentclientprotocol/sdk"
import type { AssistantAgent, AssistantErrorCode } from "@vibeshape/automation-api/assistant"

export function killAssistantProcess(child: ChildProcessWithoutNullStreams) {
  const kill = (signal: NodeJS.Signals) => {
    try {
      if (process.platform !== "win32" && child.pid) process.kill(-child.pid, signal)
      else child.kill(signal)
    } catch {
      child.kill(signal)
    }
  }
  kill("SIGTERM")
  setTimeout(() => kill("SIGKILL"), 500).unref()
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
  const child = (options.spawn ?? nodeSpawn)(options.agent.command, options.agent.args, {
    cwd: options.cwd,
    env,
    shell: false,
    detached: process.platform !== "win32",
    stdio: ["pipe", "pipe", "pipe"],
  })
  child.stderr.resume()
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
