import type { Locator, Page } from "@playwright/test"

type PickTarget = "selected-point" | "datum-face"
type ScreenshotMask = { width: number; height: number; pixels: number[] }
type ColorRegion = { x: number; y: number; width: number; height: number; count: number }

async function screenshotPickMask(canvas: Locator, target: PickTarget): Promise<ScreenshotMask> {
  const screenshot = await canvas.screenshot({ animations: "disabled", scale: "css" })
  return canvas.evaluate(
    async (element, { base64, target }) => {
      const bitmap = element.ownerDocument.createElement("img")
      bitmap.src = `data:image/png;base64,${base64}`
      await bitmap.decode()
      const drawing = element.ownerDocument.createElement("canvas")
      drawing.width = bitmap.width
      drawing.height = bitmap.height
      const context = drawing.getContext("2d")
      if (!context) throw new Error("Expected screenshot decoding support.")
      context.drawImage(bitmap, 0, 0)
      const { width, height } = drawing
      const { data } = context.getImageData(0, 0, width, height)
      const selectedColor = (r: number, g: number, b: number) => r > 160 && r - g > 35 && g - b > 35
      const datumColor = (r: number, g: number, b: number) => b - r > 25 && g - r > 5 && b - g > 5
      const pixels: number[] = []
      for (let pixel = 0; pixel < width * height; pixel++) {
        const r = data[pixel * 4] ?? 0
        const g = data[pixel * 4 + 1] ?? 0
        const b = data[pixel * 4 + 2] ?? 0
        if (selectedColor(r, g, b) || (target === "datum-face" && datumColor(r, g, b)))
          pixels.push(pixel)
      }
      return { width, height, pixels }
    },
    { base64: screenshot.toString("base64"), target },
  )
}

function neighboringPixels(pixel: number, width: number, length: number) {
  const x = pixel % width
  return [
    x > 0 ? pixel - 1 : -1,
    x + 1 < width ? pixel + 1 : -1,
    pixel >= width ? pixel - width : -1,
    pixel + width < length ? pixel + width : -1,
  ]
}

function consumeColorRegion(mask: Uint8Array, width: number, seed: number): ColorRegion {
  const queue = [seed]
  mask[seed] = 0
  let sumX = 0
  let sumY = 0
  let minX = width
  let minY = mask.length / width
  let maxX = 0
  let maxY = 0
  for (const pixel of queue) {
    const x = pixel % width
    const y = Math.floor(pixel / width)
    sumX += x
    sumY += y
    minX = Math.min(minX, x)
    minY = Math.min(minY, y)
    maxX = Math.max(maxX, x)
    maxY = Math.max(maxY, y)
    for (const neighbor of neighboringPixels(pixel, width, mask.length)) {
      if (neighbor < 0 || !mask[neighbor]) continue
      mask[neighbor] = 0
      queue.push(neighbor)
    }
  }
  return {
    x: sumX / queue.length,
    y: sumY / queue.length,
    width: maxX - minX,
    height: maxY - minY,
    count: queue.length,
  }
}

function pickRegions(image: ScreenshotMask, target: PickTarget) {
  const mask = new Uint8Array(image.width * image.height)
  for (const pixel of image.pixels) mask[pixel] = 1
  const regions: ColorRegion[] = []
  for (const seed of image.pixels) {
    if (mask[seed]) regions.push(consumeColorRegion(mask, image.width, seed))
  }
  return regions
    .filter(({ width, height, count }) =>
      target === "selected-point" ? count >= 20 && width <= 32 && height <= 32 : count >= 500,
    )
    .sort((a, b) => b.count - a.count)
}

/** Visible colors propose coordinates; callers verify the actual hover or face-selection feedback. */
export async function visibleCadPickPositions(page: Page, target: PickTarget) {
  const canvas = page.getByRole("region", { name: "3D viewport", exact: true }).locator("canvas")
  const bounds = await canvas.boundingBox()
  if (!bounds) throw new Error("Expected a visible CAD canvas for graphical picking.")
  const image = await screenshotPickMask(canvas, target)
  const positions = pickRegions(image, target).map(({ x, y }) => ({
    x: bounds.x + ((x + 0.5) / image.width) * bounds.width,
    y: bounds.y + ((y + 0.5) / image.height) * bounds.height,
  }))
  const visible = []
  for (const position of positions) {
    if (
      await canvas.evaluate(
        (element, point) => element.ownerDocument.elementFromPoint(point.x, point.y) === element,
        position,
      )
    )
      visible.push(position)
  }
  return visible
}
