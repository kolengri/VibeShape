import { z } from "zod"

export const MAX_SURFACE_TEXTURE_TRIANGLES = 500_000

export const surfaceTexturePatternSchema = z.enum([
  "noise",
  "ridges",
  "dots",
  "knurling",
  "hexagons",
  "wood",
])

const surfaceTextureMeshMapSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("builtin"), pattern: surfaceTexturePatternSchema }).strict(),
  z
    .object({
      kind: z.literal("custom"),
      width: z.number().int().min(1).max(256),
      height: z.number().int().min(1).max(256),
      pixels: z.array(z.number().int().min(0).max(255)).min(1).max(65_536),
    })
    .strict()
    .refine((map) => map.pixels.length === map.width * map.height, {
      path: ["pixels"],
      message: "The grayscale pixel count must match the map dimensions.",
    }),
])

const textureVectorSchema = z.tuple([
  z.number().finite().min(-100_000).max(100_000),
  z.number().finite().min(-100_000).max(100_000),
  z.number().finite().min(-100_000).max(100_000),
])

export const surfaceTextureMeshMaskSchema = z
  .object({
    base: z.enum(["all", "empty"]),
    strokes: z
      .array(
        z
          .object({
            center: textureVectorSchema,
            normal: textureVectorSchema.refine(
              (normal) => Math.abs(Math.hypot(...normal) - 1) <= 1e-6,
              "Brush normals must be normalized.",
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

/** Face IDs are transient tessellation evidence, resolved from body-scoped TopoRefs. */
export const surfaceTextureMeshLayerSchema = z
  .object({
    id: z.string().min(1).max(128),
    enabled: z.boolean(),
    mask: surfaceTextureMeshMaskSchema,
    targetFaceIds: z.array(z.number().int().min(0).max(4_294_967_295)).min(1).max(256).nullable(),
    map: surfaceTextureMeshMapSchema,
    mapping: z
      .object({
        kind: z.enum(["triplanar", "planar", "cylindrical", "spherical"]),
        axis: z.enum(["x", "y", "z"]),
      })
      .strict(),
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
  })
  .strict()

export const surfaceTextureMeshLayersSchema = z.array(surfaceTextureMeshLayerSchema).max(4)

export const surfaceTextureExportLayersSchema = z
  .array(
    z
      .object({
        featureId: z
          .string()
          .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/),
        outputRole: z
          .string()
          .min(1)
          .max(128)
          .regex(/^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/),
        layers: surfaceTextureMeshLayersSchema,
      })
      .strict(),
  )
  .max(4_096)
  .refine(
    (groups) =>
      new Set(groups.map((group) => `${group.featureId}:${group.outputRole}`)).size ===
      groups.length,
    "Surface texture body groups must be unique.",
  )
  .refine(
    (groups) => JSON.stringify(groups).length <= 32 * 1024 * 1024,
    "Surface texture export data exceeds the memory budget.",
  )

export const surfaceTextureQualitySchema = z
  .object({
    maxEdgeLengthMm: z.number().finite().min(0.02).max(100),
    maxTriangles: z.number().int().min(12).max(MAX_SURFACE_TEXTURE_TRIANGLES),
  })
  .strict()

export const surfaceTextureMeshSchema = z
  .object({
    positions: z.instanceof(Float32Array),
    normals: z.instanceof(Float32Array),
    indices: z.instanceof(Uint32Array),
    triangleFaceIds: z.instanceof(Uint32Array),
  })
  .strict()
  .refine(
    (mesh) =>
      mesh.positions.length <= MAX_SURFACE_TEXTURE_TRIANGLES * 9 &&
      mesh.normals.length <= MAX_SURFACE_TEXTURE_TRIANGLES * 9 &&
      mesh.indices.length <= MAX_SURFACE_TEXTURE_TRIANGLES * 3 &&
      mesh.triangleFaceIds.length <= MAX_SURFACE_TEXTURE_TRIANGLES,
    "The surface texture mesh exceeds the memory budget.",
  )

export const surfaceTextureStatisticsSchema = z
  .object({
    sourceTriangleCount: z.number().int().nonnegative().max(MAX_SURFACE_TEXTURE_TRIANGLES),
    triangleCount: z.number().int().nonnegative().max(MAX_SURFACE_TEXTURE_TRIANGLES),
    vertexCount: z
      .number()
      .int()
      .nonnegative()
      .max(MAX_SURFACE_TEXTURE_TRIANGLES * 3),
  })
  .strict()

export type SurfaceTexturePattern = z.infer<typeof surfaceTexturePatternSchema>
export type SurfaceTextureMeshLayer = Readonly<z.infer<typeof surfaceTextureMeshLayerSchema>>
export type SurfaceTextureQuality = Readonly<z.infer<typeof surfaceTextureQualitySchema>>
export const DEFAULT_SURFACE_TEXTURE_QUALITY: SurfaceTextureQuality = {
  maxEdgeLengthMm: 0.5,
  maxTriangles: 250_000,
}
export type SurfaceTextureMesh = Readonly<z.infer<typeof surfaceTextureMeshSchema>>
export type SurfaceTextureExportLayers = ReadonlyArray<
  Readonly<{ featureId: string; outputRole: string; layers: readonly SurfaceTextureMeshLayer[] }>
>
