import {
  MAX_SURFACE_TEXTURE_MAP_DIMENSION,
  type SurfaceTextureMap,
  surfaceTextureMapSchema,
} from "@vibeshape/domain/surface-textures"

/** Decode locally, preserve aspect ratio, and persist bounded grayscale data in the project. */
export async function readTextureImage(file: File): Promise<SurfaceTextureMap> {
  if (file.size > 8 * 1024 * 1024 || !["image/png", "image/jpeg", "image/webp"].includes(file.type))
    throw new Error("unsupported-image")
  const bitmap = await createImageBitmap(file)
  try {
    if (bitmap.width * bitmap.height > 16_777_216) throw new Error("image-too-large")
    const scale = Math.min(
      1,
      MAX_SURFACE_TEXTURE_MAP_DIMENSION / Math.max(bitmap.width, bitmap.height),
    )
    const canvas = document.createElement("canvas")
    canvas.width = Math.max(1, Math.round(bitmap.width * scale))
    canvas.height = Math.max(1, Math.round(bitmap.height * scale))
    const context = canvas.getContext("2d", { willReadFrequently: true })
    if (!context) throw new Error("image-decoding-unavailable")
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    const image = context.getImageData(0, 0, canvas.width, canvas.height)
    const pixels = Array.from({ length: canvas.width * canvas.height }, (_, index) => {
      const i = index * 4
      return Math.round(
        ((0.2126 * (image.data[i] ?? 0) +
          0.7152 * (image.data[i + 1] ?? 0) +
          0.0722 * (image.data[i + 2] ?? 0)) *
          (image.data[i + 3] ?? 0)) /
          255,
      )
    })
    return surfaceTextureMapSchema.parse({
      kind: "custom",
      width: canvas.width,
      height: canvas.height,
      pixels,
    })
  } finally {
    bitmap.close()
  }
}
