import { Color } from "three"

const fallbackColors = {
  "--axis-z": 0x4c8dff,
  "--diagnostic-error": 0xe15b64,
  "--diagnostic-warning": 0xf59e0b,
  "--preselection": 0x65a9ee,
  "--sketch-reference-context": 0xb994b4,
} as const

/** Canvas resolves CSS color spaces such as OKLCH before supplying Three.js RGB. */
export function viewerSemanticColor(token: keyof typeof fallbackColors) {
  const fallback = new Color(fallbackColors[token])
  if (typeof document === "undefined") return fallback
  const value = getComputedStyle(document.documentElement).getPropertyValue(token).trim()
  if (!value) return fallback
  const context = document.createElement("canvas").getContext("2d")
  if (!context) return fallback
  context.fillStyle = value
  context.fillRect(0, 0, 1, 1)
  const [r, g, b] = context.getImageData(0, 0, 1, 1).data
  return new Color(`rgb(${r},${g},${b})`)
}
