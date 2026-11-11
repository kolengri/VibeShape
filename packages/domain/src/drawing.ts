import { z } from "zod"

/** View identifiers; kept equal to the projection contract's list by a cross-package test. */
export const DRAWING_VIEWS = [
  "front",
  "back",
  "top",
  "bottom",
  "right",
  "left",
  "isometric",
] as const
export type DrawingView = (typeof DRAWING_VIEWS)[number]

/** Landscape sheet extents in millimetres (ISO 216 and ANSI/ASME Y14.1 A and B sizes). */
export const DRAWING_SHEET_SIZES = {
  "iso-a4": { width: 297, height: 210 },
  "iso-a3": { width: 420, height: 297 },
  "iso-a2": { width: 594, height: 420 },
  "iso-a1": { width: 841, height: 594 },
  "iso-a0": { width: 1189, height: 841 },
  "us-letter": { width: 279.4, height: 215.9 },
  "us-tabloid": { width: 431.8, height: 279.4 },
} as const
export type DrawingSheetSize = keyof typeof DRAWING_SHEET_SIZES
const sheetSizeIds = Object.keys(DRAWING_SHEET_SIZES) as [DrawingSheetSize, ...DrawingSheetSize[]]

/** Preferred ISO 5455 scales, largest first; automatic scaling picks the largest that fits. */
export const DRAWING_STANDARD_SCALES = [
  [50, 1],
  [20, 1],
  [10, 1],
  [5, 1],
  [2, 1],
  [1, 1],
  [1, 2],
  [1, 5],
  [1, 10],
  [1, 20],
  [1, 50],
  [1, 100],
  [1, 200],
  [1, 500],
  [1, 1000],
] as const

const scaleTerm = z.number().int().min(1).max(1000)
export const drawingScaleSchema = z.discriminatedUnion("mode", [
  z.strictObject({ mode: z.literal("auto") }),
  z.strictObject({ mode: z.literal("explicit"), numerator: scaleTerm, denominator: scaleTerm }),
])
export type DrawingScale = z.infer<typeof drawingScaleSchema>

/** C0 controls and DEL are invalid in XML 1.0 text and unprintable in DXF and PDF title blocks. */
function isControlCharacter(character: string) {
  const code = character.charCodeAt(0)
  return code < 0x20 || code === 0x7f
}
export function stripDrawingControlCharacters(value: string) {
  return [...value].filter((character) => !isControlCharacter(character)).join("")
}
const field = (maximum: number) =>
  z
    .string()
    .trim()
    .max(maximum)
    .refine((value) => ![...value].some(isControlCharacter), "Control characters are not allowed.")
    .default("")
export const drawingTitleBlockSchema = z.strictObject({
  title: field(80),
  drawingNumber: field(40),
  author: field(60),
  date: field(20),
  material: field(60),
})
export type DrawingTitleBlock = z.infer<typeof drawingTitleBlockSchema>

export const DEFAULT_DRAWING_VIEWS = ["front", "top", "right", "isometric"] as const

export const drawingSettingsSchema = z.strictObject({
  views: z
    .array(z.enum(DRAWING_VIEWS))
    .min(1)
    .max(DRAWING_VIEWS.length)
    .refine((views) => new Set(views).size === views.length, "Drawing views must be unique.")
    .default([...DEFAULT_DRAWING_VIEWS]),
  projection: z.enum(["first-angle", "third-angle"]).default("first-angle"),
  sheetSize: z.enum(sheetSizeIds).default("iso-a3"),
  orientation: z.enum(["landscape", "portrait"]).default("landscape"),
  scale: drawingScaleSchema.default({ mode: "auto" }),
  units: z.enum(["mm", "in"]).default("mm"),
  hiddenLines: z.boolean().default(true),
  dimensions: z.boolean().default(true),
  titleBlock: drawingTitleBlockSchema.default({
    title: "",
    drawingNumber: "",
    author: "",
    date: "",
    material: "",
  }),
})
export type DrawingSettings = z.infer<typeof drawingSettingsSchema>
export type DrawingSettingsInput = z.input<typeof drawingSettingsSchema>

/** Per-document saved dialog preset. Drawings are derived output; no model state is stored. */
export const drawingPresetSchema = z.strictObject({
  schemaVersion: z.literal(1),
  settings: drawingSettingsSchema,
})
export type DrawingPreset = z.infer<typeof drawingPresetSchema>

export function drawingSheetExtent(settings: Pick<DrawingSettings, "sheetSize" | "orientation">) {
  const size = DRAWING_SHEET_SIZES[settings.sheetSize]
  return settings.orientation === "landscape"
    ? { width: size.width, height: size.height }
    : { width: size.height, height: size.width }
}
