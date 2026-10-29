import { describe, expect, it } from "bun:test"
import { localFailure } from "@vibeshape/automation-api/local-tools"
import { commandActorSchema } from "@vibeshape/domain/commands"
import { vi } from "../../../tests/unit/support/bun-test"
import {
  lightweightingId,
  lightweightingIdentity,
  lightweightingSnapshot,
} from "../../automation-api/src/lightweighting.test-fixtures"
import {
  printOptimizationOperation,
  printOptimizationSummary,
} from "../../automation-api/src/print-optimization.test-fixtures"
import { createPrintOptimizationProposalCoordinator } from "./print-optimization-proposal"

const actor = commandActorSchema.parse({
  type: "mcp",
  clientId: "org.example.print",
  sessionId: lightweightingId(9),
})
function setup() {
  let source = { documentId: lightweightingId(3), revision: 4, identity: lightweightingIdentity }
  const optimize = vi.fn(
    async (
      _source: typeof source,
      _settings: unknown,
      _signal: Readonly<{ aborted: boolean }>,
    ) => ({ summary: printOptimizationSummary(), payload: { privateStep: "exact-solid" } }),
  )
  const requestSnapshot = vi.fn(
    async (
      ..._args: unknown[]
    ): Promise<
      | { ok: true; value: ReturnType<typeof lightweightingSnapshot> }
      | ReturnType<typeof localFailure>
    > => ({ ok: true, value: lightweightingSnapshot() }),
  )
  const cancelSnapshot = vi.fn()
  const coordinator = createPrintOptimizationProposalCoordinator({
    documentId: source.documentId,
    isActive: () => true,
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
    changeBody() {
      source = { ...source, identity: { ...source.identity, contentHash: "b".repeat(64) } }
    },
  }
}

describe("exact print source-bound proposal coordinator", () => {
  it("computes exact evidence privately and imports only an improved requested snapshot", async () => {
    const test = setup()
    const analyzed = await test.coordinator.execute(actor, printOptimizationOperation())
    expect(analyzed).toMatchObject({
      ok: true,
      value: { summary: { exact: { preservedFaceCount: 1 } } },
    })
    expect(JSON.stringify(analyzed)).not.toContain("privateStep")
    expect(test.requestSnapshot).not.toHaveBeenCalled()
    expect(await test.coordinator.execute(actor, printOptimizationOperation(true))).toMatchObject({
      ok: true,
      value: { snapshot: { revision: 5 } },
    })
    expect(test.requestSnapshot).toHaveBeenCalledTimes(1)
    expect(test.requestSnapshot.mock.calls[0]?.[4]).toEqual({ privateStep: "exact-solid" })
  })
  it("returns no-improvement without review or mutation", async () => {
    const test = setup()
    test.optimize.mockResolvedValueOnce({
      summary: printOptimizationSummary(false),
      payload: { privateStep: "unused" },
    })
    expect(await test.coordinator.execute(actor, printOptimizationOperation(true))).toMatchObject({
      ok: true,
      value: { summary: { exact: null }, snapshot: null },
    })
    expect(test.requestSnapshot).not.toHaveBeenCalled()
  })
  it("rejects mismatched material or exact evidence before review", async () => {
    const test = setup()
    const summary = printOptimizationSummary()
    summary.configuration.material.youngModulusMpa += 1
    test.optimize.mockResolvedValueOnce({ summary, payload: { privateStep: "forged" } })
    expect(await test.coordinator.execute(actor, printOptimizationOperation(true))).toMatchObject({
      ok: false,
      diagnostic: { code: "invalid-result" },
    })
    expect(test.requestSnapshot).not.toHaveBeenCalled()
  })
  it.each(["cancel", "changeBody"] as const)(
    "discards an exact reconstruction after %s",
    async (event) => {
      const test = setup()
      let finish = () => {}
      test.optimize.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = () =>
              resolve({
                summary: printOptimizationSummary(),
                payload: { privateStep: "cancelled" },
              })
          }),
      )
      const pending = test.coordinator.execute(actor, printOptimizationOperation(true))
      if (event === "cancel") test.coordinator.cancel()
      else test.changeBody()
      finish()
      expect(await pending).toMatchObject({ ok: false, diagnostic: { code: "stale-revision" } })
      expect(test.requestSnapshot).not.toHaveBeenCalled()
    },
  )
  it("releases its lock after rejected review and enforces paired ownership", async () => {
    const test = setup()
    test.requestSnapshot.mockResolvedValueOnce(localFailure("import-review-cancelled", "Rejected."))
    expect(await test.coordinator.execute(actor, printOptimizationOperation(true))).toMatchObject({
      ok: false,
      diagnostic: { code: "import-review-cancelled" },
    })
    expect(await test.coordinator.execute(actor, printOptimizationOperation())).toMatchObject({
      ok: true,
    })
    expect(
      await test.coordinator.execute(
        { ...actor, clientId: "org.example.other" },
        printOptimizationOperation(),
      ),
    ).toMatchObject({ ok: false, diagnostic: { code: "lightweighting-owner-mismatch" } })
  })
})
