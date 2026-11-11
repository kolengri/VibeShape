import {
  type DrawingSettings,
  drawingPresetSchema,
  drawingSettingsSchema,
} from "@vibeshape/domain/drawing"

const PRESET_KEY_PREFIX = "vibeshape-drawing-preset:"

function storage(): Storage | null {
  try {
    return globalThis.localStorage ?? null
  } catch {
    return null
  }
}

/**
 * Per-document dialog preset on this device. Drawings are derived output, so the preset never
 * enters the document, its revisions or `.vshape`; invalid or missing presets fall back to defaults.
 */
export function readDrawingPreset(documentId: string): DrawingSettings {
  try {
    const raw = storage()?.getItem(`${PRESET_KEY_PREFIX}${documentId}`)
    const parsed = drawingPresetSchema.safeParse(raw ? JSON.parse(raw) : null)
    if (parsed.success) return parsed.data.settings
  } catch {
    // Unreadable storage or malformed JSON falls through to defaults.
  }
  return drawingSettingsSchema.parse({})
}

export function writeDrawingPreset(documentId: string, settings: DrawingSettings) {
  try {
    storage()?.setItem(
      `${PRESET_KEY_PREFIX}${documentId}`,
      JSON.stringify(drawingPresetSchema.parse({ schemaVersion: 1, settings })),
    )
  } catch {
    // Quota or privacy-mode failures only lose the convenience preset.
  }
}
