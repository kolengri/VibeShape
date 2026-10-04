import { writeFile } from "node:fs/promises"
import { resolve } from "node:path"
import { expect, test } from "@playwright/test"

type EvidenceMesh = Readonly<{
  featureId: string
  positions: Float32Array
  normals: Float32Array
  indices: Uint32Array
  triangleFaceIds: Uint32Array
}>
type EvidenceImage = Readonly<{
  mimeType: string
  base64: string
  width: number
  height: number
  views: readonly string[]
}>
type EvidenceCamera = Readonly<{
  position: readonly [number, number, number]
  target: readonly [number, number, number]
  up?: readonly [number, number, number]
  viewHeightMm?: number
}>
type EvidenceProjection = Readonly<{
  a: number
  b: number
  c: number
  d: number
  e: number
  f: number
}>
type EvidenceFrame = Readonly<{
  origin: readonly number[]
  xAxis: readonly number[]
  yAxis: readonly number[]
  normal: readonly number[]
}>
type EvidenceCanvas = {
  width: number
  height: number
  getContext: (kind: "2d") => {
    drawImage: (image: unknown, x: number, y: number) => void
    getImageData: (
      x: number,
      y: number,
      width: number,
      height: number,
    ) => { data: Uint8ClampedArray }
  } | null
}

const modules = {
  preview: `/@fs${resolve(import.meta.dirname, "../../packages/viewer/src/model-preview.ts")}`,
  viewer: `/@fs${resolve(import.meta.dirname, "../../packages/viewer/src/three-viewport.ts")}`,
}

test("isolated model preview emits bounded multi-view PNGs and preserves the live camera", async ({
  page,
}) => {
  await page.route("**/model-preview-evidence.html", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: '<!doctype html><title>Model preview</title><canvas id="live" style="width:400px;height:300px"></canvas>',
    }),
  )
  await page.goto("/model-preview-evidence.html")
  const report = await page.evaluate(async (modules) => {
    const browser = globalThis as unknown as {
      Image: new () => { src: string; width: number; height: number; decode: () => Promise<void> }
      document: {
        createElement: (tag: "canvas") => EvidenceCanvas
        querySelector: (selector: string) => unknown
      }
    }
    const preview: {
      renderModelPreview: (
        meshes: readonly EvidenceMesh[],
        options?: { views?: readonly string[]; camera?: EvidenceCamera },
      ) => Promise<EvidenceImage>
    } = await import(modules.preview)
    const viewer: {
      createGeometryViewport: (canvas: unknown) => {
        setMeshes: (meshes: readonly EvidenceMesh[]) => void
        fit: () => void
        setSketchPlaneProjection: (
          frame: EvidenceFrame,
          onChange: (projection: EvidenceProjection | null) => void,
        ) => void
        dispose: () => void
      }
    } = await import(modules.viewer)
    const box = (width: number, height: number, depth: number, translation = 0): EvidenceMesh => {
      const vertices = [
        [-width / 2, -height / 2, -depth / 2],
        [width / 2, -height / 2, -depth / 2],
        [width / 2, height / 2, -depth / 2],
        [-width / 2, height / 2, -depth / 2],
        [-width / 2, -height / 2, depth / 2],
        [width / 2, -height / 2, depth / 2],
        [width / 2, height / 2, depth / 2],
        [-width / 2, height / 2, depth / 2],
      ]
      const faces = [
        { indices: [0, 2, 1, 0, 3, 2], normal: [0, 0, -1] },
        { indices: [4, 5, 6, 4, 6, 7], normal: [0, 0, 1] },
        { indices: [0, 1, 5, 0, 5, 4], normal: [0, -1, 0] },
        { indices: [3, 7, 6, 3, 6, 2], normal: [0, 1, 0] },
        { indices: [0, 4, 7, 0, 7, 3], normal: [-1, 0, 0] },
        { indices: [1, 2, 6, 1, 6, 5], normal: [1, 0, 0] },
      ]
      const positions: number[] = []
      const normals: number[] = []
      for (const face of faces) {
        for (const index of face.indices) {
          const point = vertices[index]
          if (!point) throw new Error("The box fixture references a missing vertex.")
          positions.push(
            (point[0] ?? 0) + translation,
            (point[1] ?? 0) + translation * 2,
            (point[2] ?? 0) - translation,
          )
          normals.push(...face.normal)
        }
      }
      return {
        featureId: "preview-evidence-box",
        positions: new Float32Array(positions),
        normals: new Float32Array(normals),
        indices: Uint32Array.from({ length: positions.length / 3 }, (_, index) => index),
        triangleFaceIds: new Uint32Array(positions.length / 9).fill(1),
      }
    }
    const pixels = async (base64: string) => {
      const image = new browser.Image()
      image.src = `data:image/png;base64,${base64}`
      await image.decode()
      const canvas = browser.document.createElement("canvas")
      canvas.width = image.width
      canvas.height = image.height
      const context = canvas.getContext("2d")
      if (!context) throw new Error("The image decoder is unavailable.")
      context.drawImage(image, 0, 0)
      return {
        width: image.width,
        height: image.height,
        data: context.getImageData(0, 0, image.width, image.height).data,
      }
    }
    const surfacePixels = (
      image: Awaited<ReturnType<typeof pixels>>,
      columns: number,
      rows: number,
      index: number,
    ) => {
      const cellWidth = image.width / columns
      const cellHeight = image.height / rows
      const startX = (index % columns) * cellWidth + 12
      const startY = Math.floor(index / columns) * cellHeight + 64
      const endX = startX + cellWidth - 24
      const endY = startY + cellHeight - 76
      let count = 0
      let minX = Infinity
      let maxX = -Infinity
      let minY = Infinity
      let maxY = -Infinity
      for (let y = startY; y < endY; y++) {
        for (let x = startX; x < endX; x++) {
          const offset = (y * image.width + x) * 4
          const difference =
            Math.abs((image.data[offset] ?? 0) - 243) +
            Math.abs((image.data[offset + 1] ?? 0) - 245) +
            Math.abs((image.data[offset + 2] ?? 0) - 248)
          if (difference < 24) continue
          count++
          minX = Math.min(minX, x - startX)
          maxX = Math.max(maxX, x - startX)
          minY = Math.min(minY, y - startY)
          maxY = Math.max(maxY, y - startY)
        }
      }
      return { count, minX, minY, maxX, maxY, width: endX - startX, height: endY - startY }
    }
    const colorPixels = (image: Awaited<ReturnType<typeof pixels>>, color: readonly number[]) => {
      let count = 0
      for (let y = 64; y < image.height - 12; y++) {
        for (let x = 12; x < image.width - 12; x++) {
          const offset = (y * image.width + x) * 4
          const difference = color.reduce(
            (sum, channel, index) => sum + Math.abs((image.data[offset + index] ?? 0) - channel),
            0,
          )
          if (difference < 12) count++
        }
      }
      return count
    }
    const source = box(40, 18, 9)
    const originalPositions = source.positions.slice()
    const canvas = browser.document.querySelector("#live")
    if (!canvas) throw new Error("The live viewport canvas is missing.")
    const viewport = viewer.createGeometryViewport(canvas)
    viewport.setMeshes([source])
    viewport.fit()
    const frame: EvidenceFrame = {
      origin: [0, 0, 0],
      xAxis: [1, 0, 0],
      yAxis: [0, 1, 0],
      normal: [0, 0, 1],
    }
    let before: EvidenceProjection | null = null
    viewport.setSketchPlaneProjection(frame, (projection) => {
      before = projection
    })
    try {
      const collage = await preview.renderModelPreview([source])
      const decoded = await pixels(collage.base64)
      const panels = collage.views.map((_, index) => surfacePixels(decoded, 2, 2, index))
      const detail = { ...box(4, 4, 4), featureId: "zoom-detail" }
      for (let index = 0; index < detail.positions.length; index += 3) {
        detail.positions[index] = (detail.positions[index] ?? 0) + 10
        detail.positions[index + 2] = (detail.positions[index + 2] ?? 0) + 10
      }
      const camera: EvidenceCamera = { position: [10, 0, 30], target: [10, 0, 10] }
      const [
        top,
        translatedTop,
        elongatedTop,
        customTop,
        translatedCustomTop,
        autoDetail,
        zoomDetail,
      ] = await Promise.all([
        preview.renderModelPreview([source], { views: ["top"] }),
        preview.renderModelPreview([box(40, 18, 9, 10_000)], { views: ["top"] }),
        preview.renderModelPreview([box(2_000, 20, 0.001)], { views: ["top"] }),
        preview.renderModelPreview([source], { camera }),
        preview.renderModelPreview([box(40, 18, 9, 10_000)], {
          camera: { position: [10_010, 20_000, -9_970], target: [10_010, 20_000, -9_990] },
        }),
        preview.renderModelPreview([source, detail], { camera }),
        preview.renderModelPreview([source, detail], { camera: { ...camera, viewHeightMm: 12 } }),
      ])
      const original = await pixels(top.base64)
      const translated = await pixels(translatedTop.base64)
      const elongated = await pixels(elongatedTop.base64)
      const custom = await pixels(customTop.base64)
      const customTranslated = await pixels(translatedCustomTop.base64)
      const fitted = await pixels(autoDetail.base64)
      const zoomed = await pixels(zoomDetail.base64)
      const centerOffset = ((64 + (zoomed.height - 76) / 2) * zoomed.width + zoomed.width / 2) * 4
      const detailColor = Array.from(zoomed.data.subarray(centerOffset, centerOffset + 3))
      let after: EvidenceProjection | null = null
      viewport.setSketchPlaneProjection(frame, (projection) => {
        after = projection
      })
      return {
        sample: collage.base64,
        zoomSample: zoomDetail.base64,
        mimeType: collage.mimeType,
        views: collage.views,
        width: collage.width,
        height: collage.height,
        decodedWidth: decoded.width,
        decodedHeight: decoded.height,
        bytes: atob(collage.base64).length,
        panels,
        translatedPixelsMatch:
          original.width === translated.width &&
          original.height === translated.height &&
          original.data.every((value, index) => value === translated.data[index]),
        elongated: surfacePixels(elongated, 1, 1, 0),
        customViews: customTop.views,
        customTranslatedPixelsMatch: custom.data.every(
          (value, index) => value === customTranslated.data[index],
        ),
        fittedDetailPixels: colorPixels(fitted, detailColor),
        zoomedDetailPixels: colorPixels(zoomed, detailColor),
        detailColor,
        liveProjectionBefore: before,
        liveProjectionAfter: after,
        sourceUnchanged: originalPositions.every(
          (value, index) => source.positions[index] === value,
        ),
      }
    } finally {
      viewport.dispose()
    }
  }, modules)
  await writeFile(test.info().outputPath("model-preview.png"), Buffer.from(report.sample, "base64"))
  await writeFile(
    test.info().outputPath("model-preview-detail.png"),
    Buffer.from(report.zoomSample, "base64"),
  )
  expect(report.mimeType).toBe("image/png")
  expect(report.views).toEqual(["isometric", "front", "right", "top"])
  expect(report.width).toBeLessThanOrEqual(1_024)
  expect(report.height).toBeLessThanOrEqual(768)
  expect(report.bytes).toBeLessThanOrEqual(88 * 1_024)
  expect(report.decodedWidth).toBe(report.width)
  expect(report.decodedHeight).toBe(report.height)
  for (const panel of report.panels) {
    expect(panel.count).toBeGreaterThan(1_000)
    expect(panel.minX).toBeGreaterThan(2)
    expect(panel.minY).toBeGreaterThan(2)
    expect(panel.maxX).toBeLessThan(panel.width - 2)
    expect(panel.maxY).toBeLessThan(panel.height - 2)
  }
  expect(report.translatedPixelsMatch).toBe(true)
  expect(report.elongated.count).toBeGreaterThan(100)
  expect(report.elongated.minX).toBeGreaterThan(2)
  expect(report.elongated.maxX).toBeLessThan(report.elongated.width - 2)
  expect(report.liveProjectionBefore).not.toBeNull()
  expect(report.liveProjectionAfter).toEqual(report.liveProjectionBefore)
  expect(report.sourceUnchanged).toBe(true)
  expect(report.customViews).toEqual(["custom"])
  expect(report.customTranslatedPixelsMatch).toBe(true)
  expect(report.fittedDetailPixels).toBeGreaterThan(100)
  expect(report.zoomedDetailPixels).toBeGreaterThan(report.fittedDetailPixels * 4)
  expect(report.zoomedDetailPixels).toBeLessThan((report.width * report.height) / 4)
})
