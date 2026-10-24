import { z } from "zod"

const jobId = z.number().int().positive().max(Number.MAX_SAFE_INTEGER)
const source = z.strictObject({
  positions: z.instanceof(Float32Array).refine((value) => value.length % 3 === 0),
  indices: z.instanceof(Uint32Array).refine((value) => value.length % 3 === 0),
})

export const sectionCapRequestSchema = z.strictObject({
  version: z.literal(1),
  type: z.literal("computeSectionCaps"),
  jobId,
  section: z.strictObject({
    axis: z.enum(["x", "y", "z"]),
    offset: z.number().finite(),
    flipped: z.boolean(),
  }),
  // The first request installs this worker's only scene snapshot; later requests reuse it.
  sources: z.array(source).nullable(),
})

const sectionCapResponseSchema = z.discriminatedUnion("type", [
  z.strictObject({
    version: z.literal(1),
    type: z.literal("sectionCapsComputed"),
    jobId,
    caps: z.array(
      z
        .instanceof(Float32Array)
        .refine((value) => value.length > 0 && value.length % 9 === 0)
        .nullable(),
    ),
  }),
  z.strictObject({
    version: z.literal(1),
    type: z.literal("sectionCapsFailed"),
    jobId: jobId.or(z.literal(0)),
    code: z.enum(["invalid-request", "missing-sources", "computation-failed"]),
  }),
])

export type SectionCapRequest = z.infer<typeof sectionCapRequestSchema>
export type SectionCapResponse = z.infer<typeof sectionCapResponseSchema>

export function parseSectionCaps(
  value: unknown,
  expectedJobId: number,
  maxLengths: readonly number[],
) {
  const response = sectionCapResponseSchema.parse(value)
  if (response.jobId !== expectedJobId) throw new Error("Unexpected section cap job.")
  if (response.type === "sectionCapsFailed")
    throw new Error(`Section cap computation failed: ${response.code}.`)
  if (
    response.caps.length !== maxLengths.length ||
    response.caps.some(
      (cap, index) => cap && (cap.length > (maxLengths[index] ?? 0) || !cap.every(Number.isFinite)),
    )
  )
    throw new Error(
      "Section cap computation exceeded its output bound or returned invalid coordinates.",
    )
  return response.caps
}
