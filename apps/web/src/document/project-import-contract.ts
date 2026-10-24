import { documentIdSchema, timestampSchema } from "@vibeshape/domain/identifiers"
import { VSHAPE_MAX_ARCHIVE_BYTES } from "@vibeshape/formats/vshape"
import { z } from "zod"

const envelope = { schemaVersion: z.literal(0), jobId: z.uuid() }

export const projectImportRequestSchema = z.discriminatedUnion("kind", [
  z
    .object({
      ...envelope,
      kind: z.literal("decode"),
      bytes: z
        .instanceof(Uint8Array)
        .refine((bytes) => bytes.byteLength <= VSHAPE_MAX_ARCHIVE_BYTES),
    })
    .strict(),
  z
    .object({
      ...envelope,
      kind: z.literal("copy"),
      documentId: documentIdSchema,
      name: z.string(),
      issuedAt: timestampSchema,
    })
    .strict(),
])

export const projectImportResponseSchema = z.discriminatedUnion("kind", [
  z
    .object({ ...envelope, kind: z.literal("name"), sourceName: z.string().min(1).max(120) })
    .strict(),
  z
    .object({
      ...envelope,
      kind: z.literal("prepared"),
      value: z
        .object({
          version: z.union([
            z.literal(2),
            z.literal(3),
            z.literal(4),
            z.literal(5),
            z.literal(6),
            z.literal(7),
          ]),
          // Intentionally untrusted here: repository publication validates the versioned payload.
          // Parsing/replaying the entire journal at this transport boundary would block the UI again.
          project: z.record(z.string(), z.unknown()),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      ...envelope,
      kind: z.literal("error"),
      diagnostic: z.object({ code: z.string().min(1), message: z.string().min(1) }),
    })
    .strict(),
])

export type ProjectImportResponse = z.infer<typeof projectImportResponseSchema>
export type PreparedProjectImport = Extract<ProjectImportResponse, { kind: "prepared" }>["value"]
