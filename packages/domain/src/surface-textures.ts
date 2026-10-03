import { z } from "zod"
import { bodyOutputRoleSchema } from "./body-reference"
import {
  featureIdSchema,
  type SurfaceTextureLayerId,
  surfaceTextureLayerIdSchema,
} from "./identifiers"
import { bodyTopoRefSchema } from "./model-body-topology"
import { topologySignatureSchema } from "./topology"

export const MAX_SURFACE_TEXTURE_LAYERS_PER_FEATURE = 4
export const MAX_SURFACE_TEXTURE_MAP_DIMENSION = 256

export const surfaceTextureFaceRefSchema = bodyTopoRefSchema
  .safeExtend({
    kind: z.literal("face"),
    signature: topologySignatureSchema.safeExtend({ kind: z.literal("face") }),
  })
  .strict()

export const surfaceTextureTargetSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("body"), outputRole: bodyOutputRoleSchema }).strict(),
  z
    .object({
      kind: z.literal("faces"),
      outputRole: bodyOutputRoleSchema,
      refs: z.array(surfaceTextureFaceRefSchema).min(1).max(256),
    })
    .strict(),
])

export const surfaceTextureMapSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("builtin"),
      pattern: z.enum(["noise", "ridges", "dots", "knurling", "hexagons", "wood"]),
    })
    .strict(),
  z
    .object({
      kind: z.literal("custom"),
      width: z.number().int().min(1).max(MAX_SURFACE_TEXTURE_MAP_DIMENSION),
      height: z.number().int().min(1).max(MAX_SURFACE_TEXTURE_MAP_DIMENSION),
      pixels: z
        .array(z.number().int().min(0).max(255))
        .min(1)
        .max(MAX_SURFACE_TEXTURE_MAP_DIMENSION ** 2),
    })
    .strict()
    .refine((map) => map.pixels.length === map.width * map.height, {
      path: ["pixels"],
      message: "The grayscale pixel count must match the map dimensions.",
    }),
])

export const surfaceTextureMappingSchema = z
  .object({
    kind: z.enum(["triplanar", "planar", "cylindrical", "spherical"]),
    axis: z.enum(["x", "y", "z"]),
  })
  .strict()

const finiteVectorSchema = z.tuple([
  z.number().finite().min(-100_000).max(100_000),
  z.number().finite().min(-100_000).max(100_000),
  z.number().finite().min(-100_000).max(100_000),
])
export const surfaceTextureMaskSchema = z
  .object({
    base: z.enum(["all", "empty"]),
    strokes: z
      .array(
        z
          .object({
            center: finiteVectorSchema,
            normal: finiteVectorSchema.refine(
              (normal) => Math.abs(Math.hypot(...normal) - 1) <= 1e-6,
              {
                message: "Brush normals must be normalized.",
              },
            ),
            radiusMm: z.number().finite().positive().max(1_000),
            hardness: z.number().finite().min(0).max(1),
            mode: z.enum(["paint", "erase"]),
          })
          .strict(),
      )
      .max(2_048),
  })
  .strict()

export const surfaceTextureLayerSchema = z
  .object({
    id: surfaceTextureLayerIdSchema,
    featureId: featureIdSchema,
    enabled: z.boolean(),
    target: surfaceTextureTargetSchema,
    map: surfaceTextureMapSchema,
    mapping: surfaceTextureMappingSchema,
    heightMm: z.number().finite().positive().max(100),
    sizeUMm: z.number().finite().positive().max(100_000),
    sizeVMm: z.number().finite().positive().max(100_000),
    rotationDeg: z.number().finite().min(-360).max(360),
    offsetUMm: z.number().finite().min(-100_000).max(100_000),
    offsetVMm: z.number().finite().min(-100_000).max(100_000),
    direction: z.enum(["outward", "inward", "centered"]),
    invert: z.boolean(),
    boundaryFadeMm: z.number().finite().nonnegative().max(100_000),
    blend: z.enum(["replace", "add"]),
    mask: surfaceTextureMaskSchema,
  })
  .strict()
  .superRefine((layer, context) => {
    if (layer.target.kind === "faces")
      for (const [index, ref] of layer.target.refs.entries())
        if (ref.featureId !== layer.featureId || ref.outputRole !== layer.target.outputRole)
          context.addIssue({
            code: "custom",
            path: ["target", "refs", index, "featureId"],
            message: "Texture face references must belong to the layer's feature and output role.",
          })
  })

export const surfaceTextureLayersSchema = z
  .array(surfaceTextureLayerSchema)
  .max(4_096 * MAX_SURFACE_TEXTURE_LAYERS_PER_FEATURE)
  .superRefine((layers, context) => {
    const ids = new Set<string>()
    const counts = new Map<string, number>()
    for (const [index, layer] of layers.entries()) {
      if (ids.has(layer.id))
        context.addIssue({
          code: "custom",
          path: [index, "id"],
          message: "Texture layer IDs must be unique.",
        })
      ids.add(layer.id)
      const count = (counts.get(layer.featureId) ?? 0) + 1
      counts.set(layer.featureId, count)
      if (count > MAX_SURFACE_TEXTURE_LAYERS_PER_FEATURE)
        context.addIssue({
          code: "custom",
          path: [index],
          message: "A feature may have at most four texture layers.",
        })
    }
  })

export { type SurfaceTextureLayerId, surfaceTextureLayerIdSchema } from "./identifiers"
export type SurfaceTextureLayer = Readonly<z.infer<typeof surfaceTextureLayerSchema>>
export type SurfaceTextureMap = Readonly<z.infer<typeof surfaceTextureMapSchema>>
export type SurfaceTextureMapping = Readonly<z.infer<typeof surfaceTextureMappingSchema>>
export type SurfaceTextureTarget = Readonly<z.infer<typeof surfaceTextureTargetSchema>>
export type SurfaceTextureMask = Readonly<z.infer<typeof surfaceTextureMaskSchema>>

export function createDefaultSurfaceTextureLayer(
  featureId: SurfaceTextureLayer["featureId"],
  outputRole: string,
  id: SurfaceTextureLayerId,
): SurfaceTextureLayer {
  return surfaceTextureLayerSchema.parse({
    id,
    featureId,
    enabled: true,
    target: { kind: "body", outputRole },
    map: { kind: "builtin", pattern: "noise" },
    mapping: { kind: "triplanar", axis: "z" },
    heightMm: 0.3,
    sizeUMm: 5,
    sizeVMm: 5,
    rotationDeg: 0,
    offsetUMm: 0,
    offsetVMm: 0,
    direction: "outward",
    invert: false,
    boundaryFadeMm: 0,
    blend: "add",
    mask: { base: "all", strokes: [] },
  })
}
