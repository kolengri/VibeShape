import {
  type NativeMeshFormat,
  type NativeSlicerApi,
  type NativeSlicerTarget,
  nativeMeshFormatSchema,
  nativeSlicerIdSchema,
} from "@vibeshape/slicer-handoff/native"
import { z } from "zod"

declare global {
  interface Window {
    vibeshapeSlicer?: NativeSlicerApi
  }
}
const preferenceKey = "org.vibeshape.native-slicer.v1"
const preferenceSchema = z.strictObject({
  slicerId: nativeSlicerIdSchema.nullable(),
  format: nativeMeshFormatSchema,
})
export function getNativeSlicer() {
  const api = window.vibeshapeSlicer
  return api?.protocolVersion === 1 ? api : undefined
}
export function readNativeSlicerPreference() {
  try {
    const parsed = preferenceSchema.safeParse(
      JSON.parse(localStorage.getItem(preferenceKey) ?? "null"),
    )
    if (parsed.success) return parsed.data
  } catch {
    /* Browser storage can be unavailable. */
  }
  return { slicerId: null, format: "3mf" as const }
}
export function saveNativeSlicerPreference(
  slicerId: NativeSlicerTarget["id"] | null,
  format: NativeMeshFormat,
) {
  try {
    localStorage.setItem(
      preferenceKey,
      JSON.stringify(preferenceSchema.parse({ slicerId, format })),
    )
  } catch {
    /* Preferences do not block a mesh handoff. */
  }
}
