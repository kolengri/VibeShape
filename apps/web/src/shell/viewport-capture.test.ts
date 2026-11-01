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

it("reads the visible committed picture source and invalidates consumers when its owner changes", () => {
  const port = createViewportCapturePort()
  const events: string[] = []
  const unsubscribe = port.subscribePicture(() => events.push("changed"))
  const source = { documentId: "first", revision: 2, meshes: [] }
  const remove = port.registerPicture(() => source)
  port.registerPicture(() => null)
  expect(port.pictureSource()).toBe(source)
  expect(events).toHaveLength(2)
  remove()
  expect(port.pictureSource()).toBeNull()
  expect(events).toHaveLength(3)
  unsubscribe()
  port.registerPicture(() => ({ documentId: "second", revision: 0, meshes: [] }))
  expect(port.pictureSource()?.documentId).toBe("second")
  expect(events).toHaveLength(3)
})
