import { z } from "zod"
import type { DocumentSnapshot } from "./document"
import {
  documentIdSchema,
  revisionSchema,
  sketchConstraintIdSchema,
  sketchEntityIdSchema,
  sketchIdSchema,
} from "./identifiers"
import { sketchProfileSelectorSchema } from "./sketch-profile-selector"

const coordinate = z.number().finite()
export const sketchSolutionBoundsSchema = z
  .object({ minX: coordinate, minY: coordinate, maxX: coordinate, maxY: coordinate })
  .strict()
  .refine((bounds) => bounds.minX <= bounds.maxX && bounds.minY <= bounds.maxY)
export const sketchSolutionPointSchema = z
  .object({ entityId: sketchEntityIdSchema, x: coordinate, y: coordinate })
  .strict()
export const sketchSolutionCircleSchema = z
  .object({ entityId: sketchEntityIdSchema, radius: z.number().finite().positive() })
  .strict()
export const sketchSolutionProfileSchema = z
  .object({
    selector: sketchProfileSelectorSchema,
    area: z.number().finite().positive(),
    perimeter: z.number().finite().positive(),
    bounds: sketchSolutionBoundsSchema,
  })
  .strict()
export const sketchSolutionDiagnosticSchema = z
  .object({
    code: z.enum([
      "invalid-solution",
      "profile-budget-exceeded",
      "degenerate-entity",
      "duplicate-entity",
      "intersecting-entities",
      "open-chain",
      "ambiguous-curve-topology",
    ]),
    message: z.string().min(1).max(300),
    entityIds: z.array(sketchEntityIdSchema).max(64),
  })
  .strict()
export const sketchSolutionSummarySchema = z
  .object({
    status: z.enum(["fully-constrained", "under-constrained", "over-constrained", "failed"]),
    degreesOfFreedom: z.number().int(),
    maximumResidual: z.number().finite().nonnegative(),
    solver: z.literal("SolveSpace"),
    moduleSha256: z.string().regex(/^[a-f0-9]{64}$/),
    wasmSha256: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict()
export const sketchSolutionEvidenceSchema = z
  .object({
    schemaVersion: z.literal(1),
    documentId: documentIdSchema,
    revision: revisionSchema,
    generation: revisionSchema,
    inspectionId: z.uuid(),
    sketchId: sketchIdSchema,
    summary: sketchSolutionSummarySchema,
    points: z.array(sketchSolutionPointSchema).max(4990),
    circles: z.array(sketchSolutionCircleSchema).max(2495),
    failedConstraintIds: z.array(sketchConstraintIdSchema).max(10000),
    profiles: z.array(sketchSolutionProfileSchema).max(2000),
    diagnostics: z.array(sketchSolutionDiagnosticSchema).max(2000),
  })
  .strict()
  .refine(
    (evidence) =>
      evidence.profiles.every((profile) => profile.selector.sketchId === evidence.sketchId),
    "Profile selectors must belong to the inspected sketch.",
  )
export type SketchSolutionEvidence = z.infer<typeof sketchSolutionEvidenceSchema>

export function sketchSolutionEvidenceMatchesDocument(
  snapshot: DocumentSnapshot,
  evidence: SketchSolutionEvidence,
) {
  const sketch = snapshot.sketches.find(({ id }) => id === evidence.sketchId)
  if (!sketch) return false
  const entities = new Map(sketch.entities.map((entity) => [entity.id, entity]))
  const constraints = new Set(sketch.constraints.map(({ id }) => id))
  return (
    completeSolvedEntities(sketch.entities, evidence.points, "point") &&
    completeSolvedEntities(sketch.entities, evidence.circles, "circle") &&
    evidence.failedConstraintIds.every((id) => constraints.has(id)) &&
    evidence.profiles.every(({ selector }) =>
      [selector.outerBoundaryEntityIds, ...selector.holeBoundaryEntityIds].every((boundary) =>
        boundary.every((id) => {
          const entity = entities.get(id)
          return entity !== undefined && entity.type !== "point" && !entity.construction
        }),
      ),
    ) &&
    evidence.diagnostics.every(({ entityIds }) => entityIds.every((id) => entities.has(id)))
  )
}
function completeSolvedEntities(
  entities: DocumentSnapshot["sketches"][number]["entities"],
  values: readonly { entityId: string }[],
  type: "point" | "circle",
) {
  const authored = new Set<string>(
    entities.filter((entity) => entity.type === type).map(({ id }) => id),
  )
  const solved = new Set(values.map(({ entityId }) => entityId))
  return (
    values.length === authored.size &&
    solved.size === authored.size &&
    values.every(({ entityId }) => authored.has(entityId))
  )
}
