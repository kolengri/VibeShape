import { z } from "zod"
import { assemblyConstraintDiagnosticSchema } from "./assembly-tools"

/** Longest diagnostic message an MCP failure carries; longer source messages are cut to it. */
export const LOCAL_FAILURE_MESSAGE_MAX_LENGTH = 512

export const localFailureSchema = z
  .object({
    ok: z.literal(false),
    diagnostic: z
      .object({
        code: z.string().regex(/^[a-z][a-z0-9-]{0,95}$/),
        message: z.string().min(1).max(LOCAL_FAILURE_MESSAGE_MAX_LENGTH),
        retryable: z.boolean(),
        assembly: assemblyConstraintDiagnosticSchema.optional(),
      })
      .strict(),
  })
  .strict()
export type LocalFailure = z.infer<typeof localFailureSchema>
export function localFailure(code: string, message: string, retryable = false): LocalFailure {
  return localFailureSchema.parse({ ok: false, diagnostic: { code, message, retryable } })
}
