import { z } from "zod"

const jobId = z.number().int().positive().max(Number.MAX_SAFE_INTEGER)
const positions = z.instanceof(Float32Array).refine((value) => value.length % 3 === 0)

export const edgePreparationRequestSchema = z.strictObject({
  version: z.literal(1),
  type: z.literal("prepareEdges"),
  jobId,
  preparePicking: z.boolean(),
  positions,
  indices: z.instanceof(Uint32Array).refine((value) => value.length % 3 === 0),
})

const pickingIndex = z.strictObject({
  roots: z
    .array(z.instanceof(ArrayBuffer).refine((value) => value.byteLength % 32 === 0))
    .length(1),
  indirectBuffer: z.union([z.instanceof(Uint16Array), z.instanceof(Uint32Array)]),
})

const edgePreparationResponseSchema = z.discriminatedUnion("type", [
  z.strictObject({
    version: z.literal(1),
    type: z.literal("edgesPrepared"),
    jobId,
    positions: z.instanceof(Float32Array).refine((value) => value.length % 6 === 0),
    picking: pickingIndex.nullable(),
  }),
  z.strictObject({
    version: z.literal(1),
    type: z.literal("edgePreparationFailed"),
    jobId: jobId.or(z.literal(0)),
    code: z.enum(["invalid-mesh", "preparation-failed"]),
  }),
])

export type EdgePreparationRequest = z.infer<typeof edgePreparationRequestSchema>
export type EdgePreparationResponse = z.infer<typeof edgePreparationResponseSchema>

export type PreparedMeshData = Extract<EdgePreparationResponse, { type: "edgesPrepared" }>

export function parsePreparedMeshData(value: unknown, expectedJobId: number, maxLength: number) {
  const response = edgePreparationResponseSchema.parse(value)
  if (response.jobId !== expectedJobId) throw new Error("Unexpected edge preparation job.")
  if (response.type === "edgePreparationFailed") {
    throw new Error(`Edge preparation failed: ${response.code}.`)
  }
  if (response.positions.length > maxLength) {
    throw new Error("Edge preparation exceeded its output bound.")
  }
  const triangles = maxLength / 18
  if (
    response.picking &&
    (response.picking.indirectBuffer.length !== triangles ||
      response.picking.roots.some(
        (root) => root.byteLength === 0 || root.byteLength > triangles * 64,
      ))
  )
    throw new Error("Picking preparation exceeded its output bound.")
  return response
}
