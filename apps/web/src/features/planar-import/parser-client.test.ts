import { afterEach, expect, it } from "bun:test"
import { vi } from "../../../../../tests/unit/support/bun-test"
import { inspectPlanarSource } from "./parser-client"

afterEach(() => vi.useRealTimers())
function port() {
  return {
    terminate: vi.fn(),
    postMessage: vi.fn(),
    onmessage: null as Worker["onmessage"],
    onerror: null as Worker["onerror"],
  }
}
it("copies transferred source bytes and terminates the parser on cancel or malformed output", async () => {
  const worker = port(),
    abort = new AbortController(),
    bytes = new Uint8Array([1, 2, 3])
  const pending = inspectPlanarSource(
    { format: "svg", bytes, units: "mm" },
    abort.signal,
    () => worker as unknown as Worker,
  )
  const sent = worker.postMessage.mock.calls[0]?.[0]
  expect(sent.input.bytes).not.toBe(bytes)
  expect(Array.from(bytes)).toEqual([1, 2, 3])
  abort.abort()
  await expect(pending).rejects.toMatchObject({ name: "AbortError" })
  expect(worker.terminate).toHaveBeenCalledTimes(1)
  const second = port()
  const bad = inspectPlanarSource(
    { format: "dxf", bytes },
    new AbortController().signal,
    () => second as unknown as Worker,
  )
  second.onmessage?.call(
    second as unknown as Worker,
    new MessageEvent("message", { data: { ok: true, prepared: {} } }),
  )
  await expect(bad).rejects.toThrow(/contract/)
  expect(second.terminate).toHaveBeenCalledTimes(1)
})
it("times out a silent parser and terminates its worker", async () => {
  vi.useFakeTimers()
  const worker = port()
  const pending = inspectPlanarSource(
    { format: "svg", bytes: new Uint8Array([1]), units: "mm" },
    new AbortController().signal,
    () => worker as unknown as Worker,
  )
  const rejected = pending.then(
    () => {
      throw new Error("Expected the parser time budget to reject the operation.")
    },
    (error: unknown) => error,
  )
  await vi.advanceTimersByTimeAsync(30000)
  expect(await rejected).toBeInstanceOf(Error)
  expect(((await rejected) as Error).message).toMatch(/timed out/)
  expect(worker.terminate).toHaveBeenCalledTimes(1)
})
