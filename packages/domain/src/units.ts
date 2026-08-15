import { z } from "zod"

const finiteNumberSchema = z.number().finite().transform(normalizeZero)
const expressionSchema = z
  .string()
  .min(1)
  .max(256)
  .refine((expression) => expression.trim() === expression, "Expressions must be normalized.")

export const lengthInputUnitSchema = z.enum(["um", "mm", "cm", "m", "in", "ft"])
export const angleInputUnitSchema = z.enum(["rad", "deg"])

const lengthSourceSchema = z
  .object({
    value: finiteNumberSchema,
    unit: lengthInputUnitSchema,
    expression: expressionSchema.nullable(),
  })
  .strict()

const angleSourceSchema = z
  .object({
    value: finiteNumberSchema,
    unit: angleInputUnitSchema,
    expression: expressionSchema.nullable(),
  })
  .strict()

const scalarSourceSchema = z
  .object({
    value: finiteNumberSchema,
    unit: z.literal("1"),
    expression: expressionSchema.nullable(),
  })
  .strict()

const millimetersPerUnit: Readonly<Record<z.infer<typeof lengthInputUnitSchema>, number>> = {
  um: 0.001,
  mm: 1,
  cm: 10,
  m: 1_000,
  in: 25.4,
  ft: 304.8,
}

function normalizeZero(value: number) {
  return Object.is(value, -0) ? 0 : value
}

export function lengthToMillimeters(value: number, unit: z.infer<typeof lengthInputUnitSchema>) {
  return normalizeZero(value * millimetersPerUnit[unit])
}

export function millimetersToLength(value: number, unit: z.infer<typeof lengthInputUnitSchema>) {
  return normalizeZero(value / millimetersPerUnit[unit])
}

export function squareMillimetersToArea(
  value: number,
  unit: z.infer<typeof lengthInputUnitSchema>,
) {
  const factor = millimetersPerUnit[unit]
  return normalizeZero(value / (factor * factor))
}

export function angleToRadians(value: number, unit: z.infer<typeof angleInputUnitSchema>) {
  return normalizeZero(unit === "rad" ? value : (value * Math.PI) / 180)
}

export function radiansToAngle(value: number, unit: z.infer<typeof angleInputUnitSchema>) {
  return normalizeZero(unit === "rad" ? value : (value * 180) / Math.PI)
}

export const lengthQuantitySchema = z
  .object({
    schemaVersion: z.literal(0),
    dimension: z.literal("length"),
    value: finiteNumberSchema,
    unit: z.literal("mm"),
    source: lengthSourceSchema,
  })
  .strict()
  .superRefine((quantity, context) => {
    if (quantity.value !== lengthToMillimeters(quantity.source.value, quantity.source.unit)) {
      context.addIssue({
        code: "custom",
        path: ["value"],
        message: "The canonical length does not match its source value and unit.",
      })
    }
  })

export const angleQuantitySchema = z
  .object({
    schemaVersion: z.literal(0),
    dimension: z.literal("angle"),
    value: finiteNumberSchema,
    unit: z.literal("rad"),
    source: angleSourceSchema,
  })
  .strict()
  .superRefine((quantity, context) => {
    if (quantity.value !== angleToRadians(quantity.source.value, quantity.source.unit)) {
      context.addIssue({
        code: "custom",
        path: ["value"],
        message: "The canonical angle does not match its source value and unit.",
      })
    }
  })

export const scalarQuantitySchema = z
  .object({
    schemaVersion: z.literal(0),
    dimension: z.literal("scalar"),
    value: finiteNumberSchema,
    unit: z.literal("1"),
    source: scalarSourceSchema,
  })
  .strict()
  .superRefine((quantity, context) => {
    if (quantity.value !== normalizeZero(quantity.source.value)) {
      context.addIssue({
        code: "custom",
        path: ["value"],
        message: "The canonical scalar does not match its source value.",
      })
    }
  })

export const quantitySchema = z.discriminatedUnion("dimension", [
  lengthQuantitySchema,
  angleQuantitySchema,
  scalarQuantitySchema,
])

export type LengthInputUnit = z.infer<typeof lengthInputUnitSchema>
export type AngleInputUnit = z.infer<typeof angleInputUnitSchema>
export type LengthQuantity = Readonly<z.infer<typeof lengthQuantitySchema>>
export type AngleQuantity = Readonly<z.infer<typeof angleQuantitySchema>>
export type ScalarQuantity = Readonly<z.infer<typeof scalarQuantitySchema>>
export type Quantity = Readonly<z.infer<typeof quantitySchema>>

export function createLengthQuantity(
  value: number,
  unit: LengthInputUnit = "mm",
  expression: string | null = null,
): LengthQuantity {
  return lengthQuantitySchema.parse({
    schemaVersion: 0,
    dimension: "length",
    value: lengthToMillimeters(value, unit),
    unit: "mm",
    source: { value: normalizeZero(value), unit, expression },
  })
}

export function createAngleQuantity(
  value: number,
  unit: AngleInputUnit = "rad",
  expression: string | null = null,
): AngleQuantity {
  return angleQuantitySchema.parse({
    schemaVersion: 0,
    dimension: "angle",
    value: angleToRadians(value, unit),
    unit: "rad",
    source: { value: normalizeZero(value), unit, expression },
  })
}

export function createScalarQuantity(
  value: number,
  expression: string | null = null,
): ScalarQuantity {
  return scalarQuantitySchema.parse({
    schemaVersion: 0,
    dimension: "scalar",
    value: normalizeZero(value),
    unit: "1",
    source: { value: normalizeZero(value), unit: "1", expression },
  })
}
