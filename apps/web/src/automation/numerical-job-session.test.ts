import { afterEach, describe, expect, it } from "bun:test"
import { localFailure } from "@vibeshape/automation-api/local-tools"
import type { NumericalOperation } from "@vibeshape/automation-api/numerical-jobs"
import { commandActorSchema } from "@vibeshape/domain/commands"
import {
  lightweightingId as id,
  lightweightingIdentity,
  lightweightingOperation,
  lightweightingSummary,
} from "../../../../packages/automation-api/src/lightweighting.test-fixtures"
import {
  quickLightweightingOperation,
  quickLightweightingValue,
} from "../../../../packages/automation-api/src/quick-lightweighting.test-fixtures"
import { vi } from "../../../../tests/unit/support/bun-test"
import { createNumericalJobSession } from "./numerical-job-session"

const actor = commandActorSchema.parse({
  type: "mcp",
  clientId: "org.example.numerical-jobs",
  sessionId: id(8),
})
const other = commandActorSchema.parse({ ...actor, sessionId: id(9) })

function setup() {
  let release = (_result: unknown) => {}
  let signal: AbortSignal | undefined
  let calls = 0
  let sequence = 100
  let available = true
  const pending = new Promise<unknown>((resolve) => {
    release = resolve
  })
  const jobs = createNumericalJobSession({
    documentId: id(3),
    createId: () => id(sequence++),
    isActive: () => available,
    execute: async (_actor, _operation, cancellation) => {
      calls++
      signal = cancellation
      return pending
    },
  })
  return {
    jobs,
    release,
    pending,
    signal: () => signal,
    calls: () => calls,
    deactivate: () => {
      available = false
    },
  }
}

function started(
  test: ReturnType<typeof setup>,
  operation: NumericalOperation = quickLightweightingOperation(),
) {
  const result = test.jobs.start(actor, operation)
  if (!result.ok) throw new Error(result.diagnostic.message)
  return result.value
}

async function settle(test: ReturnType<typeof setup>, result: unknown) {
  test.release(result)
  await test.pending
  await Promise.resolve()
  await Promise.resolve()
}

afterEach(() => vi.useRealTimers())

describe("browser-owned numerical jobs", () => {
  it("returns before computation and retains a result after more than ten minutes", async () => {
    vi.useFakeTimers()
    const test = setup()
    const receipt = started(test)
    expect(receipt).toMatchObject({ status: "running", tool: "analyze_quick_lightweighting" })
    await vi.advanceTimersByTimeAsync(60 * 60_000)
    expect(test.signal()?.aborted).toBe(false)
    expect(test.jobs.read(actor, receipt.jobId)).toMatchObject({
      ok: true,
      value: { status: "running", result: null },
    })
    await settle(test, { ok: true, value: quickLightweightingValue() })
    await vi.advanceTimersByTimeAsync(24 * 60 * 60_000)
    expect(test.jobs.read(actor, receipt.jobId)).toMatchObject({
      ok: true,
      value: { status: "completed", result: { ok: true, value: quickLightweightingValue() } },
    })
    test.jobs.dispose()
  })

  it("coalesces an active retry and serializes different numerical requests", () => {
    const test = setup()
    const first = started(test)
    expect(started(test)).toEqual(first)
    expect(test.calls()).toBe(1)
    expect(test.jobs.start(actor, lightweightingOperation())).toMatchObject({
      ok: false,
      diagnostic: { code: "busy" },
    })
    test.jobs.dispose()
  })

  it("does not let a different actor read, cancel, or deduplicate an owned job", () => {
    const test = setup()
    const job = started(test)
    for (const result of [
      test.jobs.read(other, job.jobId),
      test.jobs.read(other, job.jobId, true),
      test.jobs.start(other, quickLightweightingOperation()),
    ])
      expect(result).toMatchObject({
        ok: false,
        diagnostic: { code: "numerical-job-owner-mismatch" },
      })
    expect(test.signal()?.aborted).toBe(false)
    test.jobs.dispose()
  })

  it("keeps cancellation pending until the actual persistence outcome is known", async () => {
    const test = setup()
    const job = started(test, quickLightweightingOperation(true))
    expect(test.jobs.read(actor, job.jobId, true)).toMatchObject({
      ok: true,
      value: { status: "cancelling", result: null },
    })
    expect(test.signal()?.aborted).toBe(true)
    expect(test.jobs.start(actor, lightweightingOperation())).toMatchObject({ ok: false })
    // A transaction already accepted by persistence must report success, even after Stop.
    await settle(test, { ok: true, value: quickLightweightingValue(true) })
    expect(test.jobs.read(actor, job.jobId)).toMatchObject({
      ok: true,
      value: { status: "completed", result: { ok: true, value: { snapshot: { revision: 5 } } } },
    })
    test.jobs.dispose()
  })

  it("retains physical infeasibility as the final result and permits another job", async () => {
    const test = setup()
    const job = started(test, lightweightingOperation())
    const failure = localFailure("infeasible-baseline", "The baseline violates constraints.", true)
    await settle(test, failure)
    expect(test.jobs.read(actor, job.jobId)).toMatchObject({
      ok: true,
      value: { status: "completed", result: failure },
    })
    const next = started(test)
    expect(next.jobId).not.toBe(job.jobId)
    expect(test.jobs.read(actor, job.jobId)).toMatchObject({ value: { result: failure } })
    test.jobs.dispose()
  })

  it("revokes running and retained jobs when their session closes", async () => {
    const test = setup()
    const job = started(test)
    test.jobs.dispose()
    expect(test.signal()?.aborted).toBe(true)
    await settle(test, { ok: true, value: quickLightweightingValue() })
    expect(test.jobs.read(actor, job.jobId)).toMatchObject({
      ok: false,
      diagnostic: { code: "session-revoked" },
    })
    expect(test.jobs.start(actor, quickLightweightingOperation()).ok).toBe(false)
  })

  it("does not expose completed results after the project owner is replaced", async () => {
    const test = setup()
    const job = started(test)
    await settle(test, { ok: true, value: quickLightweightingValue() })
    test.deactivate()
    expect(test.jobs.read(actor, job.jobId)).toMatchObject({
      ok: false,
      diagnostic: { code: "session-revoked" },
    })
    test.jobs.dispose()
  })

  for (const operation of [lightweightingOperation(), quickLightweightingOperation()])
    it(`rejects mismatched evidence from ${operation.tool}`, async () => {
      const test = setup()
      const job = test.jobs.start(actor, operation as NumericalOperation)
      if (!job.ok) throw new Error(job.diagnostic.message)
      const value =
        operation.tool === "analyze_lightweighting"
          ? {
              documentId: id(3),
              baseRevision: 4,
              source: lightweightingIdentity,
              summary: lightweightingSummary(),
            }
          : quickLightweightingValue()
      await settle(test, { ok: true, value: { ...value, baseRevision: 99 } })
      expect(test.jobs.read(actor, job.value.jobId)).toMatchObject({
        ok: true,
        value: {
          status: "completed",
          result: { ok: false, diagnostic: { code: "invalid-result" } },
        },
      })
      test.jobs.dispose()
    })
})
