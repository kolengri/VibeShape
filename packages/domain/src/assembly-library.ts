import { z } from "zod"
import {
  assemblyAuthoritySchema,
  emptyAssemblyAuthority,
  type PinnedAssemblyDefinition,
  pinnedAssemblyDefinitionSchema,
  validateAssemblySourcePins,
} from "./assembly-authority"
import {
  assemblyLibraryItemIdSchema,
  assemblyLibraryVersionNumberSchema,
} from "./assembly-library-binding"
import { canonicalJson } from "./canonical-json"
import { timestampSchema } from "./identifiers"
import { authoredItemNameSchema } from "./parts"
import { type SourceAsset, sourceAssetDigestSchema, sourceAssetsSchema } from "./source-assets"

export * from "./assembly-library-binding"

const tagSchema = z.string().trim().min(1).max(64)
export const assemblyLibraryTagsSchema = z
  .array(tagSchema)
  .max(32)
  .refine((tags) => new Set(tags.map((tag) => tag.toLowerCase())).size === tags.length)
export const assemblyLibraryItemSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: assemblyLibraryItemIdSchema,
    metadataRevision: z.number().int().positive().safe(),
    headVersion: assemblyLibraryVersionNumberSchema,
    name: authoredItemNameSchema,
    tags: assemblyLibraryTagsSchema,
    createdAt: timestampSchema,
    updatedAt: timestampSchema,
  })
  .strict()
export type AssemblyLibraryItem = Readonly<z.infer<typeof assemblyLibraryItemSchema>>

/** A library revision owns its complete frozen source closure, independent of the live document. */
export function assemblyLibraryDefinitionAssets(
  definition: PinnedAssemblyDefinition,
): readonly SourceAsset[] {
  const assets = new Map<string, SourceAsset>()
  for (const pinned of definition.pinnedModels)
    for (const asset of pinned.assets) {
      const previous = assets.get(asset.id)
      if (previous && canonicalJson(previous) !== canonicalJson(asset))
        throw new Error("One library source identity cannot declare different immutable assets.")
      assets.set(asset.id, asset)
    }
  return sourceAssetsSchema.parse(
    [...assets.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
  )
}

function withinRecordBudget(value: unknown) {
  let bytes = 0
  for (const character of canonicalJson(value)) {
    const point = character.codePointAt(0) ?? 0
    bytes += point < 128 ? 1 : point < 2048 ? 2 : point < 65536 ? 3 : 4
    if (bytes > 16 * 1024 * 1024) return false
  }
  return true
}
export const assemblyLibraryDefinitionSchema = pinnedAssemblyDefinitionSchema.superRefine(
  (definition, context) => {
    const validated = assemblyAuthoritySchema.safeParse({
      ...emptyAssemblyAuthority(),
      definitions: [definition],
    })
    if (!validated.success)
      for (const issue of validated.error.issues)
        context.addIssue({ code: "custom", path: issue.path, message: issue.message })
    try {
      const assets = assemblyLibraryDefinitionAssets(definition)
      const issue = validateAssemblySourcePins(
        { ...emptyAssemblyAuthority(), definitions: [definition] },
        assets,
      )
      if (issue) context.addIssue({ code: "custom", message: issue })
      if (!withinRecordBudget(definition))
        context.addIssue({
          code: "custom",
          message: "A library definition exceeds its record budget.",
        })
    } catch (error) {
      context.addIssue({
        code: "custom",
        message: error instanceof Error ? error.message : "The library source closure is invalid.",
      })
    }
  },
)
export const assemblyLibraryVersionContentSchema = z
  .object({
    schemaVersion: z.literal(1),
    itemId: assemblyLibraryItemIdSchema,
    version: assemblyLibraryVersionNumberSchema,
    createdAt: timestampSchema,
    definition: assemblyLibraryDefinitionSchema,
  })
  .strict()
export const assemblyLibraryVersionSchema = assemblyLibraryVersionContentSchema.extend({
  contentDigest: sourceAssetDigestSchema,
})
export type AssemblyLibraryVersion = Readonly<z.infer<typeof assemblyLibraryVersionSchema>>
export function assemblyLibraryVersionContent(version: AssemblyLibraryVersion) {
  const { contentDigest: _digest, ...content } = assemblyLibraryVersionSchema.parse(version)
  return content
}
