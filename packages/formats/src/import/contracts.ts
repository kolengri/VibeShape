import { z } from "zod"
import { transformDeterminant } from "./matrix"

export const importLengthUnitSchema = z.enum(["mm", "cm", "m", "in", "ft", "um"])
export const importSvgUnitSchema = importLengthUnitSchema.or(z.literal("px"))
export const DEFAULT_IMPORT_LIMITS = Object.freeze({
  fileBytes: 32 * 1024 * 1024,
  expandedBytes: 64 * 1024 * 1024,
  zipEntries: 256,
  compressionRatio: 100,
  xmlDepth: 64,
  xmlNodes: 100_000,
  vertices: 250_000,
  triangles: 250_000,
  pathSegments: 10_000,
  bodies: 128,
  blockDepth: 16,
})
export type ImportLimits = Readonly<Record<keyof typeof DEFAULT_IMPORT_LIMITS, number>>
const limitFields = Object.fromEntries(
  Object.entries(DEFAULT_IMPORT_LIMITS).map(([key, maximum]) => [
    key,
    z.number().int().positive().max(maximum),
  ]),
)
export const importLimitsSchema = z.object(limitFields).strict()
const limitsOverrideSchema = importLimitsSchema.partial().optional()
const bytesSchema = z
  .instanceof(Uint8Array)
  .refine(
    (bytes) => bytes.byteLength > 0 && bytes.byteLength <= DEFAULT_IMPORT_LIMITS.fileBytes,
    "Import bytes must be nonempty and within the file-size budget.",
  )
export const geometryImportInputSchema = z.discriminatedUnion("format", [
  z
    .object({
      format: z.literal("stl"),
      bytes: bytesSchema,
      units: importLengthUnitSchema,
      limits: limitsOverrideSchema,
    })
    .strict(),
  z.object({ format: z.literal("3mf"), bytes: bytesSchema, limits: limitsOverrideSchema }).strict(),
  z
    .object({
      format: z.literal("dxf"),
      bytes: bytesSchema,
      units: importLengthUnitSchema.optional(),
      limits: limitsOverrideSchema,
    })
    .strict(),
  z
    .object({
      format: z.literal("svg"),
      bytes: bytesSchema,
      units: importSvgUnitSchema,
      limits: limitsOverrideSchema,
    })
    .strict(),
])
export type GeometryImportInput = z.infer<typeof geometryImportInputSchema>
export type ImportLengthUnit = z.infer<typeof importLengthUnitSchema>
export type ImportSvgUnit = z.infer<typeof importSvgUnitSchema>
export const LENGTH_UNIT_MM = Object.freeze({
  mm: 1,
  cm: 10,
  m: 1000,
  in: 25.4,
  ft: 304.8,
  um: 0.001,
  px: 25.4 / 96,
})

const coordinate = z
  .number()
  .finite()
  .min(-100_000)
  .max(100_000)
  .transform((value) => (value === 0 ? 0 : value))
const importPoint2Schema = z.tuple([coordinate, coordinate])
const importPoint3Schema = z.tuple([coordinate, coordinate, coordinate])
export const importTransformSchema = z
  .array(z.number().finite())
  .length(16)
  .refine(
    (matrix) => matrix[3] === 0 && matrix[7] === 0 && matrix[11] === 0 && matrix[15] === 1,
    "Import transforms must be affine column-major 4x4 matrices.",
  )
  .refine((matrix) => {
    const determinant = transformDeterminant(matrix)
    return Number.isFinite(determinant) && determinant !== 0
  }, "Import transforms must be nonsingular.")
const angle = z.number().finite()
const sweep = z
  .number()
  .finite()
  .refine(
    (value) => value !== 0 && Math.abs(value) <= Math.PI * 2 + 1e-10,
    "An arc requires a nonzero sweep within one turn.",
  )
export const importedCurveSchema = z.discriminatedUnion("type", [
  z
    .object({ type: z.literal("line"), start: importPoint2Schema, end: importPoint2Schema })
    .strict(),
  z
    .object({
      type: z.literal("arc"),
      center: importPoint2Schema,
      radius: z.number().finite().positive().max(100_000),
      startAngle: angle,
      sweep,
    })
    .strict(),
  z
    .object({
      type: z.literal("circle"),
      center: importPoint2Schema,
      radius: z.number().finite().positive().max(100_000),
    })
    .strict(),
  z
    .object({
      type: z.literal("ellipse"),
      center: importPoint2Schema,
      xAxis: importPoint2Schema,
      yAxis: importPoint2Schema,
    })
    .strict(),
  z
    .object({
      type: z.literal("elliptical-arc"),
      center: importPoint2Schema,
      xAxis: importPoint2Schema,
      yAxis: importPoint2Schema,
      startAngle: angle,
      sweep,
    })
    .strict(),
  z
    .object({
      type: z.literal("quadratic-bezier"),
      start: importPoint2Schema,
      control: importPoint2Schema,
      end: importPoint2Schema,
    })
    .strict(),
  z
    .object({
      type: z.literal("cubic-bezier"),
      start: importPoint2Schema,
      control1: importPoint2Schema,
      control2: importPoint2Schema,
      end: importPoint2Schema,
    })
    .strict(),
])
export type ImportedCurve = z.infer<typeof importedCurveSchema>
const label = z.string().min(1).max(256)
const inspectionId = z.string().min(1).max(128)
export const importedCurvePathSchema = z
  .object({
    id: inspectionId,
    label: label.optional(),
    layer: label.optional(),
    closed: z.boolean(),
    transform: importTransformSchema,
    segments: z.array(importedCurveSchema).min(1).max(DEFAULT_IMPORT_LIMITS.pathSegments),
  })
  .strict()
export type ImportedCurvePath = z.infer<typeof importedCurvePathSchema>
export const importedMeshSchema = z
  .object({
    id: inspectionId,
    label: label.optional(),
    vertices: z.array(importPoint3Schema).min(3).max(DEFAULT_IMPORT_LIMITS.vertices),
    triangles: z
      .array(
        z.tuple([
          z.number().int().nonnegative(),
          z.number().int().nonnegative(),
          z.number().int().nonnegative(),
        ]),
      )
      .min(1)
      .max(DEFAULT_IMPORT_LIMITS.triangles),
  })
  .strict()
  .refine(
    (mesh) => mesh.triangles.every((face) => face.every((index) => index < mesh.vertices.length)),
    "Triangles must reference existing vertices.",
  )
export type ImportedMesh = z.infer<typeof importedMeshSchema>
export const importedMeshNodeSchema = z
  .object({
    id: inspectionId,
    meshId: inspectionId,
    transform: importTransformSchema,
    reversesWinding: z.boolean(),
  })
  .strict()
  .refine(
    (node) => node.reversesWinding === transformDeterminant(node.transform) < 0,
    "Mirrored nodes must declare reversed winding.",
  )
export type ImportedMeshNode = z.infer<typeof importedMeshNodeSchema>
const unitsSchema = z
  .object({
    coordinateUnit: z.literal("mm"),
    sourceUnit: z.string().min(1).max(64),
    millimetersPerUnit: z.number().finite().positive(),
    policy: z.enum(["declared", "selected"]),
  })
  .strict()
const warningSchema = z
  .object({ code: z.literal("degenerate-triangles"), count: z.number().int().positive() })
  .strict()
/** IDs describe one inspection result. The import authority owns durable identities. */
export const parsedGeometryImportSchema = z
  .discriminatedUnion("kind", [
    z
      .object({
        kind: z.literal("triangle-mesh"),
        format: z.enum(["stl", "3mf"]),
        units: unitsSchema,
        meshes: z.array(importedMeshSchema).min(1).max(DEFAULT_IMPORT_LIMITS.bodies),
        nodes: z.array(importedMeshNodeSchema).min(1).max(DEFAULT_IMPORT_LIMITS.bodies),
        warnings: z.array(warningSchema).max(1),
      })
      .strict(),
    z
      .object({
        kind: z.literal("sketch-curves"),
        format: z.enum(["dxf", "svg"]),
        units: unitsSchema,
        paths: z.array(importedCurvePathSchema).min(1).max(DEFAULT_IMPORT_LIMITS.pathSegments),
        warnings: z.array(warningSchema).length(0),
      })
      .strict(),
  ])
  .superRefine((geometry, context) => {
    const unique = (ids: string[]) => new Set(ids).size === ids.length
    if (geometry.kind === "triangle-mesh") {
      const meshIds = new Set(geometry.meshes.map((mesh) => mesh.id))
      if (
        meshIds.size !== geometry.meshes.length ||
        !unique(geometry.nodes.map((node) => node.id)) ||
        geometry.nodes.some((node) => !meshIds.has(node.meshId))
      )
        context.addIssue({
          code: "custom",
          message: "Mesh and node identities must be unique and references must resolve.",
        })
    } else if (!unique(geometry.paths.map((path) => path.id)))
      context.addIssue({ code: "custom", message: "Curve path identities must be unique." })
  })
export type ParsedGeometryImport = z.infer<typeof parsedGeometryImportSchema>
export const geometryImportDiagnosticSchema = z
  .object({
    code: z.enum([
      "invalid-input",
      "invalid-format",
      "resource-limit",
      "unsafe-reference",
      "unsupported-geometry",
      "units-required",
      "invalid-geometry",
    ]),
    message: z.string().min(1).max(4096),
    source: z.string().min(1).max(4096).optional(),
  })
  .strict()
export type GeometryImportDiagnostic = z.infer<typeof geometryImportDiagnosticSchema>
export type GeometryImportResult =
  | Readonly<{ ok: true; geometry: ParsedGeometryImport }>
  | Readonly<{ ok: false; diagnostic: GeometryImportDiagnostic }>
export class GeometryImportError extends Error {
  constructor(
    readonly code: GeometryImportDiagnostic["code"],
    message: string,
    readonly source?: string,
  ) {
    super(message)
  }
}
export function requireImport(
  condition: boolean,
  code: GeometryImportDiagnostic["code"],
  message: string,
  source?: string,
): asserts condition {
  if (!condition) throw new GeometryImportError(code, message, source)
}
export function importLabel(value: string | undefined) {
  const normalized = value?.trim()
  requireImport(
    !normalized || normalized.length <= 256,
    "resource-limit",
    "A source label exceeds its length budget.",
  )
  return normalized || undefined
}
