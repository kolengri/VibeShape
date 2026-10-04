import {
  assemblyDefinitionIdSchema,
  assemblyInstanceIdSchema,
  assemblyRigidPoseSchema,
} from "@vibeshape/domain/assembly"
import {
  assemblyLibraryItemIdSchema,
  assemblyLibraryItemSchema,
  assemblyLibraryTagsSchema,
  assemblyLibraryVersionNumberSchema,
} from "@vibeshape/domain/assembly-library"
import { partIdSchema, revisionSchema, timestampSchema } from "@vibeshape/domain/identifiers"
import { authoredItemNameSchema } from "@vibeshape/domain/parts"
import { sourceAssetDigestSchema } from "@vibeshape/domain/source-assets"
import { z } from "zod"
import { assemblyDefinitionViewSchema, assemblyDraftArguments } from "./assembly-tools"

const metadata = { name: authoredItemNameSchema, tags: assemblyLibraryTagsSchema }
const selection = {
  itemId: assemblyLibraryItemIdSchema,
  version: assemblyLibraryVersionNumberSchema,
}
export const libraryToolInputs = {
  library_items: z
    .object({
      revision: revisionSchema,
      query: z.string().max(256).default(""),
      limit: z.number().int().min(1).max(200).default(100),
    })
    .strict(),
  library_version: z
    .object({
      revision: revisionSchema,
      itemId: assemblyLibraryItemIdSchema,
      version: assemblyLibraryVersionNumberSchema.optional(),
    })
    .strict(),
  save_library_definition: z
    .object({
      baseRevision: revisionSchema,
      source: z.discriminatedUnion("kind", [
        z.object({ kind: z.literal("part"), id: partIdSchema }).strict(),
        z.object({ kind: z.literal("definition"), id: assemblyDefinitionIdSchema }).strict(),
      ]),
      itemId: assemblyLibraryItemIdSchema.optional(),
      expectedMetadataRevision: z.number().int().positive().safe().nullable(),
      ...metadata,
    })
    .strict()
    .refine(
      (request) => request.itemId !== undefined || request.expectedMetadataRevision === null,
      "A new library item requires a null metadata revision.",
    ),
  update_library_metadata: z
    .object({
      baseRevision: revisionSchema,
      itemId: assemblyLibraryItemIdSchema,
      expectedMetadataRevision: z.number().int().positive().safe(),
      ...metadata,
    })
    .strict(),
  insert_library_version: z
    .object({
      ...assemblyDraftArguments,
      ...selection,
      mode: z.enum(["copy", "reference"]),
      definitionId: assemblyDefinitionIdSchema,
      definitionName: authoredItemNameSchema,
      instanceId: assemblyInstanceIdSchema,
      instanceName: authoredItemNameSchema,
      worldFrame: assemblyRigidPoseSchema,
    })
    .strict(),
  relink_library_definition: z
    .object({ ...assemblyDraftArguments, ...selection, definitionId: assemblyDefinitionIdSchema })
    .strict(),
  detach_library_definition: z
    .object({ ...assemblyDraftArguments, definitionId: assemblyDefinitionIdSchema })
    .strict(),
} as const
export const libraryVersionViewSchema = z
  .object({
    schemaVersion: z.literal(1),
    item: assemblyLibraryItemSchema,
    version: assemblyLibraryVersionNumberSchema,
    contentDigest: sourceAssetDigestSchema,
    createdAt: timestampSchema,
    definition: assemblyDefinitionViewSchema,
    sourceByteLength: z
      .number()
      .int()
      .min(0)
      .max(64 * 1024 * 1024),
  })
  .strict()
export const libraryItemsViewSchema = z
  .object({ schemaVersion: z.literal(1), items: z.array(assemblyLibraryItemSchema).max(200) })
  .strict()
export const libraryOperations = [
  z
    .object({ tool: z.literal("library_items"), arguments: libraryToolInputs.library_items })
    .strict(),
  z
    .object({ tool: z.literal("library_version"), arguments: libraryToolInputs.library_version })
    .strict(),
  z
    .object({
      tool: z.literal("save_library_definition"),
      arguments: libraryToolInputs.save_library_definition,
    })
    .strict(),
  z
    .object({
      tool: z.literal("update_library_metadata"),
      arguments: libraryToolInputs.update_library_metadata,
    })
    .strict(),
  z
    .object({
      tool: z.literal("insert_library_version"),
      arguments: libraryToolInputs.insert_library_version,
    })
    .strict(),
  z
    .object({
      tool: z.literal("relink_library_definition"),
      arguments: libraryToolInputs.relink_library_definition,
    })
    .strict(),
  z
    .object({
      tool: z.literal("detach_library_definition"),
      arguments: libraryToolInputs.detach_library_definition,
    })
    .strict(),
] as const
export const libraryOperationSchema = z.discriminatedUnion("tool", libraryOperations)
export type LibraryOperation = z.infer<typeof libraryOperationSchema>
export type LibraryVersionView = z.infer<typeof libraryVersionViewSchema>
