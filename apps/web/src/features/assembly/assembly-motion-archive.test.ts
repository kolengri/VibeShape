import { afterEach, expect, it, mock } from "bun:test"
import { unzipSync } from "fflate"
import { vi } from "../../../../../tests/unit/support/bun-test"
import { archiveAssemblyMotionFrames } from "./assembly-motion-archive"

class ManualArchiveWorker {
  onmessage: ((event: MessageEvent<unknown>) => void) | null = null
  onerror: (() => void) | null = null
  onmessageerror: (() => void) | null = null
  postMessage = mock(() => {})
  terminate = mock(() => {})
}

function frames() {
  return {
    "motion.json": new TextEncoder().encode('{"revision":7}'),
    "frame-0001.png": new Uint8Array([137, 80, 78, 71]),
    "frame-0002.png": new Uint8Array([137, 80, 78, 71, 2]),
  }
}

function fixture() {
  const worker = new ManualArchiveWorker()
  const abort = new AbortController()
  const run = () =>
    archiveAssemblyMotionFrames(frames(), abort.signal, () => worker as unknown as Worker)
  return { worker, abort, run }
}

afterEach(() => vi.useRealTimers())

const archiveFailures = {
  contract: (worker: ManualArchiveWorker) =>
    worker.onmessage?.(new MessageEvent("message", { data: { ok: true, archive: [] } })),
  failure: (worker: ManualArchiveWorker) =>
    worker.onmessage?.(new MessageEvent("message", { data: { ok: false } })),
  error: (worker: ManualArchiveWorker) => worker.onerror?.(),
  messageerror: (worker: ManualArchiveWorker) => worker.onmessageerror?.(),
  post: () => {},
  timeout: () => vi.advanceTimersByTime(60_000),
}

it("packages ordered frame contents in the real module worker and transfers only owned images", async () => {
  const files = frames()
  const expected = Object.fromEntries(
    Object.entries(files).map(([name, bytes]) => [name, Array.from(bytes)]),
  )
  const archive = await archiveAssemblyMotionFrames(files, new AbortController().signal)
  const unpacked = unzipSync(archive)
  expect(Object.keys(unpacked)).toEqual(Object.keys(expected))
  for (const [name, bytes] of Object.entries(expected))
    expect(Array.from(unpacked[name] ?? [])).toEqual(bytes)
  expect(Object.values(files).every((bytes) => bytes.byteLength === 0)).toBe(true)
})

it("cancels in-flight compression and ignores a captured late response", async () => {
  const { worker, abort, run } = fixture()
  const pending = run()
  const lateReply = worker.onmessage
  abort.abort(new Error("The source revision changed."))
  lateReply?.(new MessageEvent("message", { data: { ok: true, archive: new Uint8Array([1]) } }))
  await expect(pending).rejects.toThrow("The source revision changed.")
  expect(worker.terminate).toHaveBeenCalledTimes(1)
  expect(worker.onmessage).toBeNull()
  expect(worker.onerror).toBeNull()
  expect(worker.onmessageerror).toBeNull()
})

it.each(["contract", "failure", "error", "messageerror", "post", "timeout"] as const)(
  "terminates and rejects on %s",
  async (mode) => {
    if (mode === "timeout") vi.useFakeTimers()
    const { worker, run } = fixture()
    if (mode === "post")
      worker.postMessage.mockImplementation(() => {
        throw new Error("Clone failed.")
      })
    const pending = run()
    archiveFailures[mode](worker)
    await expect(pending).rejects.toThrow()
    expect(worker.terminate).toHaveBeenCalledTimes(1)
    expect(worker.onmessage).toBeNull()
  },
)

it("does not start or transfer buffers for a cancelled export", async () => {
  const { worker, abort, run } = fixture()
  abort.abort()
  await expect(run()).rejects.toThrow()
  expect(worker.postMessage).not.toHaveBeenCalled()
  expect(worker.terminate).not.toHaveBeenCalled()
})

it("catches cancellation during worker creation before transferring frames", async () => {
  const worker = new ManualArchiveWorker()
  const abort = new AbortController()
  await expect(
    archiveAssemblyMotionFrames(frames(), abort.signal, () => {
      abort.abort()
      return worker as unknown as Worker
    }),
  ).rejects.toThrow()
  expect(worker.postMessage).not.toHaveBeenCalled()
  expect(worker.terminate).toHaveBeenCalledTimes(1)
})
