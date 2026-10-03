import { BUNDLED_SKETCH_TEXT_FONT } from "@vibeshape/domain/sketch-text"
import fontUrl from "@vibeshape/formats/noto-sans-regular.ttf?url"

let retainedFont: Promise<Uint8Array> | undefined
export class SketchTextFontError extends Error {}

async function fetchFont() {
  const response = await fetch(fontUrl)
  if (!response.ok) throw new SketchTextFontError("The bundled sketch font is unavailable.")
  const bytes = new Uint8Array(await response.arrayBuffer())
  if (bytes.byteLength !== BUNDLED_SKETCH_TEXT_FONT.byteLength)
    throw new SketchTextFontError("The bundled sketch font has an unexpected byte length.")
  return bytes
}
export async function loadSketchTextFont() {
  retainedFont ??= fetchFont().catch((error) => {
    retainedFont = undefined
    throw error
  })
  return Uint8Array.from(await retainedFont)
}
export async function hashSketchTextContent(content: string) {
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(content)),
  )
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("")
}
