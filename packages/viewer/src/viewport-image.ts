const MAX_IMAGE_DIMENSION = 1600

/** Copy immediately after rendering; the live WebGL buffer is not preserved between frames. */
export function captureViewportImage(
  canvas: HTMLCanvasElement,
  render: () => void,
  background: string,
  createCanvas: () => HTMLCanvasElement = () => document.createElement("canvas"),
): Promise<Blob> {
  if (canvas.width <= 0 || canvas.height <= 0) throw new Error("The viewport is unavailable.")
  const image = createCanvas()
  const scale = Math.min(1, MAX_IMAGE_DIMENSION / Math.max(canvas.width, canvas.height))
  image.width = Math.max(1, Math.round(canvas.width * scale))
  image.height = Math.max(1, Math.round(canvas.height * scale))
  const context = image.getContext("2d")
  if (!context) throw new Error("Viewport image encoding is unavailable.")
  render()
  context.fillStyle = background
  context.fillRect(0, 0, image.width, image.height)
  context.drawImage(canvas, 0, 0, image.width, image.height)
  return new Promise((resolve, reject) => {
    image.toBlob((blob) => {
      if (blob && blob.size > 0) resolve(blob)
      else reject(new Error("Viewport image encoding failed."))
    }, "image/png")
  })
}
