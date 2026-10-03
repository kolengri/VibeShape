import { z } from "zod"
import { type DocumentSnapshotV2, documentSnapshotV2Schema } from "./document-v2-schema"
import { type SurfaceTextureLayer, surfaceTextureLayersSchema } from "./surface-textures"

export const documentSnapshotV3Schema = z
  .object({
    ...documentSnapshotV2Schema.shape,
    schemaVersion: z.literal(3),
    surfaceTextures: surfaceTextureLayersSchema,
  })
  .strict()
  .superRefine((snapshot, context) => {
    const { surfaceTextures, ...model } = snapshot
    const v2 = documentSnapshotV2Schema.safeParse({ ...model, schemaVersion: 2 })
    if (!v2.success)
      for (const issue of v2.error.issues)
        context.addIssue({ code: "custom", path: issue.path, message: issue.message })
    const features = new Set(snapshot.features.map((feature) => feature.id))
    for (const [index, layer] of surfaceTextures.entries())
      if (!features.has(layer.featureId))
        context.addIssue({
          code: "custom",
          path: ["surfaceTextures", index, "featureId"],
          message: "Texture layers require an existing producing feature.",
        })
  })
export type DocumentSnapshotV3 = Readonly<
  Omit<DocumentSnapshotV2, "schemaVersion"> & {
    schemaVersion: 3
    surfaceTextures: readonly SurfaceTextureLayer[]
  }
>
