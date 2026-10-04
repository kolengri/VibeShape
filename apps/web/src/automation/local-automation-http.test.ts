import { afterEach, describe, expect, it, vi } from "vitest"
import { localAutomationRequest } from "./local-automation-http"

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})
describe("local automation response boundaries", () => {
  it("limits bytes before decoding a response", async () => {
    const cancelled = vi.fn()
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new Uint8Array(256 * 1024 + 1))
            },
            cancel: cancelled,
          }),
        ),
      ),
    )
    await expect(localAutomationRequest("/poll", {})).rejects.toThrow("too large")
    expect(cancelled).toHaveBeenCalledOnce()
  })
  it("keeps the deadline active after response headers arrive", async () => {
    vi.useFakeTimers()
    vi.stubGlobal(
      "fetch",
      vi.fn((_url, init: RequestInit) =>
        Promise.resolve(
          new Response(
            new ReadableStream({
              start(controller) {
                init.signal?.addEventListener(
                  "abort",
                  () => controller.error(new Error("Request aborted")),
                  { once: true },
                )
              },
            }),
          ),
        ),
      ),
    )
    const result = localAutomationRequest("/poll", {}).catch((error: unknown) => error)
    await vi.advanceTimersByTimeAsync(5000)
    expect(await result).toMatchObject({ message: "Request aborted" })
  })
})

it("retries an interrupted poll with the identical sequence and credential", async () => {
  vi.useFakeTimers()
  const fetch = vi
    .fn()
    .mockRejectedValueOnce(new TypeError("Offline"))
    .mockResolvedValue(new Response(JSON.stringify({ ok: true })))
  vi.stubGlobal("fetch", fetch)
  const pending = localAutomationRequest("/poll", { sequence: 7 }, "test-token")
  await vi.advanceTimersByTimeAsync(250)
  await expect(pending).resolves.toMatchObject({ ok: true })
  expect(fetch).toHaveBeenCalledTimes(2)
  expect(fetch.mock.calls[0]?.[1].body).toBe(fetch.mock.calls[1]?.[1].body)
  expect(fetch.mock.calls[1]?.[1].headers.Authorization).toBe("Bearer test-token")
})
it("does not retry pairing or malformed protocol responses", async () => {
  const fetch = vi.fn().mockRejectedValue(new TypeError("Offline"))
  vi.stubGlobal("fetch", fetch)
  await expect(localAutomationRequest("/connect", {})).rejects.toThrow("temporarily unavailable")
  expect(fetch).toHaveBeenCalledOnce()
  fetch.mockResolvedValue(new Response("not-json"))
  await expect(localAutomationRequest("/poll", {})).rejects.toThrow()
  expect(fetch).toHaveBeenCalledTimes(2)
})
