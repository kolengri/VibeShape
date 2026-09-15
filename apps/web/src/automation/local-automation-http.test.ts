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
