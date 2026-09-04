import { describe, expect, it, vi } from "vitest"
import {
  type AuditAttemptResult,
  isTransientAuditFailure,
  runAuditProcess,
  runCriticalDependencyAudit,
} from "./run-critical-dependency-audit"

const result = (exitCode: number, stderr = "", timedOut = false): AuditAttemptResult => ({
  exitCode,
  stderr,
  stdout: "",
  timedOut,
})

describe("critical dependency audit", () => {
  it("retries transient registry failures and returns the successful attempt", async () => {
    const attempts = [result(1, "audit request failed (status 503)"), result(0)]
    const runAttempt = vi.fn(async () => attempts.shift() ?? result(1))
    const delay = vi.fn(async () => {})
    const report = vi.fn()

    const final = await runCriticalDependencyAudit({ delay, report, runAttempt })

    expect(final.exitCode).toBe(0)
    expect(runAttempt).toHaveBeenCalledTimes(2)
    expect(delay).toHaveBeenCalledTimes(1)
    expect(report).toHaveBeenCalledTimes(2)
  })

  it("does not retry a completed audit that found critical vulnerabilities", async () => {
    const runAttempt = vi.fn(async () => result(1, "critical: vulnerable-package"))
    const delay = vi.fn(async () => {})

    const final = await runCriticalDependencyAudit({ delay, report: vi.fn(), runAttempt })

    expect(final.exitCode).toBe(1)
    expect(runAttempt).toHaveBeenCalledTimes(1)
    expect(delay).not.toHaveBeenCalled()
  })

  it("fails after the bounded number of transient attempts", async () => {
    const runAttempt = vi.fn(async () => result(1, "ConnectionClosed: audit request failed"))

    const final = await runCriticalDependencyAudit({
      delay: async () => {},
      report: vi.fn(),
      runAttempt,
    })

    expect(final.exitCode).toBe(1)
    expect(runAttempt).toHaveBeenCalledTimes(2)
  })

  it("treats a killed timeout as transient without relying on output text", () => {
    expect(isTransientAuditFailure(result(137, "", true))).toBe(true)
  })

  it("distinguishes a completed nonzero subprocess from an actual timeout", async () => {
    const completed = await runAuditProcess(
      ["bun", "-e", "console.error('critical advisory'); process.exit(1)"],
      1_000,
    )
    const timedOut = await runAuditProcess(["bun", "-e", "await Bun.sleep(200)"], 10)

    expect(completed).toMatchObject({ exitCode: 1, timedOut: false })
    expect(completed.stderr).toContain("critical advisory")
    expect(timedOut.timedOut).toBe(true)
  })
})
