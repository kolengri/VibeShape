// @vitest-environment node

import { localFailure } from "@vibeshape/automation-api/local-tools"
import { commandActorSchema } from "@vibeshape/domain/commands"
import { describe, expect, it, vi } from "vitest"
import {
  lightweightingId,
  lightweightingIdentity,
  lightweightingSnapshot,
} from "../../automation-api/src/lightweighting.test-fixtures"
import {
  quickLightweightingOperation as lightweightingOperation,
  quickLightweightingSummary as lightweightingSummary,
} from "../../automation-api/src/quick-lightweighting.test-fixtures"
import { createQuickLightweightingProposalCoordinator } from "./quick-lightweighting-proposal"

const actor = commandActorSchema.parse({
  type: "mcp",
  clientId: "org.example.analysis",
  sessionId: lightweightingId(9),
})
function setup() {
  let source = { documentId: lightweightingId(3), revision: 4, identity: lightweightingIdentity }
  let active = true
  const optimize = vi.fn(
    async (
      _source: typeof source,
      _settings: unknown,
      _signal: Readonly<{ aborted: boolean }>,
    ) => ({ summary: lightweightingSummary(), payload: { privateMesh: true } }),
  )
  const requestSnapshot = vi.fn(
    async (
      ..._args: unknown[]
    ): Promise<
      | { ok: true; value: ReturnType<typeof lightweightingSnapshot> }
      | ReturnType<typeof localFailure>
    > => ({ ok: true as const, value: lightweightingSnapshot() }),
  )
  const cancelSnapshot = vi.fn()
  const coordinator = createQuickLightweightingProposalCoordinator({
    documentId: source.documentId,
    isActive: () => active,
    readSource: () => source,
    optimize,
    requestSnapshot,
    cancelSnapshot,
    createCancellation() {
      const signal = { aborted: false }
      return {
        signal,
        abort() {
          signal.aborted = true
        },
      }
    },
  })
  return {
    coordinator,
    optimize,
    requestSnapshot,
    cancelSnapshot,
    stale() {
      source = { ...source, revision: 5 }
    },
    changeBody() {
      source = { ...source, identity: { ...source.identity, contentHash: "b".repeat(64) } }
    },
    revoke() {
      active = false
    },
  }
}
describe("owned lightweighting computation and snapshot proposal", () => {
  it("returns compute-only evidence without a mutation or mesh transport", async () => {
    const test = setup()
    const result = await test.coordinator.execute(actor, lightweightingOperation())
    expect(result).toMatchObject({
      ok: true,
      value: { baseRevision: 4, summary: { removedPercent: 100 / 3 } },
    })
    expect(JSON.stringify(result)).not.toContain("privateMesh")
    expect(test.requestSnapshot).not.toHaveBeenCalled()
  })
  it("rejects an already cancelled request before starting computation", async () => {
    const test = setup()
    expect(
      await test.coordinator.execute(actor, lightweightingOperation(), { aborted: true }),
    ).toMatchObject({ ok: false, diagnostic: { code: "request-cancelled" } })
    expect(test.optimize).not.toHaveBeenCalled()
  })
  it("keeps one computation single-flight while rejecting other callers", async () => {
    const test = setup()
    let finish = () => {}
    test.optimize.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = () =>
            resolve({ summary: lightweightingSummary(), payload: { privateMesh: true } })
        }),
    )
    const pending = test.coordinator.execute(actor, lightweightingOperation())
    expect(await test.coordinator.execute(actor, lightweightingOperation())).toMatchObject({
      ok: false,
      diagnostic: { code: "lightweighting-busy" },
    })
    expect(
      await test.coordinator.execute(
        { ...actor, clientId: "org.example.other" },
        lightweightingOperation(),
      ),
    ).toMatchObject({ ok: false, diagnostic: { code: "lightweighting-owner-mismatch" } })
    finish()
    expect(await pending).toMatchObject({ ok: true })
    expect(test.optimize).toHaveBeenCalledTimes(1)
  })
  it("rejects a different actor and exact source identity before computing", async () => {
    const test = setup()
    await test.coordinator.execute(actor, lightweightingOperation())
    expect(
      await test.coordinator.execute(
        { ...actor, sessionId: lightweightingId(10) },
        lightweightingOperation(),
      ),
    ).toMatchObject({ ok: false, diagnostic: { code: "lightweighting-owner-mismatch" } })
    test.changeBody()
    expect(await test.coordinator.execute(actor, lightweightingOperation())).toMatchObject({
      ok: false,
      diagnostic: { code: "stale-revision" },
    })
    expect(test.optimize).toHaveBeenCalledTimes(1)
  })
  it.each(["stale", "changeBody", "revoke", "cancel"] as const)(
    "discards a pending result after %s",
    async (event) => {
      const test = setup()
      let finish = () => {}
      test.optimize.mockImplementationOnce(
        (_source, _settings, signal) =>
          new Promise((resolve) => {
            finish = () =>
              resolve({ summary: lightweightingSummary(), payload: { privateMesh: true } })
            expect(signal.aborted).toBe(false)
          }),
      )
      const pending = test.coordinator.execute(actor, lightweightingOperation(true))
      if (event === "cancel") test.coordinator.cancel()
      else test[event]()
      finish()
      expect(await pending).toMatchObject({ ok: false })
      expect(test.requestSnapshot).not.toHaveBeenCalled()
    },
  )
  it("passes only captured feasible evidence to one reviewed snapshot request", async () => {
    const test = setup()
    expect(await test.coordinator.execute(actor, lightweightingOperation(true))).toMatchObject({
      ok: true,
      value: { snapshot: { revision: 5 } },
    })
    expect(test.requestSnapshot).toHaveBeenCalledTimes(1)
    expect(test.requestSnapshot.mock.calls[0]?.[0]).toEqual(actor)
  })
  it("rejects inconsistent measured volumes without requesting browser Apply", async () => {
    const test = setup()
    const summary = lightweightingSummary()
    summary.removedPercent = 99
    test.optimize.mockResolvedValueOnce({ summary, payload: { privateMesh: true } })
    expect(await test.coordinator.execute(actor, lightweightingOperation(true))).toMatchObject({
      ok: false,
      diagnostic: { code: "invalid-result" },
    })
    expect(test.requestSnapshot).not.toHaveBeenCalled()
  })
  it("propagates browser rejection and releases the operation lock", async () => {
    const test = setup()
    test.requestSnapshot.mockResolvedValueOnce(localFailure("import-review-cancelled", "Rejected."))
    expect(await test.coordinator.execute(actor, lightweightingOperation(true))).toMatchObject({
      ok: false,
      diagnostic: { code: "import-review-cancelled" },
    })
    expect(await test.coordinator.execute(actor, lightweightingOperation())).toMatchObject({
      ok: true,
    })
  })
})
