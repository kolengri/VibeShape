import { z } from "zod"

export const assemblyLibraryItemIdSchema = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  .brand<"AssemblyLibraryItemId">()
export const assemblyLibraryVersionNumberSchema = z.number().int().positive().max(1024)
export const assemblyLibraryBindingSchema = z
  .object({ itemId: assemblyLibraryItemIdSchema, version: assemblyLibraryVersionNumberSchema })
  .strict()
export type AssemblyLibraryBinding = Readonly<z.infer<typeof assemblyLibraryBindingSchema>>
