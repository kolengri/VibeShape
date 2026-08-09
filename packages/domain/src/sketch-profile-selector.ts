import { z } from "zod"
import { sketchEntityIdSchema, sketchIdSchema } from "./identifiers"

export const MAX_PROFILE_SELECTOR_BOUNDARY_ENTITIES = 2_000
export const MAX_PROFILE_SELECTOR_HOLES = 2_000

function isCanonicalEntityIdList(entityIds: readonly string[]) {
  return entityIds.every(
    (entityId, index) => index === 0 || (entityIds[index - 1] ?? "") < entityId,
  )
}

const profileBoundaryEntityIdsSchema = z
  .array(sketchEntityIdSchema)
  .min(1)
  .max(MAX_PROFILE_SELECTOR_BOUNDARY_ENTITIES)
  .refine(isCanonicalEntityIdList, {
    message: "Profile boundary entity IDs must be unique and sorted.",
  })

function profileBoundariesAreDisjoint(selector: {
  outerBoundaryEntityIds: readonly string[]
  holeBoundaryEntityIds: readonly (readonly string[])[]
}) {
  const boundaries = [selector.outerBoundaryEntityIds, ...selector.holeBoundaryEntityIds]
  const entityIds = boundaries.flat()
  return new Set(entityIds).size === entityIds.length
}

function profileBoundariesStayWithinBudget(selector: {
  outerBoundaryEntityIds: readonly string[]
  holeBoundaryEntityIds: readonly (readonly string[])[]
}) {
  return (
    selector.outerBoundaryEntityIds.length +
      selector.holeBoundaryEntityIds.reduce((total, boundary) => total + boundary.length, 0) <=
    MAX_PROFILE_SELECTOR_BOUNDARY_ENTITIES
  )
}

function holesUseCanonicalOrder(holeBoundaries: readonly (readonly string[])[]) {
  const keys = holeBoundaries.map((boundary) => boundary.join(":"))
  return keys.every((key, index) => index === 0 || (keys[index - 1] ?? "") < key)
}

export const sketchProfileSelectorSchema = z
  .object({
    schemaVersion: z.literal(0),
    sketchId: sketchIdSchema,
    outerBoundaryEntityIds: profileBoundaryEntityIdsSchema,
    holeBoundaryEntityIds: z.array(profileBoundaryEntityIdsSchema).max(MAX_PROFILE_SELECTOR_HOLES),
  })
  .strict()
  .refine((selector) => holesUseCanonicalOrder(selector.holeBoundaryEntityIds), {
    message: "Profile hole boundaries must be unique and sorted.",
  })
  .refine(profileBoundariesStayWithinBudget, {
    message: "A profile selector exceeds the boundary entity budget.",
  })
  .refine(profileBoundariesAreDisjoint, {
    message: "A profile entity can belong to only one selected boundary.",
  })

export type SketchProfileSelector = Readonly<z.infer<typeof sketchProfileSelectorSchema>>
