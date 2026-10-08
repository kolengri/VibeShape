import "../../../../../tests/unit/support/dom"
import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test"
import type { AssemblyInspection } from "@vibeshape/protocol"
import { vi } from "../../../../../tests/unit/support/bun-test"

import type { AssemblyDocumentContext } from "./assembly-model"

const ports = (() => ({ inspect: vi.fn() }))()
mock.module("../../document/document-controller", () => ({ inspectActiveAssembly: ports.inspect }))

const { act, cleanup, renderHook, waitFor } = await import("@testing-library/react")
const { authoredTestId: id } = await import("../../test-support/authored-tree-fixture")
const { useAssemblyInspection } = await import("./use-assembly-inspection")
const context: AssemblyDocumentContext = { documentId: id(1), revision: 7, authorityVersion: 4 }
const empty: AssemblyInspection = { occurrences: [], interference: [] }
function deferred() {
  let resolve!: (result: { ok: true; inspection: AssemblyInspection }) => void
  const promise = new Promise<{ ok: true; inspection: AssemblyInspection }>((finish) => {
    resolve = finish
  })
  return { promise, resolve }
}
beforeEach(() => {
  ports.inspect.mockReset()
  ports.inspect.mockResolvedValue({ ok: true, inspection: empty })
})
afterEach(cleanup)
describe("Assembly inspection revision isolation", () => {
  it("discards late geometry from a previous document revision", async () => {
    const old = deferred(),
      latest = {
        ...empty,
        interference: [
          {
            leftInstanceId: id(2),
            rightInstanceId: id(3),
            status: "clear" as const,
            volume: 0,
            solidCount: 0,
          },
        ],
      }
    ports.inspect
      .mockReturnValueOnce(old.promise)
      .mockResolvedValueOnce({ ok: true, inspection: latest })
    const hook = renderHook(({ value }) => useAssemblyInspection(value), {
      initialProps: { value: context },
    })
    hook.rerender({ value: { ...context, revision: 8 } })
    await waitFor(() => expect(hook.result.current.inspection).toBe(latest))
    await act(async () => {
      old.resolve({ ok: true, inspection: empty })
    })
    expect(hook.result.current.inspection).toBe(latest)
    expect(hook.result.current.pending).toBe(false)
  })
  it("locks pair requests against duplicate activation and releases the lock after rejection", async () => {
    const pending = deferred()
    const hook = renderHook(() => useAssemblyInspection(context))
    await waitFor(() => expect(hook.result.current.pending).toBe(false))
    ports.inspect.mockReturnValueOnce(pending.promise)
    const pair = [{ leftInstanceId: id(2), rightInstanceId: id(3) }]
    let request!: Promise<void>
    act(() => {
      request = hook.result.current.inspectPairs(pair)
      void hook.result.current.inspectPairs(pair)
    })
    expect(ports.inspect).toHaveBeenCalledTimes(2)
    expect(hook.result.current.pending).toBe(true)
    await act(async () => {
      pending.resolve({ ok: true, inspection: empty })
      await request
    })
    ports.inspect.mockRejectedValueOnce(new Error("Worker stopped"))
    await act(async () => {
      await hook.result.current.inspectPairs(pair)
    })
    expect(hook.result.current.pending).toBe(false)
    expect(hook.result.current.diagnostic).toBe("inspection-failed")
    await act(async () => {
      await hook.result.current.inspectPairs(pair)
    })
    expect(hook.result.current.diagnostic).toBeNull()
    expect(ports.inspect).toHaveBeenCalledTimes(4)
  })
  it("does not request unavailable authority and rejects a late pair result after revision change", async () => {
    const pending = deferred()
    const hook = renderHook(
      ({ value }: { value: AssemblyDocumentContext | null }) => useAssemblyInspection(value),
      { initialProps: { value: null as AssemblyDocumentContext | null } },
    )
    expect(ports.inspect).not.toHaveBeenCalled()
    hook.rerender({ value: context })
    await waitFor(() => expect(hook.result.current.pending).toBe(false))
    ports.inspect.mockReturnValueOnce(pending.promise)
    let request!: Promise<void>
    act(() => {
      request = hook.result.current.inspectPairs([
        { leftInstanceId: id(2), rightInstanceId: id(3) },
      ])
    })
    hook.rerender({ value: { ...context, revision: 8 } })
    await waitFor(() => expect(hook.result.current.pending).toBe(false))
    await act(async () => {
      pending.resolve({
        ok: true,
        inspection: {
          ...empty,
          interference: [
            {
              leftInstanceId: id(2),
              rightInstanceId: id(3),
              status: "interference",
              volume: 12,
              solidCount: 1,
            },
          ],
        },
      })
      await request
    })
    expect(hook.result.current.inspection?.interference).toEqual([])
  })
})
