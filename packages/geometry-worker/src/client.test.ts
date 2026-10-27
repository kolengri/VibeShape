import { afterEach, expect, it } from "bun:test"
import type { GeometryWorkerRequest, GeometryWorkerResponse } from "@vibeshape/protocol"
import { vi } from "../../../tests/unit/support/bun-test"
import { createGeometryRequestEnvelope, GeometryWorkerClient } from "./client"

function fixture() {
  const listeners = new Map<string, (event: never) => void>()
  const worker = {
    postMessage: vi.fn<(message: GeometryWorkerRequest) => void>(),
    addEventListener: vi.fn((type: string, listener: (event: never) => void) => {
      listeners.set(type, listener)
    }),
    removeEventListener: vi.fn((type: string) => {
      listeners.delete(type)
    }),
    terminate: vi.fn(),
  }
  const client = new GeometryWorkerClient(worker)
  const request = {
    ...createGeometryRequestEnvelope("geometry-client-fixture", 1),
    type: "healthCheck" as const,
  }
  const emit = (response: GeometryWorkerResponse) =>
    listeners.get("message")?.({ data: response } as never)
  const health = {
    ...request,
    type: "health" as const,
    initialized: true,
    activeDocuments: 0,
    ownedShapeCount: 0,
    wasmHeapBytes: 0,
  }
  return { client, worker, listeners, request, health, emit }
}

afterEach(() => {
  vi.useRealTimers()
})

it("accepts a geometry result after ten minutes without an implicit deadline", async () => {
  vi.useFakeTimers()
  const f = fixture()
  try {
    const settled = vi.fn()
    const pending = f.client.request(f.request)
    void pending.then(settled, settled)
    await vi.advanceTimersByTimeAsync(600_001)
    expect(settled).not.toHaveBeenCalled()
    f.emit(f.health)
    expect(await pending).toEqual(f.health)
  } finally {
    f.client.terminate()
  }
})

it("releases a long-running request on termination and rejects later work", async () => {
  vi.useFakeTimers()
  const f = fixture()
  const pending = f.client.request(f.request).catch((error: unknown) => error)
  await vi.advanceTimersByTimeAsync(600_001)
  f.client.terminate()
  expect(await pending).toMatchObject({ message: "Geometry worker terminated." })
  expect(f.worker.terminate).toHaveBeenCalledTimes(1)
  expect(f.listeners.size).toBe(0)
  await expect(f.client.request(f.request)).rejects.toThrow("unavailable")
})

it.each(["error", "messageerror"])(
  "settles pending geometry on %s without waiting for a deadline",
  async (event) => {
    const f = fixture()
    try {
      const pending = f.client.request(f.request).catch((error: unknown) => error)
      f.listeners.get(event)?.({ message: "Kernel worker crashed." } as never)
      expect(await pending).toBeInstanceOf(Error)
      await expect(f.client.request(f.request)).rejects.toThrow("unavailable")
    } finally {
      f.client.terminate()
    }
  },
)

it("cleans up a failed send so the same request can be retried explicitly", async () => {
  const f = fixture()
  try {
    f.worker.postMessage.mockImplementationOnce(() => {
      throw new Error("Clone failed.")
    })
    await expect(f.client.request(f.request)).rejects.toThrow("Clone failed.")
    const pending = f.client.request(f.request)
    await expect(f.client.request(f.request)).rejects.toThrow("already pending")
    f.emit(f.health)
    expect(await pending).toEqual(f.health)
  } finally {
    f.client.terminate()
  }
})

it("honors an explicitly requested client deadline without making it the default", async () => {
  vi.useFakeTimers()
  const f = fixture()
  try {
    const outcome = f.client.request(f.request, { timeoutMs: 25 }).catch((error: unknown) => error)
    await vi.advanceTimersByTimeAsync(25)
    expect(await outcome).toMatchObject({ message: "Geometry request timed out after 25 ms." })
  } finally {
    f.client.terminate()
  }
})
