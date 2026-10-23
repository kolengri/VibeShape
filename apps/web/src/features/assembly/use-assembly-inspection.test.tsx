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
const pair = [{ leftInstanceId: id(2), rightInstanceId: id(3) }] as const
const clear: AssemblyInspection = {
  ...empty,
  interference: [{ ...pair[0], status: "clear", volume: 0, solidCount: 0 }],
}
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
    const old = deferred()
    ports.inspect
      .mockReturnValueOnce(old.promise)
      .mockResolvedValueOnce({ ok: true, inspection: clear })
    const hook = renderHook(({ value }) => useAssemblyInspection(value), {
      initialProps: { value: context },
    })
    const signal: AbortSignal = ports.inspect.mock.calls[0]?.[1]
    expect(signal.aborted).toBe(false)
    hook.rerender({ value: { ...context, revision: 8 } })
    expect(signal.aborted).toBe(true)
    expect(ports.inspect.mock.calls[1]?.[1].aborted).toBe(false)
    await waitFor(() => expect(hook.result.current.inspection).toBe(clear))
    await act(async () => {
      old.resolve({ ok: true, inspection: empty })
    })
    expect(hook.result.current.inspection).toBe(clear)
    expect(hook.result.current.pending).toBe(false)
    expect(hook.result.current.diagnostic).toBeNull()
  })
  it("locks pair requests against duplicate activation and releases the lock after rejection", async () => {
    const pending = deferred()
    const hook = renderHook(() => useAssemblyInspection(context))
    await waitFor(() => expect(hook.result.current.pending).toBe(false))
    ports.inspect.mockReturnValueOnce(pending.promise)
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
    expect(hook.result.current.inspection).toBe(empty)
    ports.inspect.mockResolvedValueOnce({
      ok: false,
      diagnostic: { message: "Exact pair inspection failed" },
    })
    await act(async () => {
      await hook.result.current.inspectPairs(pair)
    })
    expect(hook.result.current.diagnostic).toBe("Exact pair inspection failed")
    expect(hook.result.current.inspection).toBe(empty)
    expect(hook.result.current.pending).toBe(false)
    await act(async () => {
      await hook.result.current.inspectPairs(pair)
    })
    expect(hook.result.current.diagnostic).toBeNull()
    expect(ports.inspect).toHaveBeenCalledTimes(5)
  })
  it("does not request unavailable authority and rejects a late pair result after revision change", async () => {
    const pending = deferred()
    const latest = deferred()
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
      request = hook.result.current.inspectPairs(pair)
    })
    const oldSignal: AbortSignal = ports.inspect.mock.calls[1]?.[1]
    expect(oldSignal.aborted).toBe(false)
    hook.rerender({ value: { ...context, revision: 8 } })
    expect(oldSignal.aborted).toBe(true)
    await waitFor(() => expect(hook.result.current.pending).toBe(false))
    ports.inspect.mockReturnValueOnce(latest.promise)
    let latestRequest!: Promise<void>
    act(() => {
      latestRequest = hook.result.current.inspectPairs(pair)
    })
    expect(ports.inspect.mock.calls[3]?.[1].aborted).toBe(false)
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
    expect(hook.result.current.pending).toBe(true)
    await act(async () => {
      await hook.result.current.inspectPairs(pair)
    })
    expect(ports.inspect).toHaveBeenCalledTimes(4)
    await act(async () => {
      latest.resolve({ ok: true, inspection: clear })
      await latestRequest
    })
    expect(hook.result.current.inspection).toBe(clear)
    expect(hook.result.current.pending).toBe(false)
  })
  it.each(["initial", "pair"] as const)(
    "aborts an in-flight %s inspection on unmount",
    async (kind) => {
      const pending = deferred()
      if (kind === "initial") ports.inspect.mockReturnValueOnce(pending.promise)
      const hook = renderHook(() => useAssemblyInspection(context))
      let request: Promise<void> | undefined
      if (kind === "pair") {
        await waitFor(() => expect(hook.result.current.pending).toBe(false))
        ports.inspect.mockReturnValueOnce(pending.promise)
        act(() => {
          request = hook.result.current.inspectPairs(pair)
        })
      }
      const signal: AbortSignal = ports.inspect.mock.lastCall?.[1]
      expect(signal.aborted).toBe(false)
      const previous = hook.result.current
      hook.unmount()
      expect(signal.aborted).toBe(true)
      await act(async () => {
        pending.resolve({ ok: true, inspection: clear })
        await request
      })
      expect(hook.result.current).toBe(previous)
    },
  )
  it("suppresses abort rejections when authority becomes unavailable and ignores stale callbacks", async () => {
    ports.inspect.mockImplementationOnce(
      (_pairs: unknown, signal: AbortSignal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener(
            "abort",
            () => reject(new DOMException("Aborted", "AbortError")),
            {
              once: true,
            },
          )
        }),
    )
    const hook = renderHook(
      ({ value }: { value: AssemblyDocumentContext | null }) => useAssemblyInspection(value),
      { initialProps: { value: context as AssemblyDocumentContext | null } },
    )
    const inspectOldPairs = hook.result.current.inspectPairs
    hook.rerender({ value: null })
    await act(async () => {
      await inspectOldPairs(pair)
      await hook.result.current.inspectPairs(pair)
    })
    expect(ports.inspect).toHaveBeenCalledTimes(1)
    expect(hook.result.current.inspection).toBeNull()
    expect(hook.result.current.pending).toBe(false)
    expect(hook.result.current.diagnostic).toBeNull()
    hook.rerender({ value: { ...context, revision: 8 } })
    await waitFor(() => expect(hook.result.current.pending).toBe(false))
    await act(async () => {
      await inspectOldPairs(pair)
    })
    expect(ports.inspect).toHaveBeenCalledTimes(2)
  })
  it("does not let a late initial inspection replace a completed pair inspection", async () => {
    const initial = deferred()
    ports.inspect.mockReturnValueOnce(initial.promise)
    const hook = renderHook(() => useAssemblyInspection(context))
    ports.inspect.mockResolvedValueOnce({ ok: true, inspection: clear })
    await act(async () => {
      await hook.result.current.inspectPairs(pair)
    })
    expect(hook.result.current.inspection).toBe(clear)
    await act(async () => {
      initial.resolve({ ok: true, inspection: empty })
    })
    expect(hook.result.current.inspection).toBe(clear)
    expect(hook.result.current.pending).toBe(false)
  })
})
