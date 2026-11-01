import { canonicalJson } from "@vibeshape/domain"
import { commandActorSchema } from "@vibeshape/domain/commands"
import { documentIdSchema, revisionSchema } from "@vibeshape/domain/identifiers"
import {
  pictureRenderCameraSchema,
  pictureRenderSettingsSchema,
} from "@vibeshape/domain/picture-render"
import { z } from "zod"
import { binaryExportDescriptorSchema } from "./binary-exports"
import { preparePictureRenderArgumentsSchema } from "./picture-render-arguments"
import { serializedQueryBytes } from "./query-byte-budget"

export { preparePictureRenderArgumentsSchema } from "./picture-render-arguments"

const identity = z.uuid()
const pair = z.strictObject({ leftInstanceId: identity, rightInstanceId: identity })
export const inspectMotionClearanceArgumentsSchema = z
  .strictObject({
    revision: revisionSchema,
    jointId: identity,
    coordinate: z.enum(["angle", "translation"]),
    start: z.number().finite(),
    end: z.number().finite(),
    sampleCount: z.number().int().min(2).max(64).default(13),
    minimumGap: z.number().finite().min(0).max(100000).optional(),
    pairs: z.array(pair).min(1).max(32).optional(),
    budgetMs: z.number().int().min(100).max(120000).default(120000),
  })
  .refine(
    (v) =>
      v.start !== v.end &&
      (!v.pairs ||
        (v.pairs.length * v.sampleCount <= 1024 &&
          v.pairs.every((p) => p.leftInstanceId !== p.rightInstanceId) &&
          new Set(v.pairs.map((p) => [p.leftInstanceId, p.rightInstanceId].sort().join(":")))
            .size === v.pairs.length)),
    "Use a nonzero range and unique distinct pairs within the 1024 pair-pose budget.",
  )
export const derivedReadToolInputs = {
  inspect_motion_clearance: inspectMotionClearanceArgumentsSchema,
}
export const derivedReadOperations = [
  z.strictObject({
    tool: z.literal("inspect_motion_clearance"),
    arguments: inspectMotionClearanceArgumentsSchema,
  }),
] as const
const sha256 = z.string().regex(/^[a-f0-9]{64}$/)
export const pictureRenderReceiptSchema = z
  .strictObject({
    file: binaryExportDescriptorSchema,
    settings: pictureRenderSettingsSchema,
    camera: pictureRenderCameraSchema.optional(),
    sourceDigest: sha256,
  })
  .refine(
    (v) =>
      v.file.format === "png" && (v.settings.camera === "current") === (v.camera !== undefined),
  )
const measuredPair = pair.extend({
  distance: z.number().finite().nonnegative(),
  volume: z.number().finite().nonnegative(),
  solidCount: z.number().int().nonnegative(),
  violatesMinimumGap: z.boolean(),
})
const smallest = measuredPair.extend({ value: z.number().finite() })
const clearanceReportShape = z.strictObject({
  status: z.enum(["complete", "incomplete"]),
  reason: z
    .enum([
      "invalid-input",
      "busy",
      "unavailable",
      "missing-joint",
      "stale",
      "cancelled",
      "budget",
      "unsupported-mesh",
      "solve-failed",
      "missing-evidence",
    ])
    .optional(),
  scope: z
    .strictObject({
      documentId: documentIdSchema,
      revision: revisionSchema,
      actor: commandActorSchema,
      sourceDigest: sha256,
    })
    .nullable(),
  jointId: identity,
  coordinate: z.enum(["angle", "translation"]),
  start: z.number().finite(),
  end: z.number().finite(),
  requestedSamples: z.number().int().min(2).max(64),
  minimumGap: z.number().finite().nonnegative(),
  resolution: z.number().finite().nonnegative(),
  pairs: z.array(pair).max(32),
  samples: z
    .array(
      z.strictObject({
        value: z.number().finite(),
        poseDigest: sha256,
        smallest: measuredPair,
        collisionCount: z.number().int().min(0).max(32),
        belowGapCount: z.number().int().min(0).max(32),
      }),
    )
    .max(64),
  smallest: smallest.nullable(),
  coverage: z.literal("sampled-poses-only"),
})

type ClearanceReport = z.infer<typeof clearanceReportShape>
type ClearanceSample = ClearanceReport["samples"][number]
function completedStateMatches(v: ClearanceReport) {
  if (v.status === "incomplete") return v.reason !== undefined
  return (
    Boolean(v.scope && v.smallest && v.pairs.length) &&
    v.reason === undefined &&
    v.samples.length === v.requestedSamples
  )
}
function sampleBudgetMatches(v: ClearanceReport) {
  if (v.samples.length > v.requestedSamples || v.pairs.length * v.requestedSamples > 1024)
    return false
  return !v.samples.length || v.scope !== null
}
function pairKey(p: z.infer<typeof pair>) {
  return [p.leftInstanceId, p.rightInstanceId].sort().join(":")
}
function sampleMatches(
  s: ClearanceSample,
  index: number,
  v: ClearanceReport,
  keys: readonly string[],
) {
  const expected =
    index === v.requestedSamples - 1
      ? v.end
      : v.start + ((v.end - v.start) * index) / (v.requestedSamples - 1)
  if (Math.abs(s.value - expected) > 1e-10 * Math.max(1, Math.abs(expected))) return false
  return (
    keys.includes(pairKey(s.smallest)) &&
    s.smallest.violatesMinimumGap === s.smallest.distance < v.minimumGap &&
    s.collisionCount <= keys.length &&
    s.belowGapCount <= keys.length
  )
}
function minimumSample(a: ClearanceSample, b: ClearanceSample) {
  if (b.smallest.distance < a.smallest.distance) return b
  return b.smallest.distance === a.smallest.distance && b.smallest.volume > a.smallest.volume
    ? b
    : a
}
function minimumMatches(v: ClearanceReport) {
  if (!v.samples.length) return v.smallest === null
  const min = v.samples.reduce(minimumSample)
  return (
    v.smallest?.value === min.value &&
    Object.entries(min.smallest).every(
      ([key, value]) => v.smallest?.[key as keyof typeof min.smallest] === value,
    )
  )
}
function consistentSamples(v: ClearanceReport) {
  if (!v.samples.length) return true
  if (v.resolution !== Math.abs(v.end - v.start) / (v.requestedSamples - 1)) return false
  const keys = v.pairs.map(pairKey)
  if (
    new Set(keys).size !== keys.length ||
    v.pairs.some((p) => p.leftInstanceId === p.rightInstanceId)
  )
    return false
  return v.samples.every((s, i) => sampleMatches(s, i, v, keys))
}
export const motionClearanceReportSchema = clearanceReportShape.superRefine((v, ctx) => {
  const checks = [
    completedStateMatches(v),
    sampleBudgetMatches(v),
    minimumMatches(v),
    consistentSamples(v),
  ]
  if (checks.some((check) => !check))
    ctx.addIssue({ code: "custom", message: "Clearance evidence is inconsistent." })
})
export type MotionClearanceReport = z.infer<typeof motionClearanceReportSchema>

type Operation = { tool: string; arguments: unknown }
type Result = { ok: boolean; value?: unknown }
function pictureMetadataMatches(
  view: z.infer<typeof pictureRenderReceiptSchema>,
  input: z.infer<typeof preparePictureRenderArgumentsSchema>,
) {
  return (
    canonicalJson(view.settings) === canonicalJson(input.settings) &&
    canonicalJson(view.camera ?? null) === canonicalJson(input.camera ?? null)
  )
}
function pictureResultMatches(operation: Operation, result: Result, documentId?: string) {
  const input = preparePictureRenderArgumentsSchema.safeParse(operation.arguments)
  if (!input.success) return false
  if (!result.ok) return true
  const view = pictureRenderReceiptSchema.safeParse(result.value)
  if (!view.success || serializedQueryBytes(result) > 128 * 1024) return false
  const file = view.data.file
  return (
    (!documentId || file.documentId === documentId) &&
    file.revision === input.data.revision &&
    pictureMetadataMatches(view.data, input.data)
  )
}
function scopeMatches(
  scope: ClearanceReport["scope"],
  documentId: string | undefined,
  revision: number,
  actor: unknown,
) {
  if (!scope) return true
  if (documentId && scope.documentId !== documentId) return false
  return (
    scope.revision === revision && (!actor || canonicalJson(scope.actor) === canonicalJson(actor))
  )
}
function clearanceRequestMatches(
  v: ClearanceReport,
  a: z.infer<typeof inspectMotionClearanceArgumentsSchema>,
) {
  const coordinates = ["jointId", "coordinate", "start", "end"] as const
  if (!coordinates.every((key) => v[key] === a[key]) || v.requestedSamples !== a.sampleCount)
    return false
  if (a.minimumGap !== undefined && v.minimumGap !== a.minimumGap) return false
  return !a.pairs || canonicalJson(v.pairs) === canonicalJson(a.pairs)
}
function clearanceResultMatches(
  operation: Operation,
  result: Result,
  documentId?: string,
  actor?: unknown,
) {
  const input = inspectMotionClearanceArgumentsSchema.safeParse(operation.arguments)
  if (!input.success) return false
  if (!result.ok) return true
  const report = motionClearanceReportSchema.safeParse(result.value)
  if (!report.success || serializedQueryBytes(result) > 128 * 1024) return false
  return (
    scopeMatches(report.data.scope, documentId, input.data.revision, actor) &&
    clearanceRequestMatches(report.data, input.data)
  )
}
export function derivedReadResultContextMatches(
  operation: Operation,
  result: Result,
  documentId?: string,
  actor?: unknown,
): boolean | null {
  if (operation.tool === "prepare_picture_render")
    return pictureResultMatches(operation, result, documentId)
  if (operation.tool === "inspect_motion_clearance")
    return clearanceResultMatches(operation, result, documentId, actor)
  return null
}
