import { z } from "zod"
import { MAX_SLICER_HANDOFF_BYTES, slicerIdSchema } from "./protocol"

export const NATIVE_SLICER_LIST_CHANNEL = "vibeshape:slicer:list"
export const NATIVE_SLICER_CHOOSE_CHANNEL = "vibeshape:slicer:choose"
export const NATIVE_SLICER_SEND_CHANNEL = "vibeshape:slicer:send"
export const NATIVE_SLICER_REVEAL_CHANNEL = "vibeshape:slicer:reveal"
export const nativeCustomSlicerIdSchema = z
  .string()
  .regex(/^custom-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
export const nativeSlicerIdSchema = z.union([slicerIdSchema, nativeCustomSlicerIdSchema])
export const nativeMeshFormatSchema = z.enum(["3mf", "stl"])
export const nativeSlicerTargetSchema = z.strictObject({
  id: nativeSlicerIdSchema,
  name: z.string().trim().min(1).max(120),
})
export const nativeSlicerTargetsSchema = z.array(nativeSlicerTargetSchema).max(32)
export const nativeMeshRequestSchema = z
  .strictObject({
    slicerId: nativeSlicerIdSchema,
    format: nativeMeshFormatSchema,
    filename: z
      .string()
      .trim()
      .min(5)
      .max(128)
      .regex(/^[^/\\]+\.(3mf|stl)$/i)
      .refine((filename) =>
        [...filename].every((character) => {
          const code = character.codePointAt(0) ?? 0
          return code >= 32 && code !== 127
        }),
      ),
    file: z
      .custom<Uint8Array>((value) => value instanceof Uint8Array)
      .refine((bytes) => bytes.byteLength > 0 && bytes.byteLength <= MAX_SLICER_HANDOFF_BYTES),
  })
  .refine((request) => request.filename.toLowerCase().endsWith(`.${request.format}`))
export const nativeSlicerFileIdSchema = z.uuid()
export const nativeSlicerFailureSchema = z.strictObject({
  ok: z.literal(false),
  reason: z.enum([
    "invalid-request",
    "forbidden",
    "busy",
    "capacity",
    "not-installed",
    "write-failed",
    "launch-failed",
    "choose-failed",
    "unavailable",
  ]),
  fileId: nativeSlicerFileIdSchema.optional(),
})
export const nativeSlicerApplicationsResultSchema = z.union([
  z.strictObject({ ok: z.literal(true), targets: nativeSlicerTargetsSchema }),
  nativeSlicerFailureSchema,
])
export const nativeSlicerChooseResultSchema = z.union([
  z.strictObject({ ok: z.literal(true), target: nativeSlicerTargetSchema.nullable() }),
  nativeSlicerFailureSchema,
])
export const nativeMeshResultSchema = z.union([
  z.strictObject({
    ok: z.literal(true),
    fileId: nativeSlicerFileIdSchema,
    slicerName: z.string().min(1).max(120),
  }),
  nativeSlicerFailureSchema,
])
export type NativeSlicerTarget = z.infer<typeof nativeSlicerTargetSchema>
export type NativeMeshFormat = z.infer<typeof nativeMeshFormatSchema>
export type NativeMeshRequest = z.infer<typeof nativeMeshRequestSchema>
export type NativeMeshResult = z.infer<typeof nativeMeshResultSchema>
export type NativeSlicerFailure = z.infer<typeof nativeSlicerFailureSchema>
export type NativeSlicerApplicationsResult = z.infer<typeof nativeSlicerApplicationsResultSchema>
export type NativeSlicerChooseResult = z.infer<typeof nativeSlicerChooseResultSchema>
export type NativeSlicerApi = Readonly<{
  protocolVersion: 1
  listApplications(): Promise<NativeSlicerApplicationsResult>
  chooseApplication(): Promise<NativeSlicerChooseResult>
  send(request: NativeMeshRequest): Promise<NativeMeshResult>
  reveal(fileId: string): Promise<boolean>
}>
