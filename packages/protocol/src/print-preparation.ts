import { z } from "zod"

const coordinate = z.number().finite().min(-100_000).max(100_000)
const printMeshSchema = z
  .strictObject({
    name: z.string().min(1).max(4096),
    vertices: z.array(coordinate).min(12).max(300_000),
    triangles: z.array(z.number().int().nonnegative()).min(12).max(300_000),
  })
  .superRefine((mesh, context) => {
    if (
      mesh.vertices.length % 3 ||
      mesh.triangles.length % 3 ||
      mesh.triangles.some((i) => i >= mesh.vertices.length / 3)
    ) {
      context.addIssue({
        code: "custom",
        message:
          "A print mesh requires complete XYZ and index triples referencing existing vertices.",
      })
    }
  })
export const printPreparationSettingsSchema = z.strictObject({
  rotationX: z.number().finite().min(-180).max(180).default(45),
  rotationY: z.number().finite().min(-180).max(180).default(0),
  layerHeight: z.number().min(0.05).max(1).default(0.2),
  clearance: z.number().min(0.05).max(2).default(0.2),
  thickness: z.number().min(0.2).max(2).default(0.6),
  spacing: z.number().min(1).max(50).default(8),
  reach: z.number().min(1).max(25).default(6),
  supports: z.boolean().default(true),
})
export const printPreparationInputSchema = z
  .strictObject({
    meshes: z.array(printMeshSchema).min(1).max(8),
    settings: printPreparationSettingsSchema,
  })
  .superRefine((input, context) => {
    if (input.meshes.reduce((sum, mesh) => sum + mesh.triangles.length, 0) > 300_000) {
      context.addIssue({
        code: "custom",
        message: "Print preparation is limited to 100,000 triangles in total.",
      })
    }
  })
const printPreparationWarningSchema = z.enum([
  "partial-coverage",
  "multiple-bodies",
  "nonconvex-or-open",
  "complexity-limit",
  "no-suitable-facet",
  "no-safe-contacts",
])
export const printPreparationResultSchema = z
  .strictObject({
    meshes: z.array(printMeshSchema).min(1).max(10),
    normals: z
      .array(z.array(z.number().finite().min(-1).max(1)).max(300_000))
      .min(1)
      .max(10),
    report: z.strictObject({
      bodyCount: z.number().int().min(1).max(8),
      finCount: z.number().int().min(0).max(2),
      contactCount: z.number().int().min(0).max(128),
      bounds: z.tuple([
        coordinate.nonnegative(),
        coordinate.nonnegative(),
        coordinate.nonnegative(),
      ]),
      warnings: z.array(printPreparationWarningSchema).max(6),
    }),
  })
  .superRefine((result, context) => {
    if (
      result.normals.length !== result.meshes.length ||
      result.meshes.some((mesh, i) => mesh.vertices.length !== result.normals[i]?.length) ||
      result.meshes.length !== result.report.bodyCount + result.report.finCount ||
      result.meshes.reduce((sum, mesh) => sum + mesh.triangles.length, 0) > 312_000
    ) {
      context.addIssue({
        code: "custom",
        message: "Print result mesh counts or complexity do not match the bounded report.",
      })
    }
  })
export type PrintPreparationSettings = z.infer<typeof printPreparationSettingsSchema>
export type PrintPreparationInput = z.input<typeof printPreparationInputSchema>
export type PrintPreparationResult = z.infer<typeof printPreparationResultSchema>
export type PrintPreparationMesh = z.infer<typeof printMeshSchema>
export type PrintPreparationWarning = z.infer<typeof printPreparationWarningSchema>
