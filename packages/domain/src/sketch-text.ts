import { z } from "zod"

export const SKETCH_TEXT_LAYOUT_ENGINE = "unicode-scalar-kerning-v1" as const
export const SKETCH_TEXT_OUTLINE_SDK = "opentype.js@2.0.0" as const
export const SKETCH_TEXT_MAX_CODE_POINTS = 64
export const SKETCH_TEXT_MAX_SEGMENTS = 2_000
export const SKETCH_TEXT_MAX_POLES = 2_000

export const BUNDLED_SKETCH_TEXT_FONT = Object.freeze({
  immutableId: "noto-sans-regular-2.008-v1",
  digest: "b85c38ecea8a7cfb39c24e395a4007474fa5a4fc864f6ee33309eb4948d232d5",
  faceIndex: 0,
  byteLength: 569_208,
  family: "Noto Sans",
  style: "Regular",
  revision: "2.008",
  unitsPerEm: 1_000,
  capHeight: 714,
  xHeight: 536,
  ascender: 1_069,
  descender: -293,
} as const)

export const sketchTextFontSchema = z
  .object({
    immutableId: z.literal(BUNDLED_SKETCH_TEXT_FONT.immutableId),
    digest: z.literal(BUNDLED_SKETCH_TEXT_FONT.digest),
    faceIndex: z.literal(BUNDLED_SKETCH_TEXT_FONT.faceIndex),
    byteLength: z.literal(BUNDLED_SKETCH_TEXT_FONT.byteLength),
    family: z.literal(BUNDLED_SKETCH_TEXT_FONT.family),
    style: z.literal(BUNDLED_SKETCH_TEXT_FONT.style),
    revision: z.literal(BUNDLED_SKETCH_TEXT_FONT.revision),
    unitsPerEm: z.literal(BUNDLED_SKETCH_TEXT_FONT.unitsPerEm),
    capHeight: z.literal(BUNDLED_SKETCH_TEXT_FONT.capHeight),
    xHeight: z.literal(BUNDLED_SKETCH_TEXT_FONT.xHeight),
    ascender: z.literal(BUNDLED_SKETCH_TEXT_FONT.ascender),
    descender: z.literal(BUNDLED_SKETCH_TEXT_FONT.descender),
  })
  .strict()

const textSchema = z
  .string()
  .min(1)
  .max(SKETCH_TEXT_MAX_CODE_POINTS * 8)
  .overwrite((text) => text.normalize("NFC"))
  .superRefine((text, context) => {
    if ([...text].length > SKETCH_TEXT_MAX_CODE_POINTS) {
      context.addIssue({ code: "custom", message: "Text exceeds the 64-code-point limit." })
    }
    // This layout deliberately excludes contextual shaping and surviving combining marks.
    if (
      /[\p{C}\p{M}\p{Zl}\p{Zp}]/u.test(text) ||
      !/^[\p{Script=Latin}\p{Script=Greek}\p{Script=Cyrillic}\p{Script=Common}]+$/u.test(text)
    ) {
      context.addIssue({
        code: "custom",
        message:
          "This text layout supports single-line Latin, Greek and Cyrillic scalars without contextual shaping or combining marks.",
      })
    }
  })

/** Editable intent; generated curve UUIDs are allocated by ordinary sketch commands. */
export const sketchTextParametersSchema = z
  .object({
    schemaVersion: z.literal(0),
    text: textSchema,
    font: sketchTextFontSchema,
    layoutEngine: z.literal(SKETCH_TEXT_LAYOUT_ENGINE),
    outlineSdk: z.literal(SKETCH_TEXT_OUTLINE_SDK),
    heightMm: z.number().finite().min(0.01).max(1_000),
    alignment: z
      .object({
        horizontal: z.enum(["left", "center", "right"]),
        vertical: z.enum(["baseline", "bottom", "center", "top"]),
      })
      .strict(),
    trackingMm: z.number().finite().min(-1_000).max(1_000),
    kerning: z.boolean(),
  })
  .strict()

export type SketchTextParameters = z.infer<typeof sketchTextParametersSchema>
