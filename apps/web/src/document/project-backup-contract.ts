import { documentIdSchema } from "@vibeshape/domain/identifiers"
import { VSHAPE_MAX_ARCHIVE_BYTES } from "@vibeshape/formats/vshape"
import { z } from "zod"

export const projectBackupRequestSchema = z
  .object({
    schemaVersion: z.literal(0),
    databaseName: z.string().min(1).max(256),
    documentId: documentIdSchema,
    revision: z.number().int().positive().safe(),
  })
  .strict()

export const projectBackupResponseSchema = z.discriminatedUnion("ok", [
  z
    .object({
      ok: z.literal(true),
      file: z
        .instanceof(Uint8Array)
        .refine((bytes) => bytes.byteLength <= VSHAPE_MAX_ARCHIVE_BYTES),
      documentId: documentIdSchema,
      revision: z.number().int().positive().safe(),
      documentName: z.string().min(1).max(256),
    })
    .strict(),
  z
    .object({
      ok: z.literal(false),
      diagnostic: z.object({ code: z.string().min(1), message: z.string().min(1) }),
    })
    .strict(),
])

export type ProjectBackupRequest = z.infer<typeof projectBackupRequestSchema>
export type ProjectBackupResult = z.infer<typeof projectBackupResponseSchema>

export const projectBackupProgressSchema = z
  .object({
    type: z.literal("progress"),
    documentId: documentIdSchema,
    revision: z.number().int().positive().safe(),
    stage: z.enum(["reading-project", "building-archive"]),
  })
  .strict()

export type ProjectBackupProgress = z.infer<typeof projectBackupProgressSchema>
export type ProjectBackupStage = ProjectBackupProgress["stage"]
