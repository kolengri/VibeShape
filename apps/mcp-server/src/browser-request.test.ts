import { afterEach, describe, expect, it, vi } from "vitest"
import { BrowserRequestError, readBrowserJson } from "./browser-request"

afterEach(() => vi.useRealTimers())
describe("bounded browser request bodies", () => {
  it("enforces actual streamed bytes even when Content-Length understates the body", async () => {
    const cancelled = vi.fn()
    const request = new Request("http://127.0.0.1/", {
      method: "POST",
      headers: { "content-length": "2" },
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array(1025))
        },
        cancel: cancelled,
      }),
      duplex: "half",
    })
    await expect(readBrowserJson(request, 1024)).rejects.toMatchObject({
      status: 413,
      code: "body-too-large",
    })
    expect(cancelled).toHaveBeenCalledOnce()
  })
  it("times out a stalled body and releases its reader", async () => {
    vi.useFakeTimers()
    const cancelled = vi.fn()
    const request = new Request("http://127.0.0.1/", {
      method: "POST",
      body: new ReadableStream({ cancel: cancelled }),
      duplex: "half",
    })
    const result = readBrowserJson(request, 1024).catch((error: unknown) => error)
    await vi.advanceTimersByTimeAsync(5000)
    expect(await result).toBeInstanceOf(BrowserRequestError)
    expect(await result).toMatchObject({ status: 408 })
    expect(cancelled).toHaveBeenCalledOnce()
    expect(request.body?.locked).toBe(false)
  })
})
