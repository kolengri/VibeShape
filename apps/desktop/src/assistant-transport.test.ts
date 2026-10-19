import { afterEach, describe, expect, it } from "bun:test"
import { ChildProcess } from "node:child_process"
import { once } from "node:events"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { vi } from "../../../tests/unit/support/bun-test"
import { killAssistantProcess, spawnAssistantProcess } from "./assistant-transport"

const directories: string[] = []
afterEach(async () => {
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

describe.skipIf(process.platform !== "darwin")("assistant executable discovery", () => {
  async function installedAdapter() {
    const home = await mkdtemp(join(tmpdir(), "vibeshape-agent-path-"))
    directories.push(home)
    const directory = join(home, ".local", "bin")
    await mkdir(directory, { recursive: true })
    const executable = join(directory, "codex-acp")
    await writeFile(executable, '#!/bin/sh\nprintf "%s\\n" "$1"\n', { mode: 0o700 })
    return { home, executable }
  }
  async function output(command: string, env: NodeJS.ProcessEnv) {
    const failures: string[] = []
    const child = spawnAssistantProcess(
      { cwd: env.HOME ?? tmpdir(), env, agent: { command, args: ["literal spaces; $(exit 42)"] } },
      (code) => failures.push(code),
    )
    const chunks: Buffer[] = []
    child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk))
    const [exitCode] = await once(child, "close")
    expect(exitCode).toBe(0)
    expect(failures).not.toContain("launch-failed")
    return Buffer.concat(chunks).toString().trim()
  }

  it("finds a local ACP adapter from a Finder environment without a shell", async () => {
    const { home } = await installedAdapter()
    const env = { HOME: home, PATH: "/usr/bin:/bin:/usr/sbin:/sbin", ELECTRON_RUN_AS_NODE: "1" }
    expect(await output("codex-acp", env)).toBe("literal spaces; $(exit 42)")
    expect(env.PATH).toBe("/usr/bin:/bin:/usr/sbin:/sbin")
    expect(env.ELECTRON_RUN_AS_NODE).toBe("1")
  })

  it("keeps inherited command precedence and respects an absolute custom executable", async () => {
    const { home, executable } = await installedAdapter()
    const preferred = join(home, "preferred")
    await mkdir(preferred)
    await writeFile(join(preferred, "codex-acp"), '#!/bin/sh\nprintf "preferred\\n"\n', {
      mode: 0o700,
    })
    const env = { HOME: home, PATH: `${preferred}:/usr/bin:/bin` }
    expect(await output("codex-acp", env)).toBe("preferred")
    expect(await output(executable, env)).toBe("literal spaces; $(exit 42)")
  })
})

describe("assistant process shutdown", () => {
  it("does not signal an already closed child or leave an escalation timer", async () => {
    const child = spawnAssistantProcess(
      { cwd: process.cwd(), agent: { command: "node", args: ["-e", "process.exit(0)"] } },
      () => {},
    )
    await new Promise<void>((resolve) => child.once("close", () => resolve()))
    vi.useFakeTimers()
    try {
      const kill = vi.spyOn(child, "kill")
      await killAssistantProcess(child)
      vi.advanceTimersByTime(2000)
      expect(kill).not.toHaveBeenCalled()
      expect(child.listenerCount("close")).toBe(0)
    } finally {
      vi.restoreAllMocks()
      vi.useRealTimers()
    }
  })

  it("accepts an already closed failed spawn without trying to signal it", async () => {
    const child = spawnAssistantProcess(
      {
        cwd: process.cwd(),
        agent: { command: "/missing/vibeshape-assistant-fixture", args: [] },
      },
      () => {},
    )
    await new Promise<void>((resolve) => child.once("close", () => resolve()))
    const kill = vi.spyOn(child, "kill")
    try {
      await killAssistantProcess(child)
      expect(kill).not.toHaveBeenCalled()
      expect(child.listenerCount("close")).toBe(0)
    } finally {
      kill.mockRestore()
    }
  })

  it("clears the force-kill timer and listener when the owned child closes", async () => {
    vi.useFakeTimers()
    try {
      const child = new ChildProcess()
      const signals: (NodeJS.Signals | number | undefined)[] = []
      child.kill = (signal) => {
        signals.push(signal)
        return true
      }
      const stopped = killAssistantProcess(child)
      expect(signals).toEqual(["SIGTERM"])
      child.emit("close", 0, null)
      await stopped
      vi.advanceTimersByTime(2000)
      expect(signals).toEqual(["SIGTERM"])
      expect(child.listenerCount("close")).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it("bounds a missing close event after escalation and removes its listener", async () => {
    vi.useFakeTimers()
    try {
      const child = new ChildProcess()
      const signals: (NodeJS.Signals | number | undefined)[] = []
      child.kill = (signal) => {
        signals.push(signal)
        return true
      }
      const stopped = killAssistantProcess(child)
      vi.advanceTimersByTime(1500)
      await stopped
      expect(signals).toEqual(["SIGTERM", "SIGKILL"])
      expect(child.listenerCount("close")).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it("force-kills an owned process that ignores TERM and waits for its closed pipes", async () => {
    const child = spawnAssistantProcess(
      {
        cwd: process.cwd(),
        agent: {
          command: "node",
          args: [
            "-e",
            "process.on('SIGTERM',()=>{});process.stdout.write('ready');setInterval(()=>{},1000)",
          ],
        },
      },
      () => {},
    )
    await once(child.stdout, "data")
    const exited = once(child, "exit")
    try {
      await killAssistantProcess(child)
      expect(await exited).toEqual([null, "SIGKILL"])
      expect(child.stdout.destroyed).toBe(true)
    } finally {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL")
    }
  })

  it.skipIf(process.platform === "win32")(
    "cleans the owned group after its parent exits while a descendant holds its pipes",
    async () => {
      const child = spawnAssistantProcess(
        {
          cwd: process.cwd(),
          agent: {
            command: "node",
            args: [
              "-e",
              `
          require("node:child_process").spawn(process.execPath, ["-e",
            "process.on('SIGTERM',()=>{});process.stdout.write('ready');setInterval(()=>{},1000)"
          ], {stdio:['ignore','inherit','inherit']});
          process.exit(0);
        `,
            ],
          },
        },
        () => {},
      )
      const exited = once(child, "exit")
      await once(child.stdout, "data")
      expect(await exited).toEqual([0, null])
      expect(child.stdout.destroyed).toBe(false)
      try {
        await killAssistantProcess(child)
        expect(child.stdout.destroyed).toBe(true)
      } finally {
        if (!child.stdout.destroyed && child.pid) {
          try {
            process.kill(-child.pid, "SIGKILL")
          } catch {}
        }
      }
    },
  )
})
