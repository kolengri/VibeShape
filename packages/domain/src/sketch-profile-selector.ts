import { z } from "zod"
import { sketchEntityIdSchema, sketchIdSchema } from "./identifiers"

export const MAX_PROFILE_SELECTOR_BOUNDARY_ENTITIES = 2_000
export const MAX_PROFILE_SELECTOR_HOLES = 2_000
export const MAX_SKETCH_PROFILE_SET_PROFILES = 64
export const MAX_SKETCH_PROFILE_SET_BOUNDARY_ENTITIES = 2_000

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

export function sketchProfileSelectorKey(selector: SketchProfileSelector) {
  return JSON.stringify([
    selector.sketchId,
    selector.outerBoundaryEntityIds,
    selector.holeBoundaryEntityIds,
  ])
}

function profileSetUsesCanonicalOrder(profiles: readonly SketchProfileSelector[]) {
  const keys = profiles.map(sketchProfileSelectorKey)
  return keys.every((key, index) => index === 0 || (keys[index - 1] ?? "") < key)
}

function profileSetStaysWithinBoundaryBudget(profiles: readonly SketchProfileSelector[]) {
  return (
    profiles.reduce(
      (total, profile) =>
        total +
        profile.outerBoundaryEntityIds.length +
        profile.holeBoundaryEntityIds.reduce(
          (profileTotal, boundary) => profileTotal + boundary.length,
          0,
        ),
      0,
    ) <= MAX_SKETCH_PROFILE_SET_BOUNDARY_ENTITIES
  )
}

export const sketchProfileSetSchema = z
  .object({
    schemaVersion: z.literal(0),
    profiles: z.array(sketchProfileSelectorSchema).min(1).max(MAX_SKETCH_PROFILE_SET_PROFILES),
  })
  .strict()
  .refine(({ profiles }) => profileSetUsesCanonicalOrder(profiles), {
    message: "Sketch profile sets must contain unique selectors in canonical order.",
  })
  .refine(({ profiles }) => profileSetStaysWithinBoundaryBudget(profiles), {
    message: "A sketch profile set exceeds the aggregate boundary entity budget.",
  })

export type SketchProfileSet = Readonly<z.infer<typeof sketchProfileSetSchema>>

export function createSketchProfileSet(profiles: readonly SketchProfileSelector[]) {
  return sketchProfileSetSchema.parse({
    schemaVersion: 0,
    profiles: [...profiles].sort((left, right) => {
      const leftKey = sketchProfileSelectorKey(left)
      const rightKey = sketchProfileSelectorKey(right)
      return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0
    }),
  })
}
