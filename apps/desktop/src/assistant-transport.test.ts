import { describe, expect, it } from "bun:test"
import { ChildProcess } from "node:child_process"
import { once } from "node:events"
import { vi } from "../../../tests/unit/support/bun-test"
import { killAssistantProcess, spawnAssistantProcess } from "./assistant-transport"

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
