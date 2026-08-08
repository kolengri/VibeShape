import { z } from "zod"

export const sandboxTaskModeSchema = z.enum([
  "wasm",
  "javascript-probe",
  "javascript-loop",
  "message-flood",
  "memory-growth",
  "oversized-output",
])

export const sandboxWorkerRequestSchema = z
  .object({
    schemaVersion: z.literal(0),
    mode: sandboxTaskModeSchema,
    wasm: z.instanceof(Uint8Array).nullable(),
    input: z.number().int().min(-1_000_000).max(1_000_000),
  })
  .strict()

const ambientAuthoritySchema = z
  .object({
    network: z.boolean(),
    clock: z.boolean(),
    randomness: z.boolean(),
    indexedDb: z.boolean(),
    cacheStorage: z.boolean(),
    dom: z.boolean(),
    rawKernel: z.boolean(),
  })
  .strict()

export const sandboxWorkerMessageSchema = z
  .object({
    schemaVersion: z.literal(0),
    type: z.enum(["result", "probe", "flood", "bytes", "error"]),
    terminal: z.boolean(),
    value: z.number().int().nullable(),
    authority: ambientAuthoritySchema.nullable(),
    sequence: z.number().int().nullable(),
    bytes: z.instanceof(Uint8Array).nullable(),
    diagnostic: z.string().min(1).max(80).nullable(),
  })
  .strict()

export type SandboxTaskMode = z.infer<typeof sandboxTaskModeSchema>
export type SandboxWorkerMessage = z.infer<typeof sandboxWorkerMessageSchema>
