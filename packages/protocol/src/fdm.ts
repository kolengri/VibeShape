import { z } from "zod"
import { extrusionFrameSchema } from "./geometry-worker"

const coordinate = z.number().finite().min(-100_000).max(100_000)
const point = z.tuple([coordinate, coordinate])
const positive = z.number().finite().positive().max(1000)
export const fdmWebContentParametersSchema = z
  .object({
    kind: z.literal("web"),
    frame: extrusionFrameSchema,
    segments: z
      .array(
        z
          .object({ start: point, end: point })
          .strict()
          .refine(
            ({ start, end }) => Math.hypot(end[0] - start[0], end[1] - start[1]) > 1e-6,
            "Web lines must have positive length.",
          ),
      )
      .min(1)
      .max(64),
    thickness: positive,
    depth: positive,
    direction: z.enum(["forward", "reverse"]),
    style: z.enum(["web", "rib"]),
    extendToWalls: z.boolean(),
    supportInputCount: z.number().int().min(0).max(2),
  })
  .strict()
  .refine(
    (p) => !(p.style === "rib" && p.extendToWalls),
    "Automatic wall extension is supported for Web only.",
  )
const common = {
  axis: z.enum(["X", "Y", "Z"]),
  origin: z.object({ x: coordinate, y: coordinate, z: coordinate }).strict(),
}
const allowance = z.number().finite().min(0).max(1000)
const count = z.number().int().min(1).max(32)
const uncheckedPrimitiveSchema = z.discriminatedUnion("kind", [
  z
    .object({ ...common, kind: z.literal("corner-relief"), radius: positive, depth: positive })
    .strict(),
  z
    .object({
      ...common,
      kind: z.literal("seam-groove"),
      width: positive,
      depth: positive,
      length: positive,
    })
    .strict(),
  z
    .object({
      ...common,
      kind: z.literal("teardrop-hole"),
      diameter: positive,
      depth: positive,
      roofAngle: z
        .number()
        .finite()
        .min(Math.PI / 12)
        .max((5 * Math.PI) / 12),
      flatTop: z.boolean(),
    })
    .strict(),
  z
    .object({
      ...common,
      kind: z.literal("hex-seat"),
      acrossFlats: positive,
      depth: positive,
      compliance: positive,
      slotWidth: positive,
    })
    .strict(),
  z
    .object({
      ...common,
      kind: z.literal("crush-ribs"),
      holeDiameter: positive,
      ribHeight: positive,
      ribWidth: positive,
      depth: positive,
      count,
    })
    .strict(),
  z
    .object({
      ...common,
      kind: z.literal("flexible-sleeve"),
      outerDiameter: positive,
      innerDiameter: positive,
      length: positive,
      slotWidth: positive,
      slotLength: positive,
      count,
    })
    .strict(),
  z
    .object({
      ...common,
      kind: z.literal("nut-pocket"),
      acrossFlats: positive,
      depth: positive,
      clearance: allowance,
    })
    .strict(),
  z
    .object({
      ...common,
      kind: z.literal("insert-pocket"),
      diameter: positive,
      depth: positive,
      clearance: allowance,
      bossDiameter: positive.optional(),
      bossHeight: positive.optional(),
    })
    .strict(),
  z
    .object({
      ...common,
      kind: z.literal("enclosure-joint"),
      width: positive,
      length: positive,
      wall: positive,
      height: positive,
      clearance: allowance,
      mode: z.enum(["lip", "groove"]),
    })
    .strict(),
  z
    .object({
      ...common,
      kind: z.literal("membrane"),
      width: positive,
      length: positive,
      thickness: positive,
      mode: z.enum(["sheet", "bridges"]),
      bridgeCount: count.optional(),
      bridgeWidth: positive.optional(),
    })
    .strict(),
  z
    .object({
      ...common,
      kind: z.literal("calibration-coupon"),
      diameterStart: positive,
      diameterStep: positive,
      holeCount: count,
      spacing: positive,
      thickness: positive,
      margin: positive,
    })
    .strict(),
])

type Primitive = z.infer<typeof uncheckedPrimitiveSchema>
type Issue = (path: string, message: string) => void
function validateSleeve(p: Extract<Primitive, { kind: "flexible-sleeve" }>, issue: Issue) {
  if (
    p.innerDiameter >= p.outerDiameter ||
    p.slotLength >= p.length ||
    p.slotWidth * p.count >= Math.PI * p.innerDiameter
  )
    issue(
      "slotWidth",
      "Sleeves require a radial wall, uncut root band, and material between slots.",
    )
}
function validateInsert(p: Extract<Primitive, { kind: "insert-pocket" }>, issue: Issue) {
  if (
    Boolean(p.bossDiameter) !== Boolean(p.bossHeight) ||
    (p.bossDiameter && p.bossDiameter <= p.diameter + 2 * p.clearance)
  )
    issue("bossDiameter", "Insert bosses require both dimensions and a positive radial wall.")
}
function validateBridges(p: Extract<Primitive, { kind: "membrane" }>, issue: Issue) {
  if (
    p.mode === "bridges" &&
    (!p.bridgeCount || !p.bridgeWidth || p.bridgeWidth * p.bridgeCount >= p.width)
  )
    issue("bridgeWidth", "Segmented bridges require positive gaps.")
}
function validateCoupon(p: Extract<Primitive, { kind: "calibration-coupon" }>, issue: Issue) {
  const largest = p.diameterStart + (p.holeCount - 1) * p.diameterStep
  if (
    largest > 1000 ||
    (p.holeCount > 1 && p.spacing <= largest) ||
    (p.holeCount - 1) * p.spacing + largest + 2 * p.margin > 1000
  )
    issue("spacing", "Coupon dimensions must remain bounded and holes separated.")
}
function validateRadial(p: Primitive, issue: Issue) {
  if (p.kind === "crush-ribs" && p.ribHeight >= p.holeDiameter / 2)
    issue("ribHeight", "Crush ribs must retain a central opening.")
  if (p.kind === "hex-seat" && p.slotWidth >= p.acrossFlats / 3)
    issue("slotWidth", "Hex seats must retain material between slots.")
  if (p.kind === "enclosure-joint" && 2 * (p.wall + p.clearance) >= Math.min(p.width, p.length))
    issue("wall", "Enclosure joints must retain an interior opening.")
}
export const fdmPrimitiveContentParametersSchema = uncheckedPrimitiveSchema.superRefine(
  (p, context) => {
    const issue: Issue = (path, message) =>
      context.addIssue({ code: "custom", path: [path], message })
    switch (p.kind) {
      case "flexible-sleeve":
        return validateSleeve(p, issue)
      case "insert-pocket":
        return validateInsert(p, issue)
      case "membrane":
        return validateBridges(p, issue)
      case "calibration-coupon":
        return validateCoupon(p, issue)
      default:
        return validateRadial(p, issue)
    }
  },
)
export const fdmFeatureContentParametersSchema = z.union([
  fdmWebContentParametersSchema,
  fdmPrimitiveContentParametersSchema,
])
export type FdmFeatureContentParameters = Readonly<
  z.infer<typeof fdmFeatureContentParametersSchema>
>
