import { expect, it } from "bun:test"
import { createViewportCapturePort } from "./viewport-capture"

it("does not capture automatically and uses the currently visible presentation", async () => {
  const port = createViewportCapturePort()
  const calls: string[] = []
  const blob = new Blob(["current view"], { type: "image/png" })
  port.register(async () => {
    calls.push("visible")
    return blob
  })
  port.register(async () => {
    calls.push("hidden")
    return null
  })
  expect(calls).toEqual([])
  expect(await port.capture()).toBe(blob)
  expect(calls).toEqual(["hidden", "visible"])
})

it("drops a capture if its owning viewport disappears before encoding completes", async () => {
  const port = createViewportCapturePort()
  let finish: ((image: Blob) => void) | undefined
  const pending = new Promise<Blob>((resolve) => {
    finish = resolve
  })
  const unregister = port.register(() => pending)
  const image = port.capture()
  unregister()
  if (!finish) throw new Error("Missing capture completion.")
  finish(new Blob(["old project"]))
  expect(await image).toBeNull()
  expect(await port.capture()).toBeNull()
})
