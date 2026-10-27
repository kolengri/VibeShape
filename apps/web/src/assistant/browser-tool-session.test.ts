import { describe, expect, it, mock } from "bun:test"
import { localFailure } from "@vibeshape/automation-api/local-tools"
import {
  quickLightweightingOperation,
  quickLightweightingValue,
} from "../../../../packages/automation-api/src/quick-lightweighting.test-fixtures"
import { vi } from "../../../../tests/unit/support/bun-test"

const getProjectRuntime = vi.fn()
mock.module("../document/document-controller", () => ({ getProjectRuntime }))
const { createBrowserToolSession } = await import("./browser-tool-session")
const projectId = "0195b5ac-b250-7a2c-8c33-000000000101"

function fixture() {
  let resolve: (value: unknown) => void = () => {}
  const result = new Promise<unknown>((complete) => {
    resolve = complete
  })
  const execute = vi.fn(async (_actor: unknown, _operation: unknown, signal?: AbortSignal) => {
    signal?.addEventListener(
      "abort",
      () => resolve(localFailure("request-cancelled", "Cancelled.")),
      { once: true },
    )
    return result
  })
  const cancel = vi.fn(() => resolve(localFailure("request-cancelled", "Cancelled.")))
  const dispose = vi.fn(cancel)
  const start = vi.fn(() => {
    throw new Error("Browser API tools must await inline numerical computation.")
  })
  const runtime = {
    createActiveDocumentAutomationSession: vi.fn(() => ({
      ok: true,
      documentId: projectId,
      revision: 4,
      host: {},
      readCad: vi.fn(),
      readInfo: () => null,
      readIdentity: () => ({ id: projectId, name: "Bracket", revision: 4 }),
      exportRevisionBound: vi.fn(),
      quickLightweighting: { execute, cancel, dispose },
      numericalJobs: { start, read: vi.fn(), dispose: vi.fn() },
      dispose,
    })),
  }
  getProjectRuntime.mockReturnValue(runtime)
  return { execute, dispose, start, resolve }
}

describe("browser API numerical session", () => {
  it("awaits the original numerical coordinator and returns its final result without starting a job", async () => {
    const state = fixture()
    const tools = createBrowserToolSession(projectId)
    const abort = new AbortController()
    const operation = quickLightweightingOperation(true)
    const pending = tools.execute(
      "call_cad_tool",
      { name: operation.tool, arguments: operation.arguments },
      abort.signal,
    )
    expect(state.execute).toHaveBeenCalledTimes(1)
    expect(state.execute.mock.calls[0]?.[1]).toEqual(operation)
    expect(state.execute.mock.calls[0]?.[2]).toBe(abort.signal)
    expect(state.start).not.toHaveBeenCalled()
    const original = quickLightweightingValue(true)
    const value = {
      ...original,
      documentId: projectId,
      snapshot: { ...original.snapshot, documentId: projectId },
    }
    state.resolve({ ok: true, value })
    expect(await pending).toEqual({ ok: true, value })
    expect(state.dispose).not.toHaveBeenCalled()
    tools.dispose()
    tools.dispose()
    expect(state.dispose).toHaveBeenCalledTimes(1)
    expect(tools.isActive()).toBe(false)
  })

  it.each(["abort", "dispose"] as const)(
    "preserves inline numerical cancellation on %s",
    async (end) => {
      const state = fixture()
      const tools = createBrowserToolSession(projectId)
      const abort = new AbortController()
      const operation = quickLightweightingOperation()
      const pending = tools.execute(
        "call_cad_tool",
        { name: operation.tool, arguments: operation.arguments },
        abort.signal,
      )
      expect(state.execute).toHaveBeenCalledTimes(1)
      if (end === "abort") abort.abort()
      else tools.dispose()
      if (end === "abort") await expect(pending).rejects.toBe(abort.signal.reason)
      else await expect(pending).rejects.toMatchObject({ code: "stale-project" })
      expect(state.start).not.toHaveBeenCalled()
      tools.dispose()
      expect(state.dispose).toHaveBeenCalledTimes(1)
    },
  )
})
