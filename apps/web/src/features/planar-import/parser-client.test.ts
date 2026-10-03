import { afterEach, expect, it, vi } from "vitest"
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
  expect(worker.terminate).toHaveBeenCalledOnce()
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
  expect(second.terminate).toHaveBeenCalledOnce()
})
it("times out a silent parser and terminates its worker", async () => {
  vi.useFakeTimers()
  const worker = port()
  const pending = inspectPlanarSource(
    { format: "svg", bytes: new Uint8Array([1]), units: "mm" },
    new AbortController().signal,
    () => worker as unknown as Worker,
  )
  const rejected = expect(pending).rejects.toThrow(/timed out/)
  await vi.advanceTimersByTimeAsync(30000)
  await rejected
  expect(worker.terminate).toHaveBeenCalledOnce()
})
