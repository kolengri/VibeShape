import { z } from "zod"
import { documentIdSchema, revisionSchema, timestampSchema } from "./identifiers"

export const documentNameInputSchema = z.string().trim().min(1).max(120)
export const documentNameSchema = z
  .string()
  .min(1)
  .max(120)
  .refine((name) => name.trim() === name, "Document names must be normalized.")

export const documentSnapshotSchema = z
  .object({
    schemaVersion: z.literal(0),
    id: documentIdSchema,
    revision: revisionSchema,
    name: documentNameSchema,
    createdAt: timestampSchema,
    updatedAt: timestampSchema,
  })
  .strict()

export type DocumentSnapshot = Readonly<z.infer<typeof documentSnapshotSchema>>
