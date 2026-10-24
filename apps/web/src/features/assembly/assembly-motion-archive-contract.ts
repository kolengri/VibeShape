import { z } from "zod"

export const motionArchiveRequestSchema = z.strictObject({
  schemaVersion: z.literal(0),
  files: z
    .record(z.string().regex(/^(motion\.json|frame-\d{4}\.png)$/), z.instanceof(Uint8Array))
    .refine((files) => {
      const names = Object.keys(files)
      return names.length >= 2 && names.length <= 65 && names.includes("motion.json")
    }),
})

export const motionArchiveResponseSchema = z.discriminatedUnion("ok", [
  z.strictObject({ ok: z.literal(true), archive: z.instanceof(Uint8Array) }),
  z.strictObject({ ok: z.literal(false) }),
])
