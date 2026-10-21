import { afterEach, expect, it } from "bun:test"
import { documentIdSchema } from "@vibeshape/domain/identifiers"
import { vi } from "../../../../tests/unit/support/bun-test"
import { exportProjectBackup } from "./project-backup-client"

afterEach(() => vi.useRealTimers())

const request = {
  databaseName: "backup-worker-test",
  documentId: documentIdSchema.parse("0195b5ac-b250-7a2c-8c33-000000000101"),
  revision: 3,
}
const response = {
  ok: true as const,
  file: new Uint8Array([1, 2, 3]),
  documentId: request.documentId,
  revision: 3,
  documentName: "Housing",
}
function port() {
  return {
    terminate: vi.fn(),
    postMessage: vi.fn(),
    onmessage: null as Worker["onmessage"],
    onerror: null as Worker["onerror"],
    onmessageerror: null as Worker["onmessageerror"],
  }
}
function deliver(worker: ReturnType<typeof port>, data: unknown) {
  worker.onmessage?.call(worker as unknown as Worker, new MessageEvent("message", { data }))
}

it("sends only persisted identity to the worker and receives its matching archive", async () => {
  const worker = port()
  const pending = exportProjectBackup(request, () => worker as unknown as Worker)
  expect(worker.postMessage.mock.calls).toEqual([[{ schemaVersion: 0, ...request }]])
  deliver(worker, response)
  expect(await pending).toEqual(response)
  expect(worker.terminate).toHaveBeenCalledTimes(1)
  expect(worker.onmessage).toBeNull()
})

it("rejects malformed or wrong-revision replies and releases the worker for another attempt", async () => {
  for (const data of [{ ok: true }, { ...response, revision: 4 }]) {
    const worker = port()
    const pending = exportProjectBackup(request, () => worker as unknown as Worker)
    deliver(worker, data)
    await expect(pending).rejects.toThrow()
    expect(worker.terminate).toHaveBeenCalledTimes(1)
  }
  const worker = port()
  const pending = exportProjectBackup(request, () => worker as unknown as Worker)
  const failure = {
    ok: false as const,
    diagnostic: { code: "corrupt-history", message: "Invalid history.", retryable: false },
  }
  deliver(worker, failure)
  expect(await pending).toEqual({
    ok: false,
    diagnostic: { code: "corrupt-history", message: "Invalid history." },
  })
  expect(worker.terminate).toHaveBeenCalledTimes(1)
})

it("terminates on startup, transport, and timeout failures", async () => {
  const throwing = port()
  throwing.postMessage.mockImplementation(() => {
    throw new Error("Posting failed.")
  })
  await expect(exportProjectBackup(request, () => throwing as unknown as Worker)).rejects.toThrow(
    "Posting failed.",
  )
  expect(throwing.terminate).toHaveBeenCalledTimes(1)
  for (const event of ["onerror", "onmessageerror"] as const) {
    const worker = port()
    const pending = exportProjectBackup(request, () => worker as unknown as Worker)
    worker[event]?.call(
      worker as unknown as Worker,
      new Event("error") as ErrorEvent & MessageEvent,
    )
    await expect(pending).rejects.toThrow()
    expect(worker.terminate).toHaveBeenCalledTimes(1)
  }
  vi.useFakeTimers()
  const worker = port()
  const pending = exportProjectBackup(request, () => worker as unknown as Worker)
  const rejected = pending.catch((error: unknown) => error)
  vi.advanceTimersByTime(300_000)
  expect(await rejected).toBeInstanceOf(Error)
  expect(((await rejected) as Error).message).toContain("timed out")
  expect(worker.terminate).toHaveBeenCalledTimes(1)
})
