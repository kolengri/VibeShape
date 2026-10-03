import {
  SKETCH_TEXT_MAX_CODE_POINTS,
  SKETCH_TEXT_MAX_POLES,
  SKETCH_TEXT_MAX_SEGMENTS,
  sketchTextParametersSchema,
} from "@vibeshape/domain/sketch-text"
import { z } from "zod"

const coordinate = z.number().finite().min(-100_000).max(100_000)
export const sketchTextOutlinePointSchema = z.tuple([coordinate, coordinate])
export type SketchTextOutlinePoint = z.infer<typeof sketchTextOutlinePointSchema>

export const sketchTextOutlineSegmentSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("line"),
      start: sketchTextOutlinePointSchema,
      end: sketchTextOutlinePointSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("cubic-bezier"),
      start: sketchTextOutlinePointSchema,
      control1: sketchTextOutlinePointSchema,
      control2: sketchTextOutlinePointSchema,
      end: sketchTextOutlinePointSchema,
    })
    .strict(),
])
export type SketchTextOutlineSegment = z.infer<typeof sketchTextOutlineSegmentSchema>

const contourSchema = z
  .object({
    glyphOrdinal: z
      .number()
      .int()
      .nonnegative()
      .max(SKETCH_TEXT_MAX_CODE_POINTS - 1),
    contourOrdinal: z
      .number()
      .int()
      .nonnegative()
      .max(SKETCH_TEXT_MAX_SEGMENTS - 1),
    closed: z.literal(true),
    segments: z.array(sketchTextOutlineSegmentSchema).min(1).max(SKETCH_TEXT_MAX_SEGMENTS),
  })
  .strict()
  .superRefine((contour, context) => {
    for (const [index, segment] of contour.segments.entries()) {
      const next = contour.segments[(index + 1) % contour.segments.length]
      if (!next || segment.end[0] !== next.start[0] || segment.end[1] !== next.start[1]) {
        context.addIssue({
          code: "custom",
          message: "Text contour is not exactly connected and closed.",
        })
        break
      }
    }
  })

function countGeometry(contours: z.infer<typeof contourSchema>[]): {
  segmentCount: number
  poleCount: number
} {
  let segmentCount = 0
  let poleCount = 0
  for (const contour of contours) {
    segmentCount += contour.segments.length
    for (const segment of contour.segments) poleCount += segment.kind === "line" ? 2 : 4
  }
  return { segmentCount, poleCount }
}

function glyphMatchesScalar(
  glyph: { ordinal: number; character: string; codePoint: number },
  index: number,
  scalars: string[],
): boolean {
  return (
    glyph.ordinal === index &&
    glyph.character === scalars[index] &&
    glyph.codePoint === glyph.character.codePointAt(0)
  )
}

export const sketchTextOutlineSchema = z
  .object({
    schemaVersion: z.literal(0),
    parameters: sketchTextParametersSchema,
    contours: z.array(contourSchema).min(1).max(SKETCH_TEXT_MAX_SEGMENTS),
    glyphs: z
      .array(
        z
          .object({
            ordinal: z
              .number()
              .int()
              .nonnegative()
              .max(SKETCH_TEXT_MAX_CODE_POINTS - 1),
            character: z.string().min(1).max(2),
            codePoint: z.number().int().nonnegative().max(0x10ffff),
            glyphIndex: z.number().int().positive().max(3_747),
            origin: sketchTextOutlinePointSchema,
            advanceMm: coordinate,
            kerningBeforeMm: coordinate,
          })
          .strict(),
      )
      .min(1)
      .max(SKETCH_TEXT_MAX_CODE_POINTS),
    metrics: z
      .object({
        scaleMmPerFontUnit: z.number().finite().positive(),
        advanceMm: coordinate,
        capHeightMm: z.number().finite().positive(),
        ascenderMm: coordinate,
        descenderMm: coordinate,
        baselineY: coordinate,
        bounds: z
          .object({ min: sketchTextOutlinePointSchema, max: sketchTextOutlinePointSchema })
          .strict(),
        segmentCount: z.number().int().positive().max(SKETCH_TEXT_MAX_SEGMENTS),
        poleCount: z.number().int().positive().max(SKETCH_TEXT_MAX_POLES),
      })
      .strict(),
  })
  .strict()
  .superRefine((outline, context) => {
    const scalars = [...outline.parameters.text]
    if (
      scalars.length !== outline.glyphs.length ||
      !outline.glyphs.every((glyph, index) => glyphMatchesScalar(glyph, index, scalars))
    ) {
      context.addIssue({
        code: "custom",
        message: "Text glyph metadata does not match the entered scalar sequence.",
      })
    }
    const { segmentCount, poleCount } = countGeometry(outline.contours)
    if (outline.contours.some((contour) => contour.glyphOrdinal >= scalars.length))
      context.addIssue({ code: "custom", message: "Text contour has an invalid glyph ordinal." })
    if (segmentCount !== outline.metrics.segmentCount || poleCount !== outline.metrics.poleCount) {
      context.addIssue({
        code: "custom",
        message: "Text outline aggregate counts do not match its geometry.",
      })
    }
    if (
      outline.metrics.bounds.min[0] > outline.metrics.bounds.max[0] ||
      outline.metrics.bounds.min[1] > outline.metrics.bounds.max[1]
    ) {
      context.addIssue({ code: "custom", message: "Text outline bounds are inverted." })
    }
  })

export type SketchTextOutline = z.infer<typeof sketchTextOutlineSchema>
export const sketchTextOutlineResultSchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), outline: sketchTextOutlineSchema }).strict(),
  z
    .object({
      ok: z.literal(false),
      diagnostics: z
        .array(
          z
            .object({
              code: z.enum([
                "invalid-text-parameters",
                "font-resource-mismatch",
                "font-resource-unavailable",
                "font-metrics-mismatch",
                "missing-glyph",
                "outline-budget-exceeded",
                "invalid-font-outline",
                "empty-text-outline",
                "text-world-limit-exceeded",
              ]),
              message: z.string().min(1).max(1_024),
              glyphOrdinal: z
                .number()
                .int()
                .nonnegative()
                .max(SKETCH_TEXT_MAX_CODE_POINTS - 1)
                .optional(),
              codePoint: z.number().int().nonnegative().max(0x10ffff).optional(),
            })
            .strict(),
        )
        .min(1)
        .max(SKETCH_TEXT_MAX_CODE_POINTS),
    })
    .strict(),
])
export type SketchTextOutlineResult = z.infer<typeof sketchTextOutlineResultSchema>
