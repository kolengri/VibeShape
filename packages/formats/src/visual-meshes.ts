import { z } from "zod"

const coordinateSchema = z.number().finite().min(-100_000).max(100_000)
const unitIntervalSchema = z.number().finite().min(0).max(1)

/** Display material only; it states no physical property of the exported body. */
export const visualMeshMaterialSchema = z
  .object({
    /** sRGB display color as #RRGGBB. */
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    metalness: unitIntervalSchema,
    roughness: unitIntervalSchema,
    opacity: unitIntervalSchema,
  })
  .strict()
export type VisualMeshMaterial = z.infer<typeof visualMeshMaterialSchema>

/** Neutral material for bodies without an authored part appearance. */
export const DEFAULT_VISUAL_MESH_MATERIAL: VisualMeshMaterial = {
  color: "#9aaec1",
  metalness: 0,
  roughness: 0.6,
  opacity: 1,
}

const visualMeshSchema = z
  .object({
    name: z.string().max(4_096),
    /** World-space XYZ triples in millimeters, right-handed Z-up. */
    vertices: z.array(coordinateSchema).min(9),
    triangles: z.array(z.number().int().nonnegative()).min(3),
    material: visualMeshMaterialSchema.optional(),
  })
  .strict()
  .superRefine((mesh, context) => {
    if (
      mesh.vertices.length % 3 ||
      mesh.triangles.length % 3 ||
      mesh.triangles.some((index) => index >= mesh.vertices.length / 3)
    )
      context.addIssue({
        code: "custom",
        message: "Meshes require complete XYZ triples and bounded triangle indices.",
      })
  })

export const visualMeshExportInputSchema = z
  .object({
    title: z.string().max(4_096),
    meshes: z.array(visualMeshSchema).min(1).max(4_096),
  })
  .strict()
export type VisualMeshExportInput = z.input<typeof visualMeshExportInputSchema>
export type VisualMesh = z.infer<typeof visualMeshSchema>

/** Single-line display name: format records are line or JSON based and must stay parseable. */
export function visualMeshName(name: string, index: number) {
  const cleaned = [...name]
    .map((character) => (character.charCodeAt(0) < 32 ? " " : character))
    .join("")
    .replace(/\s+/g, " ")
    .trim()
  return cleaned || `Body ${index + 1}`
}

/**
 * Shares one material per distinct appearance in first-use order so equal input yields equal
 * output regardless of object identity.
 */
export function collectVisualMaterials(meshes: readonly VisualMesh[]) {
  const materials: VisualMeshMaterial[] = []
  const indexByKey = new Map<string, number>()
  const meshMaterials = meshes.map((mesh) => {
    const material = mesh.material ?? DEFAULT_VISUAL_MESH_MATERIAL
    const normalized = { ...material, color: material.color.toLowerCase() }
    const key = [
      normalized.color,
      normalized.metalness,
      normalized.roughness,
      normalized.opacity,
    ].join(":")
    let index = indexByKey.get(key)
    if (index === undefined) {
      index = materials.length
      indexByKey.set(key, index)
      materials.push(normalized)
    }
    return index
  })
  return { materials, meshMaterials }
}

/** sRGB #RRGGBB channel values in 0..1. */
export function srgbChannels(color: string): [number, number, number] {
  const channel = (offset: number) => Number.parseInt(color.slice(offset, offset + 2), 16) / 255
  return [channel(1), channel(3), channel(5)]
}

/** IEC 61966-2-1 sRGB transfer inverse; glTF factors are linear. */
export function srgbToLinear(value: number) {
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
}

/** Fixed-precision decimal without exponent or negative zero. */
export function fixedDecimal(value: number, digits = 6) {
  const rounded = Number(value.toFixed(digits))
  return String(rounded === 0 ? 0 : rounded)
}
