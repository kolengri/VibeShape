import "../../../tests/unit/support/dom"
import { expect, it } from "bun:test"
import { captureViewportImage } from "./viewport-image"

function imageFixture() {
  const source = document.createElement("canvas")
  source.width = 3200
  source.height = 1800
  const image = document.createElement("canvas")
  const operations: string[] = []
  const context = {
    fillStyle: "",
    fillRect: () => operations.push("background"),
    drawImage: (canvas: HTMLCanvasElement) => {
      expect(canvas).toBe(source)
      operations.push("copy")
    },
  }
  Object.defineProperty(image, "getContext", { value: () => context })
  Object.defineProperty(image, "toBlob", {
    configurable: true,
    value: (callback: BlobCallback, type: string) => {
      expect(type).toBe("image/png")
      operations.push("encode")
      callback(new Blob(["encoded pixels"], { type }))
    },
  })
  return { source, image, context, operations }
}

it("captures one freshly rendered current frame without resizing the live viewport", async () => {
  const f = imageFixture()
  const blob = await captureViewportImage(
    f.source,
    () => f.operations.push("render"),
    "rgb(25, 30, 35)",
    () => f.image,
  )
  expect(f.operations).toEqual(["render", "background", "copy", "encode"])
  expect(f.context.fillStyle).toBe("rgb(25, 30, 35)")
  expect([f.image.width, f.image.height]).toEqual([1600, 900])
  expect([f.source.width, f.source.height]).toEqual([3200, 1800])
  expect(blob.type).toBe("image/png")
})

it("does not upscale smaller viewports", async () => {
  const f = imageFixture()
  f.source.width = 400
  f.source.height = 300
  await captureViewportImage(
    f.source,
    () => {},
    "transparent",
    () => f.image,
  )
  expect([f.image.width, f.image.height]).toEqual([400, 300])
})

it("rejects unavailable or failed encoders instead of returning a blank attachment", async () => {
  const f = imageFixture()
  f.source.width = 0
  expect(() =>
    captureViewportImage(
      f.source,
      () => {},
      "transparent",
      () => f.image,
    ),
  ).toThrow("unavailable")
  f.source.width = 10
  Object.defineProperty(f.image, "toBlob", {
    value: (callback: BlobCallback) => callback(null),
    configurable: true,
  })
  await expect(
    captureViewportImage(
      f.source,
      () => {},
      "transparent",
      () => f.image,
    ),
  ).rejects.toThrow("encoding failed")
})
