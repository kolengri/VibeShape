import { z } from "zod"
import { shellOpeningContentSchema } from "./geometry-worker"
import { analyticalProfileSchema, analyticalSweepPathSchema } from "./sweep-loft"

const entityId = analyticalSweepPathSchema.shape.sourceEntityIds.element
const index = z.number().int().min(0).max(63)
const endConstraint = z
  .object({
    segmentTrack: index,
    continuity: z.enum(["G1", "G2"]),
    supportInputIndex: z.number().int().min(0).max(127),
    support: shellOpeningContentSchema,
  })
  .strict()
export const loftFeatureContentParametersV3Schema = z
  .object({
    sections: z.array(analyticalProfileSchema).min(2).max(24),
    ruled: z.literal(false),
    outerCorrespondence: z
      .array(
        z
          .object({
            sectionEntityIds: z.array(entityId).min(2).max(24),
            sectionStartPointIds: z.array(entityId).min(2).max(24),
          })
          .strict(),
      )
      .min(3)
      .max(64),
    rails: z
      .array(z.object({ vertexTrack: index, path: analyticalSweepPathSchema }).strict())
      .max(64),
    guides: z
      .array(
        z
          .object({
            name: z.string().trim().min(1).max(128),
            segmentTrack: index,
            continuity: z.literal("C0"),
            path: analyticalSweepPathSchema,
          })
          .strict(),
      )
      .max(64),
    start: z.array(endConstraint).max(64),
    end: z.array(endConstraint).max(64),
  })
  .strict()
  .superRefine((parameters, context) => {
    const issue = (message: string) => context.addIssue({ code: "custom", message })
    validateTopology(parameters, issue)
    validateTracks(parameters, issue)
    const entities =
      parameters.sections.reduce((n, section) => n + section.outer.segments.length, 0) +
      [...parameters.rails, ...parameters.guides].reduce(
        (n, entry) => n + entry.path.segments.length,
        0,
      )
    if (entities > 2_000) issue("Constrained Loft exceeds the aggregate curve budget.")
  })
export type LoftFeatureContentParametersV3 = z.infer<typeof loftFeatureContentParametersV3Schema>

function validateTopology(
  parameters: LoftFeatureContentParametersV3,
  issue: (message: string) => void,
) {
  const count = parameters.outerCorrespondence.length
  for (const [column, section] of parameters.sections.entries()) {
    const selected = parameters.outerCorrespondence.map((track) => track.sectionEntityIds[column])
    if (
      section.holes.length ||
      section.outer.segments.length !== count ||
      new Set(selected).size !== count ||
      selected.some((id) => !section.outer.segments.some((s) => s.entityId === id))
    )
      issue("Constrained Loft requires exactly matched hole-free section topology.")
  }
  if (
    parameters.outerCorrespondence.some(
      (track) =>
        track.sectionEntityIds.length !== parameters.sections.length ||
        track.sectionStartPointIds.length !== parameters.sections.length,
    )
  )
    issue("Loft correspondence must cover exactly every ordered section.")
}
function validateTracks(
  parameters: LoftFeatureContentParametersV3,
  issue: (message: string) => void,
) {
  const count = parameters.outerCorrespondence.length
  for (const tracks of [
    parameters.rails.map((r) => r.vertexTrack),
    parameters.start.map((e) => e.segmentTrack),
    parameters.end.map((e) => e.segmentTrack),
  ])
    if (new Set(tracks).size !== tracks.length || tracks.some((track) => track >= count))
      issue("Loft rails and end constraints require unique existing tracks.")
  if (
    new Set(parameters.guides.map((g) => g.name)).size !== parameters.guides.length ||
    parameters.guides.some((g) => g.segmentTrack >= count)
  )
    issue("Loft guides require unique names and existing segment tracks.")
}
